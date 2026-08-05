import { buildDispatchHealthItems } from "@/server/dispatch/health";
import type { DispatchDashboardData } from "@/server/dispatch/types";

export const DASHBOARD_CACHE_KEY = "command-centre:last-healthy-dashboard:v1";
const MSP_UNAVAILABLE = "msp central is temporarily unavailable";
const OUTLOOK_UNAVAILABLE = "outlook calendar read failed";
const LIVE_DASHBOARD_TIMEOUT = "live command centre data could not be loaded quickly";

export const DASHBOARD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export type CachedDashboard = {
  dashboard: DispatchDashboardData;
  savedAt: string;
  version: 1;
};

type DashboardStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export function shouldCacheDashboard(dashboard: DispatchDashboardData) {
  return (
    dashboard.dispatchDataSource === "msp-central" &&
    !dashboard.calendarError &&
    (dashboard.requests.length > 0 || dashboard.appointments.length > 0)
  );
}

export function resolveDashboardWithCache(
  incoming: DispatchDashboardData,
  cached: CachedDashboard | null,
) {
  if (!cached) return incoming;

  const error = incoming.calendarError?.toLowerCase() ?? "";
  const liveDashboardTimedOut = error.includes(LIVE_DASHBOARD_TIMEOUT);
  const mspFailed = error.includes(MSP_UNAVAILABLE);
  const outlookFailed = error.includes(OUTLOOK_UNAVAILABLE);
  if (!liveDashboardTimedOut && !mspFailed && !outlookFailed) return incoming;

  const requests =
    liveDashboardTimedOut || mspFailed ? cached.dashboard.requests : incoming.requests;
  const appointments = liveDashboardTimedOut || outlookFailed
    ? cached.dashboard.appointments
    : incoming.appointments;
  const technicians = incoming.technicians.length
    ? incoming.technicians
    : cached.dashboard.technicians;
  const selectedRequestId = requests.some(
    (request) => request.id === incoming.selectedRequestId,
  )
    ? incoming.selectedRequestId
    : requests[0]?.id ?? "";

  return {
    ...incoming,
    appointments,
    calendarError: appendCacheNotice(incoming.calendarError, cached.savedAt),
    healthItems: buildDispatchHealthItems({
      appointments,
      requests,
      technicians,
    }),
    requests,
    selectedRequestId,
    technicians,
  };
}

export function readCachedDashboard(
  storage: DashboardStorage,
  now = Date.now(),
): CachedDashboard | null {
  try {
    const raw = storage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedDashboard>;
    const savedAt = Date.parse(parsed.savedAt ?? "");
    if (
      parsed.version !== 1 ||
      !Number.isFinite(savedAt) ||
      now - savedAt > DASHBOARD_CACHE_MAX_AGE_MS ||
      !isDashboardData(parsed.dashboard)
    ) {
      storage.removeItem(DASHBOARD_CACHE_KEY);
      return null;
    }
    return parsed as CachedDashboard;
  } catch {
    return null;
  }
}

export function writeCachedDashboard(
  storage: DashboardStorage,
  dashboard: DispatchDashboardData,
  savedAt = new Date().toISOString(),
) {
  try {
    storage.setItem(
      DASHBOARD_CACHE_KEY,
      JSON.stringify({ dashboard, savedAt, version: 1 } satisfies CachedDashboard),
    );
  } catch {
    // A full or unavailable browser store must never break the live board.
  }
}

export function clearCachedDashboard(storage: DashboardStorage) {
  try {
    storage.removeItem(DASHBOARD_CACHE_KEY);
  } catch {
    // Sign-out should continue even when browser storage is unavailable.
  }
}

function isDashboardData(value: unknown): value is DispatchDashboardData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DispatchDashboardData>;
  return (
    Array.isArray(candidate.appointments) &&
    Array.isArray(candidate.healthItems) &&
    Array.isArray(candidate.requests) &&
    Array.isArray(candidate.technicians) &&
    typeof candidate.selectedDateLabel === "string" &&
    typeof candidate.selectedRequestId === "string" &&
    typeof candidate.timezone === "string"
  );
}

function appendCacheNotice(error: string | undefined, savedAt: string) {
  const formatted = new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Australia/Melbourne",
  }).format(new Date(savedAt));
  return [error, `Showing cached Command Centre data from ${formatted}.`]
    .filter(Boolean)
    .join(" ");
}
