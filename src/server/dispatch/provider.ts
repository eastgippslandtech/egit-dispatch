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
import type { MspCentralClient } from "@/server/msp-central/types";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

export async function getDispatchDashboardData(
  config: DispatchConfig = readDispatchConfig(),
  {
    database = getConfiguredDispatchDashboardDatabase(config.databaseUrl),
    mspClient,
  }: {
    database?: DispatchDashboardDatabase | null;
    mspClient?: MspCentralClient;
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
    const client = mspClient ?? createMspCentralClient(config);
    const profiles = getInitialStaffProfiles();
    let requests: DispatchDashboardData["requests"] = [];
    let mspCentralError: string | undefined;

    try {
      requests = await client.listRequests();
    } catch (error) {
      mspCentralError =
        "MSP Central is temporarily unavailable. Helpdesk requests could not be loaded.";
      console.error("MSP Central request read failed", safeError(error));
    }

    const technicians = await client
      .listTechnicians()
      .catch(() => profiles.map(staffProfileToTechnician));
    const mspData: DispatchDashboardData = {
      appointments: [],
      calendarDataSource: "mock",
      calendarError: mspCentralError,
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
      const outlookData = await buildOutlookCalendarDashboardData({
        config,
        mockData: dashboard,
        range: buildGraphWorkWeekRange(todayDateKey()),
      });

      return {
        ...outlookData,
        calendarError: joinErrors(mspCentralError, outlookData.calendarError),
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

function joinErrors(...errors: Array<string | undefined>) {
  const messages = [
    ...new Set(errors.filter((error): error is string => Boolean(error))),
  ];
  return messages.length > 0 ? messages.join(" ") : undefined;
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message }
    : { message: "Unknown MSP Central error." };
}
