import type { DispatchConfig } from "./env";
import { todayDateKey } from "./date-scope";
import { readDispatchConfig } from "./env";
import { buildDispatchHealthItems } from "./health";
import { mergeMspCentralScheduleWithOutlook } from "./live-schedule";
import { getDispatchDesignMockData, getEmptyCommandCentreData } from "./mock-data";
import {
  buildDatabaseDispatchDashboardData,
  getConfiguredDispatchDashboardDatabase,
  type DispatchDashboardDatabase,
} from "./database";
import type { Appointment, DispatchDashboardData, DispatchRequest } from "./types";
import { buildGraphPlanningRange } from "@/server/graph/range";
import { buildOutlookCalendarDashboardData } from "@/server/graph/technician-calendars";
import { fingerprintPayload } from "@/server/integrations/fingerprint";
import {
  cancelledScheduleCleanupOperation,
  orphanedOutlookCleanupOperation,
} from "@/server/integrations/operations";
import { createPostgresIntegrationRepository } from "@/server/integrations/repository";
import type { EnqueueIntegrationOperation } from "@/server/integrations/types";
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
type OutlookLoader = typeof buildOutlookCalendarDashboardData;
type IntegrationOperationRepository = {
  enqueue(input: EnqueueIntegrationOperation): Promise<unknown>;
};

const OUTLOOK_DASHBOARD_TIMEOUT_MS = 12_000;
const CRM_ENRICHMENT_TIMEOUT_MS = 8_000;
const MSP_REQUESTS_TIMEOUT_MS = 7_000;
const MSP_TECHNICIANS_TIMEOUT_MS = 2_500;
const CANCELLED_OUTLOOK_CLEANUP_TIMEOUT_MS = 1_500;

let crmAccountCache:
  | { accounts: ZohoCrmAccountRecord[]; expiresAt: number }
  | undefined;

