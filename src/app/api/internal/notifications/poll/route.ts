import { NextResponse } from "next/server";

import { readDispatchConfig } from "@/server/dispatch/env";
import { createMspCentralClient } from "@/server/msp-central/client";
import { processTechnicianNotifications } from "@/server/notifications/poll";
import { getConfiguredNotificationRepository } from "@/server/notifications/repository";
import { configureNotificationScheduler } from "@/server/notifications/scheduler";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  return Boolean(
    cronSecret &&
      request.headers.get("authorization") === `Bearer ${cronSecret}`,
  );
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
    const result = await processTechnicianNotifications({
      client: createMspCentralClient(config),
      repository,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Technician notification poll failed", {
      message: error instanceof Error ? error.message : "Unknown poll error",
    });
    return NextResponse.json(
      { error: "Technician notification poll failed." },
      { status: 500 },
    );
  }
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
