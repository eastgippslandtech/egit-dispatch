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
  return applyStoredDispatchTestSyncEvents(
    await getDispatchDashboardData(config, dependencies),
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