export async function getDispatchDashboardData(
  config: DispatchConfig = readDispatchConfig(),
  {
    database = getConfiguredDispatchDashboardDatabase(config.databaseUrl),
    crmClient,
    integrationRepository,
    mspClient,
    outlookLoader = buildOutlookCalendarDashboardData,
  }: {
    database?: DispatchDashboardDatabase | null;
    crmClient?: ZohoCrmAccountsClient | null;
    integrationRepository?: IntegrationOperationRepository | null;
    mspClient?: MspCentralClient;
    outlookLoader?: OutlookLoader;
  } = {},
): Promise<DispatchDashboardData> {
  const emptyCommandCentreData = getEmptyCommandCentreData();
  const mockData = getDispatchDesignMockData();

  if (config.dispatchDataSource === "command-centre-db") {
    if (!database) {
      throw new Error("DATABASE_URL is required for Command Centre database dispatch data.");
    }

    const configuredCrmClient =
      crmClient === undefined ? createConfiguredZohoCrmClient() : crmClient;
    const databaseDashboard = buildDatabaseDispatchDashboardData(
      await database.getDashboardData(),
    );

    return addTrainingSamples(
      await enrichDashboardWithZohoCrmAddresses(databaseDashboard, {
        bypassCache: crmClient !== undefined,
        crmClient: configuredCrmClient,
      }),
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
    const fallbackTechnicians = profiles.map(staffProfileToTechnician);
    const outlookPromise =
      config.calendarDataSource === "outlook"
        ? withProviderTimeout(
            outlookLoader({
              config,
              mockData: {
                ...emptyCommandCentreData,
                technicians: fallbackTechnicians,
                timezone: config.timezone,
              },
              range: buildGraphPlanningRange(todayDateKey()),
            }),
            OUTLOOK_DASHBOARD_TIMEOUT_MS,
            "Outlook calendar read timed out during dashboard load.",
          )
        : Promise.resolve(undefined);
    const [
      requestsResult,
      techniciansResult,
      crmAccountsResult,
      outlookResult,
    ] = await Promise.allSettled([
      withProviderTimeout(
        client.listRequests({ cacheOnly: true }),
        MSP_REQUESTS_TIMEOUT_MS,
        "MSP Central request list timed out.",
      ),
      withProviderTimeout(
        client.listTechnicians(),
        MSP_TECHNICIANS_TIMEOUT_MS,
        "MSP Central technician list timed out.",
      ),
      configuredCrmClient
        ? withProviderTimeout(
            loadZohoCrmAccounts(configuredCrmClient, crmClient !== undefined),
            CRM_ENRICHMENT_TIMEOUT_MS,
            "Zoho CRM address enrichment timed out.",
          )
        : Promise.resolve([]),
      outlookPromise,
    ]);
    const rawRequests =
      requestsResult.status === "fulfilled" ? requestsResult.value : [];
    const requests =
      crmAccountsResult.status === "fulfilled"
        ? enrichRequestsWithZohoCrmAddresses(rawRequests, crmAccountsResult.value)
        : rawRequests;
    const technicians =
      techniciansResult.status === "fulfilled"
        ? techniciansResult.value
        : fallbackTechnicians;
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
    if (crmAccountsResult.status === "rejected") {
      console.error(
        "Zoho CRM site address enrichment failed",
        safeError(crmAccountsResult.reason),
      );
    }
    const mspSchedule = mergeMspCentralScheduleWithOutlook(requests, []);
    const mspData: DispatchDashboardData = {
      appointments: mspSchedule.appointments,
      calendarDataSource: "mock",
      calendarError: mspCentralError,
      calendarReadOnly: false,
      calendarStatusLabel: "MSP Central",
      dispatchDataSource: "msp-central",
      healthItems: [],
      requests: mspSchedule.requests,
      selectedDateLabel: todayDateKey(),
      selectedRequestId: mspSchedule.requests[0]?.id ?? "",
      technicians,
      timezone: config.timezone,
    };
    const dashboard = {
      ...mspData,
      healthItems: buildDispatchHealthItems(mspData),
    };

    if (config.calendarDataSource === "outlook") {
      const outlookData =
        outlookResult.status === "fulfilled" && outlookResult.value
          ? outlookResult.value
          : {
              ...dashboard,
              calendarDataSource: "outlook" as const,
              calendarError:
                "Outlook calendar read failed. The last Helpdesk data remains available.",
              calendarReadOnly: config.mode !== "live",
              calendarStatusLabel:
                config.mode === "live" ? "Outlook Read/Write" : "Outlook Read Only",
            };
      const linkedSchedule = mergeMspCentralScheduleWithOutlook(
        requests,
        outlookData.appointments,
        { pruneOrphanedOutlookEvents: requestsResult.status === "fulfilled" },
      );
      await queueCancelledOutlookCleanup(linkedSchedule.cancelledOutlookEvents, {
        config,
        repository: integrationRepository,
      });
      await queueOrphanedOutlookCleanup(linkedSchedule.orphanedOutlookEvents, {
        config,
        repository: integrationRepository,
      });
      const combined = {
        ...dashboard,
        appointments: linkedSchedule.appointments,
        calendarDataSource: outlookData.calendarDataSource,
        calendarError: joinErrors(mspCentralError, outlookData.calendarError),
        calendarReadOnly: outlookData.calendarReadOnly,
        calendarStatusLabel: outlookData.calendarStatusLabel,
        requests: linkedSchedule.requests,
      };

      return addTrainingSamples({
        ...combined,
        dispatchDataSource: "msp-central",
        healthItems: buildDispatchHealthItems(combined),
      }, config);
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

async function queueOrphanedOutlookCleanup(
  events: ReturnType<
    typeof mergeMspCentralScheduleWithOutlook
  >["orphanedOutlookEvents"],
  {
    config,
    repository,
  }: {
    config: DispatchConfig;
    repository?: IntegrationOperationRepository | null;
  },
) {
  if (config.mode !== "live" || events.length === 0) return;
  const resolvedRepository =
    repository ??
    (config.databaseUrl
      ? createPostgresIntegrationRepository({ databaseUrl: config.databaseUrl })
      : null);
  if (!resolvedRepository) return;

  try {
    await withProviderTimeout(
      Promise.all(
        orphanedEventGroups(events).map((group) =>
          resolvedRepository.enqueue(
            orphanedOutlookCleanupOperation({
              actorEmail: "system@command.egit.com.au",
              events: group.events,
              idempotencyKey: `orphaned-outlook:${group.requestNumber}:${fingerprintPayload(group.events)}`,
            }),
          ),
        ),
      ),
      CANCELLED_OUTLOOK_CLEANUP_TIMEOUT_MS,
      "Orphaned Outlook cleanup queue timed out.",
    );
  } catch (error) {
    console.error("Orphaned Outlook cleanup queue failed", safeError(error));
  }
}

async function queueCancelledOutlookCleanup(
  events: ReturnType<
    typeof mergeMspCentralScheduleWithOutlook
  >["cancelledOutlookEvents"],
  {
    config,
    repository,
  }: {
    config: DispatchConfig;
    repository?: IntegrationOperationRepository | null;
  },
) {
  if (config.mode !== "live" || events.length === 0) return;
  const resolvedRepository =
    repository ??
    (config.databaseUrl
      ? createPostgresIntegrationRepository({ databaseUrl: config.databaseUrl })
      : null);
  if (!resolvedRepository) return;

  try {
    await withProviderTimeout(
      Promise.all(
        cancelledEventGroups(events).map((group) =>
          resolvedRepository.enqueue(
            cancelledScheduleCleanupOperation({
              actorEmail: "system@command.egit.com.au",
              events: group.events,
              idempotencyKey: `cancelled-schedule:${group.requestId}:${fingerprintPayload(group.events)}`,
              requestId: group.requestId,
              requestNumber: group.requestNumber,
            }),
          ),
        ),
      ),
      CANCELLED_OUTLOOK_CLEANUP_TIMEOUT_MS,
      "Cancelled Outlook cleanup queue timed out.",
    );
  } catch (error) {
    console.error("Cancelled Outlook cleanup queue failed", safeError(error));
  }
}

function orphanedEventGroups(
  events: ReturnType<
    typeof mergeMspCentralScheduleWithOutlook
  >["orphanedOutlookEvents"],
) {
  const groups = new Map<
    string,
    {
      events: Array<{
        eventId: string;
        requestNumber: string;
        technicianId?: string;
        userPrincipalName: string;
      }>;
      requestNumber: string;
    }
  >();
  for (const event of events) {
    const existing =
      groups.get(event.requestNumber) ??
      {
        events: [],
        requestNumber: event.requestNumber,
      };
    existing.events.push({
      eventId: event.eventId,
      requestNumber: event.requestNumber,
      technicianId: event.technicianId,
      userPrincipalName: event.userPrincipalName,
    });
    groups.set(event.requestNumber, existing);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    events: group.events.sort((first, second) =>
      `${first.userPrincipalName}:${first.eventId}`.localeCompare(
        `${second.userPrincipalName}:${second.eventId}`,
      ),
    ),
  }));
}

function cancelledEventGroups(
  events: ReturnType<
    typeof mergeMspCentralScheduleWithOutlook
  >["cancelledOutlookEvents"],
) {
  const groups = new Map<
    string,
    {
      events: Array<{
        eventId: string;
        technicianId?: string;
        userPrincipalName: string;
      }>;
      requestId: string;
      requestNumber: string;
    }
  >();
  for (const event of events) {
    const existing =
      groups.get(event.requestId) ??
      {
        events: [],
        requestId: event.requestId,
        requestNumber: event.requestNumber,
      };
    existing.events.push({
      eventId: event.eventId,
      technicianId: event.technicianId,
      userPrincipalName: event.userPrincipalName,
    });
    groups.set(event.requestId, existing);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    events: group.events.sort((first, second) =>
      `${first.userPrincipalName}:${first.eventId}`.localeCompare(
        `${second.userPrincipalName}:${second.eventId}`,
      ),
    ),
  }));
}

