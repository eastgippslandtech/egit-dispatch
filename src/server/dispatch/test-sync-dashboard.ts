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

const DASHBOARD_READ_TIMEOUT_MS = 10_000;
const OVERLAY_READ_TIMEOUT_MS = 4_000;
const SERVER_DASHBOARD_CACHE_MAX_AGE_MS = 30_000;

let serverDashboardCache:
  | { capturedAt: number; dashboard: DispatchDashboardData }
  | undefined;
let serverDashboardRefresh: Promise<DispatchDashboardData> | undefined;

type DashboardLoadOptions = {
  dashboardTimeoutMs?: number;
  overlayTimeoutMs?: number;
};

export async function getTestSyncedDispatchDashboardData(
  config?: DispatchConfig,
  dependencies?: Parameters<typeof getDispatchDashboardData>[1],
  options: DashboardLoadOptions = {},
) {
  return loadTestSyncedDispatchDashboardData(config, dependencies, options);
}

async function loadTestSyncedDispatchDashboardData(
  config?: DispatchConfig,
  dependencies?: Parameters<typeof getDispatchDashboardData>[1],
  {
    dashboardTimeoutMs = DASHBOARD_READ_TIMEOUT_MS,
    overlayTimeoutMs = OVERLAY_READ_TIMEOUT_MS,
  }: DashboardLoadOptions = {},
) {
  const resolvedConfig = config ?? readDispatchConfig();
  const dashboardPromise = loadDashboardWithServerCache({
    config: resolvedConfig,
    dependencies,
    timeoutMs: dashboardTimeoutMs,
  });

  if (!process.env.DATABASE_URL) {
    return dashboardPromise;
  }

  const eventsPromise = withTimeout(
    listDispatchTestSyncEvents(),
    overlayTimeoutMs,
    "Dispatch test sync overlay timed out.",
  ).catch((error) => {
    console.warn("Dispatch test sync overlay failed", safeError(error));
    return undefined;
  });
  const [dashboard, events] = await Promise.all([
    dashboardPromise,
    eventsPromise,
  ]);

  return filterResolvedLiveRequests(
    events ? applyDispatchTestSyncEvents(dashboard, events) : dashboard,
  );
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

async function loadDashboardWithServerCache({
  config,
  dependencies,
  timeoutMs,
}: {
  config: DispatchConfig;
  dependencies?: Parameters<typeof getDispatchDashboardData>[1];
  timeoutMs: number;
}) {
  const now = Date.now();
  if (
    config.mode === "live" &&
    serverDashboardCache &&
    now - serverDashboardCache.capturedAt <= SERVER_DASHBOARD_CACHE_MAX_AGE_MS
  ) {
    return serverDashboardCache.dashboard;
  }

  serverDashboardRefresh ??= getDispatchDashboardData(config, dependencies)
    .then((dashboard) => {
      const resolvedDashboard = resolveServerDashboardWithCache(dashboard);
      if (config.mode === "live" && shouldCacheServerDashboard(resolvedDashboard)) {
        serverDashboardCache = {
          capturedAt: Date.now(),
          dashboard: resolvedDashboard,
        };
      }
      return resolvedDashboard;
    })
    .finally(() => {
      serverDashboardRefresh = undefined;
    });

  try {
    return await withTimeout(
      serverDashboardRefresh,
      timeoutMs,
      "Command Centre live dashboard read timed out.",
    );
  } catch (error) {
    console.error("Dispatch dashboard read failed", safeError(error));
    if (serverDashboardCache) {
      return {
        ...serverDashboardCache.dashboard,
        calendarError: cacheFallbackMessage(serverDashboardCache.capturedAt),
      };
    }
    return liveDashboardFallback(config);
  }
}

function shouldCacheServerDashboard(dashboard: DispatchDashboardData) {
  return (
    Boolean(dashboard.dispatchDataSource) &&
    !dashboard.calendarError &&
    (dashboard.requests.length > 0 ||
      dashboard.appointments.length > 0 ||
      dashboard.technicians.length > 0)
  );
}

function resolveServerDashboardWithCache(
  dashboard: DispatchDashboardData,
): DispatchDashboardData {
  if (!serverDashboardCache || !dashboard.calendarError) {
    return dashboard;
  }

  const error = dashboard.calendarError.toLowerCase();
  const mspFailed = error.includes("msp central");
  const outlookFailed = error.includes("outlook calendar read failed");
  const requests = mspFailed
    ? serverDashboardCache.dashboard.requests
    : dashboard.requests;
  const appointments = outlookFailed
    ? serverDashboardCache.dashboard.appointments
    : dashboard.appointments;
  const technicians = dashboard.technicians.length
    ? dashboard.technicians
    : serverDashboardCache.dashboard.technicians;

  return {
    ...dashboard,
    appointments,
    healthItems: buildDispatchHealthItems({
      appointments,
      requests,
      technicians,
    }),
    requests,
    selectedRequestId: requests.some(
      (request) => request.id === dashboard.selectedRequestId,
    )
      ? dashboard.selectedRequestId
      : requests[0]?.id ?? "",
    technicians,
  };
}

function cacheFallbackMessage(capturedAt: number) {
  const formatted = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Melbourne",
  }).format(new Date(capturedAt));
  return `Live Command Centre data could not be loaded quickly. Showing cached Command Centre data from ${formatted}.`;
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
