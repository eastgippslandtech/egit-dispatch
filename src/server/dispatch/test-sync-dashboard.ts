import type { DispatchConfig } from "./env";
import { getDispatchDashboardData } from "./provider";
import {
  applyDispatchTestSyncEvents,
  listDispatchTestSyncEvents,
} from "./test-sync";
import type { DispatchDashboardData } from "./types";

export async function getTestSyncedDispatchDashboardData(
  config?: DispatchConfig,
  dependencies?: Parameters<typeof getDispatchDashboardData>[1],
) {
  const dashboardPromise = getDispatchDashboardData(config, dependencies);

  if (!process.env.DATABASE_URL) {
    return dashboardPromise;
  }

  const eventsPromise = listDispatchTestSyncEvents().catch((error) => {
    console.error("Dispatch test sync overlay failed", error);
    return undefined;
  });
  const [dashboard, events] = await Promise.all([
    dashboardPromise,
    eventsPromise,
  ]);

  return events ? applyDispatchTestSyncEvents(dashboard, events) : dashboard;
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