async function enrichDashboardWithZohoCrmAddresses(
  dashboard: DispatchDashboardData,
  {
    bypassCache,
    crmClient,
  }: {
    bypassCache: boolean;
    crmClient: ZohoCrmAccountsClient | null;
  },
): Promise<DispatchDashboardData> {
  if (!crmClient || dashboard.requests.length === 0) {
    return dashboard;
  }

  try {
    const accounts = await withProviderTimeout(
      loadZohoCrmAccounts(crmClient, bypassCache),
      CRM_ENRICHMENT_TIMEOUT_MS,
      "Zoho CRM address enrichment timed out.",
    );
    const requests = enrichRequestsWithZohoCrmAddresses(dashboard.requests, accounts);
    const appointments = applyRequestAddressesToAppointments(
      dashboard.appointments,
      requests,
    );
    const enrichedDashboard = {
      ...dashboard,
      appointments,
      requests,
    };

    return {
      ...enrichedDashboard,
      healthItems: buildDispatchHealthItems(enrichedDashboard),
      selectedRequestId:
        enrichedDashboard.selectedRequestId || enrichedDashboard.requests[0]?.id || "",
    };
  } catch (error) {
    console.error("Zoho CRM site address enrichment failed", safeError(error));
    return dashboard;
  }
}

function applyRequestAddressesToAppointments(
  appointments: readonly Appointment[],
  requests: readonly DispatchRequest[],
) {
  const requestsById = new Map(requests.map((request) => [request.id, request]));

  return appointments.map((appointment) => {
    const request = appointment.requestId
      ? requestsById.get(appointment.requestId)
      : undefined;
    if (!request) {
      return appointment;
    }

    return {
      ...appointment,
      customer:
        request.customer === "Unknown customer"
          ? appointment.customer
          : request.customer,
      helpdeskUrl: request.helpdeskUrl ?? appointment.helpdeskUrl,
      siteAddress: request.siteAddress ?? appointment.siteAddress,
      siteArea: request.siteArea ?? appointment.siteArea,
      siteTown: request.siteTown ?? appointment.siteTown,
    };
  });
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

function withProviderTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) {
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
