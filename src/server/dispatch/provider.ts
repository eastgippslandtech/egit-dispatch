import type { DispatchConfig } from "./env";
import { todayDateKey } from "./date-scope";
import { readDispatchConfig } from "./env";
import { getDispatchDesignMockData } from "./mock-data";
import type { DispatchDashboardData } from "./types";
import { buildGraphWorkWeekRange } from "@/server/graph/range";
import { buildOutlookCalendarDashboardData } from "@/server/graph/technician-calendars";
import { getMspCentralFixtureDashboardData } from "@/server/msp-central/fixtures";

export async function getDispatchDashboardData(
  config: DispatchConfig = readDispatchConfig(),
): Promise<DispatchDashboardData> {
  const mockData = getDispatchDesignMockData();

  if (config.dispatchDataSource === "msp-central-fixture") {
    return getMspCentralFixtureDashboardData(config);
  }

  if (config.dispatchDataSource === "msp-central") {
    throw new Error("MSP Central API not configured for live dispatch data.");
  }

  if (config.calendarDataSource === "mock") {
    return {
      ...mockData,
      calendarDataSource: "mock",
      calendarReadOnly: false,
      calendarStatusLabel: "Mock Mode",
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
    dispatchDataSource: "mock",
  };
}
