import type { DispatchConfig } from "./env";
import { todayDateKey } from "./date-scope";
import { readDispatchConfig } from "./env";
import { buildDispatchHealthItems } from "./health";
import { getDispatchDesignMockData, getEmptyCommandCentreData } from "./mock-data";
import {
  buildDatabaseDispatchDashboardData,
  getConfiguredDispatchDashboardDatabase,
  type DispatchDashboardDatabase,
} from "./database";
import type { DispatchDashboardData } from "./types";
import { buildGraphWorkWeekRange } from "@/server/graph/range";
import { buildOutlookCalendarDashboardData } from "@/server/graph/technician-calendars";
import { createMspCentralClient } from "@/server/msp-central/client";
import { getMspCentralFixtureDashboardData } from "@/server/msp-central/fixtures";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

export async function getDispatchDashboardData(
  config: DispatchConfig = readDispatchConfig(),
  {
    database = getConfiguredDispatchDashboardDatabase(config.databaseUrl),
  }: {
    database?: DispatchDashboardDatabase | null;
  } = {},
): Promise<DispatchDashboardData> {
  const emptyCommandCentreData = getEmptyCommandCentreData();
  const mockData = getDispatchDesignMockData();

  if (config.dispatchDataSource === "command-centre-db") {
    if (!database) {
      throw new Error("DATABASE_URL is required for Command Centre database dispatch data.");
    }

    return buildDatabaseDispatchDashboardData(await database.getDashboardData());
  }

  if (config.dispatchDataSource === "msp-central-fixture") {
    return getMspCentralFixtureDashboardData(config);
  }

  if (config.dispatchDataSource === "msp-central") {
    const client = createMspCentralClient(config);
    const [requests, technicians] = await Promise.all([
      client.listRequests(),
      client
        .listTechnicians()
        .catch(() => getInitialStaffProfiles().map(staffProfileToTechnician)),
    ]);
    const mspData: DispatchDashboardData = {
      appointments: [],
      calendarDataSource: "mock",
      calendarReadOnly: false,
      calendarStatusLabel: "MSP Central",
      dispatchDataSource: "msp-central",
      healthItems: [],
      requests,
      selectedDateLabel: todayDateKey(),
      selectedRequestId: requests[0]?.id ?? "",
      technicians,
      timezone: config.timezone,
    };
    const dashboard = {
      ...mspData,
      healthItems: buildDispatchHealthItems(mspData),
    };

    if (config.calendarDataSource === "outlook") {
      return {
        ...(await buildOutlookCalendarDashboardData({
          config,
          mockData: dashboard,
          range: buildGraphWorkWeekRange(todayDateKey()),
        })),
        dispatchDataSource: "msp-central",
      };
    }

    return dashboard;
  }

  if (config.calendarDataSource === "mock") {
    return {
      ...emptyCommandCentreData,
      calendarDataSource: "mock",
      calendarReadOnly: false,
      calendarStatusLabel: "No Sample Data",
      dispatchDataSource: "mock",
    };
  }

  const outlookData = await buildOutlookCalendarDashboardData({
    config,
    mockData,
    range: buildGraphWorkWeekRange(todayDateKey()),
  });

  return {
    ...outlookData,
    requests: [],
    selectedRequestId: "",
    dispatchDataSource: "mock",
  };
}
