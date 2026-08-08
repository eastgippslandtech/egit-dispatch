import { NextResponse } from "next/server";

import { readDispatchConfig } from "@/server/dispatch/env";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import { createMspCentralClient } from "@/server/msp-central/client";
import { processTechnicianNotifications } from "@/server/notifications/poll";
import { getConfiguredNotificationRepository } from "@/server/notifications/repository";
import { configureNotificationScheduler } from "@/server/notifications/scheduler";
import { cronAuthorized } from "@/server/yeastar/route-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MSP_REFRESH_TIMEOUT_MS = 42_000;
const CONNECTOR_HEALTH_TIMEOUT_MS = 3_000;
const NOTIFICATION_PROCESS_TIMEOUT_MS = 10_000;

function isAuthorized(request: Request) {
  return cronAuthorized(request);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = readDispatchConfig();
  const repository = getConfiguredNotificationRepository();
  if (config.dispatchDataSource !== "msp-central" || !repository) {
    return NextResponse.json({
      reason: "Live MSP Central notifications are not configured.",
      skipped: true,
    });
  }

  try {
    const client = createMspCentralClient(config);
    const integrationRepository = createPostgresIntegrationRepository({
      databaseUrl: config.databaseUrl,
    });
    const refreshedRequests = await withPollTimeout(
      client.listRequests({ forceRefresh: true }),
      MSP_REFRESH_TIMEOUT_MS,
      "MSP Central request refresh timed out.",
    );
    await withPollTimeout(
      integrationRepository.recordConnectorRead({
        connector: "msp_central",
        succeeded: true,
      }),
      CONNECTOR_HEALTH_TIMEOUT_MS,
      "MSP Central health write timed out.",
    ).catch(() => undefined);
    const result = await withPollTimeout(
      processTechnicianNotifications({
        client,
        repository,
        requests: refreshedRequests,
      }),
      NOTIFICATION_PROCESS_TIMEOUT_MS,
      "Technician notification processing timed out.",
    ).catch((error) => {
      console.error("Technician notification processing skipped", {
        message: error instanceof Error ? error.message : "Unknown poll error",
      });
      return { notificationWarning: "Notification processing skipped." };
    });
    return NextResponse.json({
      ok: true,
      requestSnapshotRefreshed: refreshedRequests.length,
      ...result,
    });
  } catch (error) {
    const integrationRepository = createPostgresIntegrationRepository({
      databaseUrl: config.databaseUrl,
    });
    if (isMspOAuthRefreshThrottle(error)) {
      const message = error.message;
      await withPollTimeout(
        integrationRepository.recordConnectorRead({
          connector: "msp_central",
          error: message,
          status: "degraded",
          succeeded: false,
        }),
        CONNECTOR_HEALTH_TIMEOUT_MS,
        "MSP Central health write timed out.",
      ).catch(() => undefined);
      console.warn("Technician notification poll skipped during MSP OAuth backoff", {
        message,
      });
      return NextResponse.json({
        ok: true,
        reason: message,
        skipped: true,
      });
    }
    await withPollTimeout(
      integrationRepository.recordConnectorRead({
        connector: "msp_central",
        error: error instanceof Error ? error.message : "Unknown poll error",
        status: "unavailable",
        succeeded: false,
      }),
      CONNECTOR_HEALTH_TIMEOUT_MS,
      "MSP Central health write timed out.",
    ).catch(() => undefined);
    console.error("Technician notification poll failed", {
      message: error instanceof Error ? error.message : "Unknown poll error",
    });
    return NextResponse.json(
      { error: "Technician notification poll failed." },
      { status: 500 },
    );
  }
}

function withPollTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isMspOAuthRefreshThrottle(error: unknown): error is Error {
  return (
    error instanceof Error &&
    /MSP Central OAuth refresh is temporarily throttled/i.test(error.message)
  );
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const databaseUrl = process.env.DATABASE_URL;
  const cronSecret = process.env.CRON_SECRET;
  const appBaseUrl =
    process.env.APP_BASE_URL?.trim() || "https://command.egit.com.au";
  if (!databaseUrl || !cronSecret) {
    return NextResponse.json(
      { error: "Notification scheduling is not configured." },
      { status: 503 },
    );
  }

  try {
    const scheduler = await configureNotificationScheduler({
      databaseUrl,
      endpointUrl: `${appBaseUrl.replace(/\/$/, "")}/api/internal/notifications/poll`,
      secret: cronSecret,
    });
    return NextResponse.json({ ok: true, scheduler });
  } catch (error) {
    console.error("Technician notification scheduler setup failed", {
      message: error instanceof Error ? error.message : "Unknown setup error",
    });
    return NextResponse.json(
      { error: "Technician notification scheduler setup failed." },
      { status: 500 },
    );
  }
}
