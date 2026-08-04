import { unstable_cache } from "next/cache";

import type { DispatchConfig } from "./env";
import { getDispatchDashboardData } from "./provider";
import {
  applyDispatchTestSyncEvents,
  listDispatchTestSyncEvents,
} from "./test-sync";
import { buildDispatchHealthItems } from "./health";
import type { DispatchDashboardData } from "./types";
import { getConfiguredYeastarRepository } from "@/server/yeastar/repository";

export async function getTestSyncedDispatchDashboardData(
  config?: DispatchConfig,
  dependencies?: Parameters<typeof getDispatchDashboardData>[1],
) {
  if (!config && !dependencies && process.env.NODE_ENV === "production") {
    return getCachedProductionDashboard();
  }

  return loadTestSyncedDispatchDashboardData(config, dependencies);
}

const getCachedProductionDashboard = unstable_cache(
  () => loadTestSyncedDispatchDashboardData(),
  ["command-centre-dashboard-v2"],
  { revalidate: 15, tags: ["command-centre-dashboard"] },
);

async function loadTestSyncedDispatchDashboardData(
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
  const activitiesPromise = listExternalCallActivities();
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

async function listExternalCallActivities() {
  const repository = getConfiguredYeastarRepository();
  if (!repository) return [];
  try {
    const now = new Date();
    return await repository.listExternalCallAppointments(
      new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString(),
      new Date(now.getTime() + 24 * 60 * 60_000).toISOString(),
    );
  } catch (error) {
    console.error("Yeastar call activity overlay failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
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
