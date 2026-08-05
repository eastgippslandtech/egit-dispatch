import { unstable_cache } from "next/cache";

import type { DispatchConfig } from "./env";
import { readDispatchConfig } from "./env";
import { getEmptyCommandCentreData } from "./mock-data";
import { getDispatchDashboardData } from "./provider";
import {
  applyDispatchTestSyncEvents,
  listDispatchTestSyncEvents,
} from "./test-sync";
import { buildDispatchHealthItems } from "./health";
import type { DispatchDashboardData } from "./types";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";

const DASHBOARD_READ_TIMEOUT_MS = 10_000;
const OVERLAY_READ_TIMEOUT_MS = 4_000;

type DashboardLoadOptions = {
  dashboardTimeoutMs?: number;
  overlayTimeoutMs?: number;
};

export async function getTestSyncedDispatchDashboardData(
  config?: DispatchConfig,
  dependencies?: Parameters<typeof getDispatchDashboardData>[1],
  options: DashboardLoadOptions = {},
) {
  if (
    !config &&
    !dependencies &&
    Object.keys(options).length === 0 &&
    process.env.NODE_ENV === "production"
  ) {
    return getCachedProductionDashboard();
  }

  return loadTestSyncedDispatchDashboardData(config, dependencies, options);
}

const getCachedProductionDashboard = unstable_cache(
  () => loadTestSyncedDispatchDashboardData(),
  ["command-centre-dashboard-v2"],
  { revalidate: 15, tags: ["command-centre-dashboard"] },
);

async function loadTestSyncedDispatchDashboardData(
  config?: DispatchConfig,
  dependencies?: Parameters<typeof getDispatchDashboardData>[1],
  {
    dashboardTimeoutMs = DASHBOARD_READ_TIMEOUT_MS,
    overlayTimeoutMs = OVERLAY_READ_TIMEOUT_MS,
  }: DashboardLoadOptions = {},
) {
  const resolvedConfig = config ?? readDispatchConfig();
  const dashboardPromise = withTimeout(
    getDispatchDashboardData(resolvedConfig, dependencies),
    dashboardTimeoutMs,
    "Command Centre live dashboard read timed out.",
  ).catch((error) => {
    console.error("Dispatch dashboard read failed", safeError(error));
    return liveDashboardFallback(resolvedConfig);
  });

  if (!process.env.DATABASE_URL) {
    return dashboardPromise;
  }

  const eventsPromise = withTimeout(
    listDispatchTestSyncEvents(),
    overlayTimeoutMs,
    "Dispatch test sync overlay timed out.",
  ).catch((error) => {
    console.error("Dispatch test sync overlay failed", safeError(error));
    return undefined;
  });
  const activitiesPromise = listExternalCallActivities(overlayTimeoutMs);
  const [dashboard, events, activities] = await Promise.all([
    dashboardPromise,
    eventsPromise,
    activitiesPromise,
  ]);

  const filtered = filterResolvedLiveRequests(
    events ? applyDispatchTestSyncEvents(dashboard, events) : dashboard,
  );
  return activities.length
    ? { ...filtered, appointments: [...filtered.appointments, ...activities] }
    : filtered;
}

async function listExternalCallActivities(timeoutMs: number) {
  const repository = getConfiguredYeastarRepository();
  if (!repository) return [];
  try {
    const now = new Date();
    return await withTimeout(
      repository.listExternalCallAppointments(
        new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString(),
        new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
      ),
      timeoutMs,
      "Yeastar call activity overlay timed out.",
    );
  } catch (error) {
    console.error("Yeastar call activity overlay failed", safeError(error));
    return [];
  }
}

export async function applyStoredDispatchTestSyncEvents(
  dashboard: DispatchDashboardData,
) {
  if (!process.env.DATABASE_URL) {
    return dashboard;
  }

  try {
    const events = await listDispatchTestSyncEvents();
    return applyDispatchTestSyncEvents(dashboard, events);
  } catch (error) {
    console.error("Dispatch test sync overlay failed", error);
    return dashboard;
  }
}

function filterResolvedLiveRequests(
  dashboard: DispatchDashboardData,
): DispatchDashboardData {
  if (dashboard.dispatchDataSource !== "msp-central") {
    return dashboard;
  }

  const requests = dashboard.requests.filter(
    (request) => request.status !== "Resolved",
  );

  if (requests.length === dashboard.requests.length) {
    return dashboard;
  }

  const selectedRequestId = requests.some(
    (request) => request.id === dashboard.selectedRequestId,
  )
    ? dashboard.selectedRequestId
    : requests[0]?.id ?? "";

  return {
    ...dashboard,
    healthItems: buildDispatchHealthItems({
      appointments: dashboard.appointments,
      requests,
      technicians: dashboard.technicians,
    }),
    requests,
    selectedRequestId,
  };
}

function liveDashboardFallback(config: DispatchConfig): DispatchDashboardData {
  const fallback = getEmptyCommandCentreData();
  return {
    ...fallback,
    calendarDataSource:
      config.calendarDataSource === "outlook" ? "outlook" : "mock",
    calendarError:
      "Live Command Centre data could not be loaded quickly. Showing cached Command Centre data when available.",
    calendarReadOnly: config.mode !== "live",
    calendarStatusLabel:
      config.calendarDataSource === "outlook"
        ? config.mode === "live"
          ? "Outlook Read/Write"
          : "Outlook Read Only"
        : "No Sample Data",
    dispatchDataSource: config.dispatchDataSource,
    healthItems: buildDispatchHealthItems(fallback),
    timezone: config.timezone,
  };
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message }
    : { message: "Unknown dispatch dashboard error." };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;

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
