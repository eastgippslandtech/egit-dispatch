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
import { buildGraphPlanningRange } from "@/server/graph/range";
import { buildOutlookCalendarDashboardData } from "@/server/graph/technician-calendars";
import { createMspCentralClient } from "@/server/msp-central/client";
import { getMspCentralFixtureDashboardData } from "@/server/msp-central/fixtures";
import type { MspCentralClient } from "@/server/msp-central/types";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";
import { getCommandCentreTrainingRequests } from "./training-data";
import { ZohoCrmClient } from "@/server/zoho-crm/client";
import { readZohoCrmConfig } from "@/server/zoho-crm/config";
import {
  enrichRequestsWithZohoCrmAddresses,
  type ZohoCrmAccountRecord,
} from "@/server/zoho-crm/address-enrichment";

type ZohoCrmAccountsClient = Pick<ZohoCrmClient, "listAccounts">;

let crmAccountCache:
  | { accounts: ZohoCrmAccountRecord[]; expiresAt: number }
  | undefined;

export async function getDispatchDashboardData(
  config: DispatchConfig = readDispatchConfig(),
  {
    database = getConfiguredDispatchDashboardDatabase(config.databaseUrl),
    crmClient,
    mspClient,
  }: {
    database?: DispatchDashboardDatabase | null;
    crmClient?: ZohoCrmAccountsClient | null;
    mspClient?: MspCentralClient;
  } = {},
): Promise<DispatchDashboardData> {
  const emptyCommandCentreData = getEmptyCommandCentreData();
  const mockData = getDispatchDesignMockData();

  if (config.dispatchDataSource === "command-centre-db") {
    if (!database) {
      throw new Error("DATABASE_URL is required for Command Centre database dispatch data.");
    }

    return addTrainingSamples(
      buildDatabaseDispatchDashboardData(await database.getDashboardData()),
      config,
    );
  }

  if (config.dispatchDataSource === "msp-central-fixture") {
    return addTrainingSamples(getMspCentralFixtureDashboardData(config), config);
  }

  if (config.dispatchDataSource === "msp-central") {
    const client = mspClient ?? createMspCentralClient(config);
    const configuredCrmClient =
      crmClient === undefined ? createConfiguredZohoCrmClient() : crmClient;
    const profiles = getInitialStaffProfiles();
    const [requestsResult, techniciansResult, crmAccountsResult] =
      await Promise.allSettled([
      client.listRequests(),
      client.listTechnicians(),
      configuredCrmClient
        ? loadZohoCrmAccounts(configuredCrmClient, crmClient !== undefined)
        : Promise.resolve([]),
    ]);
    const rawRequests =
      requestsResult.status === "fulfilled" ? requestsResult.value : [];
    const requests =
      crmAccountsResult.status === "fulfilled"
        ? enrichRequestsWithZohoCrmAddresses(
            rawRequests,
            crmAccountsResult.value,
          )
        : rawRequests;
    const technicians =
      techniciansResult.status === "fulfilled"
        ? techniciansResult.value
        : profiles.map(staffProfileToTechnician);
    const mspCentralError =
      requestsResult.status === "rejected"
        ? "MSP Central is temporarily unavailable. Helpdesk requests could not be loaded."
        : undefined;

    if (requestsResult.status === "rejected") {
      console.error(
        "MSP Central request read failed",
        safeError(requestsResult.reason),
      );
    }
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
        range: buildGraphPlanningRange(todayDateKey()),
      });

      return addTrainingSamples({
        ...outlookData,
        calendarError: joinErrors(mspCentralError, outlookData.calendarError),
        dispatchDataSource: "msp-central",
      }, config);
    }
    if (crmAccountsResult.status === "rejected") {
      console.error(
        "Zoho CRM site address enrichment failed",
        safeError(crmAccountsResult.reason),
      );
    }

    return addTrainingSamples(dashboard, config);
  }

  if (config.calendarDataSource === "mock") {
    return addTrainingSamples({
      ...emptyCommandCentreData,
      calendarDataSource: "mock",
      calendarReadOnly: false,
      calendarStatusLabel: "No Sample Data",
      dispatchDataSource: "mock",
    }, config);
  }

  const outlookData = await buildOutlookCalendarDashboardData({
    config,
    mockData,
    range: buildGraphPlanningRange(todayDateKey()),
  });

  return addTrainingSamples({
    ...outlookData,
    requests: [],
    selectedRequestId: "",
    dispatchDataSource: "mock",
  }, config);
}

function addTrainingSamples(
  dashboard: DispatchDashboardData,
  config: DispatchConfig,
): DispatchDashboardData {
  if (!config.trainingSamplesEnabled) {
    return dashboard;
  }

  const existingRequestIds = new Set(
    dashboard.requests.map((request) => request.id),
  );
  const trainingRequests = getCommandCentreTrainingRequests(todayDateKey()).filter(
    (request) => !existingRequestIds.has(request.id),
  );
  const requests = [...dashboard.requests, ...trainingRequests];

  return {
    ...dashboard,
    healthItems: buildDispatchHealthItems({
      appointments: dashboard.appointments,
      requests,
      technicians: dashboard.technicians,
    }),
    requests,
    selectedRequestId: dashboard.selectedRequestId || requests[0]?.id || "",
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

function createConfiguredZohoCrmClient() {
  const crmConfig = readZohoCrmConfig();
  return crmConfig ? new ZohoCrmClient(crmConfig) : null;
}

async function loadZohoCrmAccounts(
  client: ZohoCrmAccountsClient,
  bypassCache: boolean,
) {
  if (!bypassCache && crmAccountCache?.expiresAt && crmAccountCache.expiresAt > Date.now()) {
    return crmAccountCache.accounts;
  }

  const accounts = await client.listAccounts();
  if (!bypassCache) {
    crmAccountCache = {
      accounts,
      expiresAt: Date.now() + 5 * 60_000,
    };
  }
  return accounts;
}
