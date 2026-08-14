import type { DispatchConfig } from "@/server/dispatch/env";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

import { MspCentralConfigurationError } from "./errors";
import {
  loadFixtureRequestDetail,
  loadMspCentralFixtureResponses,
} from "./fixtures";
import {
  mapMspCentralRequestNotifications,
  mapMspCentralRequestNotes,
  mapMspCentralRequestWorklogs,
  mapMspCentralRequests,
  mapMspCentralTechnicians,
  isCustomerConversationNotification,
} from "./mappers";
import {
  getConfiguredMspRequestSnapshotStore,
  loadCachedMspRequestsSnapshot,
  loadMspRequestsWithSnapshot,
  refreshMspRequestsSnapshot,
} from "./request-snapshot";
import {
  buildMspOAuthCacheKey,
  MspOAuthAccessTokenCoordinator,
} from "./token-cache";
import { getConfiguredMspOAuthTokenStore } from "./token-store";
import type {
  MspCentralClient,
  MspCentralCreateCustomerGroupInput,
  MspCentralCreateCustomerInput,
  MspCentralContactListResponse,
  MspCentralRequestDetailResponse,
  MspCentralNamedOption,
  MspCentralNamedOptionListResponse,
  MspCentralRequestListResponse,
  MspCentralRequestNotificationDetailResponse,
  MspCentralRequestNoteListResponse,
  MspCentralRequestNotificationListResponse,
  MspCentralRequestUpdate,
  MspCentralRequestWorklogListResponse,
  MspCentralRawNotification,
  MspCentralRawContact,
  MspCentralRawCustomer,
  MspCentralRawRequest,
  MspCentralCustomerListResponse,
  MspCentralCustomerLookup,
  MspCentralRequestFormOptions,
  MspCentralTechnicianListResponse,
} from "./types";
import { roundWorklogMinutes } from "@/server/worklogs/time";

const MSP_REQUEST_TIMEOUT_MS = 12_000;
const MSP_WRITE_REQUEST_TIMEOUT_MS = 45_000;
const MSP_REQUEST_PAGE_SIZE = 50;
const MSP_REQUEST_MAX_PAGES = 2;
const MSP_CUSTOMER_LOOKUP_MAX_PAGES = 10;
const MSP_OPTION_LOOKUP_PAGE_SIZE = 100;
const MSP_OPTION_LOOKUP_MAX_PAGES = 5;
const MSP_CUSTOMER_DETAIL_TIMEOUT_MS = 5_000;

type MspCentralActionResponse = {
  account?: MspCentralRawCustomer;
  customer_group?: MspCentralNamedOption;
  customer?: MspCentralRawCustomer;
  request?: {
    id?: string | number | null;
    request_number?: string | null;
  };
  response_status?:
    | { status?: string | null }
    | Array<{ status?: string | null }>;
};

type MspCentralNotificationRecipient =
  | { email_id: string }
  | { id: string };

type MspCentralReplyNotification = {
  description: string;
  sender?: { id: string };
  subject: string;
  to: MspCentralNotificationRecipient[];
  type: "reply";
};

type MspCentralCustomerDetailResponse = {
  account?: NonNullable<MspCentralRawRequest["account"]>;
  customer?: NonNullable<MspCentralRawRequest["account"]>;
};

let accessTokenCoordinator: MspOAuthAccessTokenCoordinator | undefined;
const customerDetailCache = new Map<
  string,
  { account: NonNullable<MspCentralRawRequest["account"]>; expiresAt: number }
>();
const requestFormOptionsCache = new Map<
  string,
  { expiresAt: number; options: MspCentralRequestFormOptions }
>();
const customerLookupCache = new Map<
  string,
  { customers: MspCentralCustomerLookup[]; expiresAt: number }
>();

export function createMspCentralClient(config: DispatchConfig): MspCentralClient {
  if (config.dispatchDataSource === "msp-central-fixture") {
    return createMspCentralFixtureClient(config);
  }

  return createMspCentralLiveClient(config);
}

export function resetMspCentralAccessTokenCacheForTests() {
  accessTokenCoordinator?.reset();
  accessTokenCoordinator = undefined;
  customerDetailCache.clear();
  customerLookupCache.clear();
  requestFormOptionsCache.clear();
}

function createMspCentralFixtureClient(config: DispatchConfig): MspCentralClient {
  const fixtures = loadMspCentralFixtureResponses();
  const profiles = getInitialStaffProfiles();

  return {
    async addRequestReply() {
      return undefined;
    },
    async addRequestWorklog() {
      return undefined;
    },
    async assignRequest() {
      return undefined;
    },
    async clearRequestSchedule() {
      return undefined;
    },
    async getRequest(requestId) {
      return (await this.listRequests()).find(
        (request) => request.id === requestId || request.requestNumber === requestId,
      ) ?? loadFixtureRequestDetail();
    },
    async getRequestContext(requestId) {
      const request = await this.getRequest(requestId);
      if (!request) {
        throw new MspCentralConfigurationError("MSP Central request was not found.");
      }

      return {
        customerResponses: [],
        internalNotes: [],
        request,
        worklogs: [],
      };
    },
    async listRequestNotes() {
      return [];
    },
    async listRequestNotifications() {
      return [];
    },
    async listRequestFormOptions() {
      return defaultRequestFormOptions();
    },
    async createCustomerGroup(input: MspCentralCreateCustomerGroupInput) {
      return { name: input.name };
    },
    async listRequestWorklogs() {
      return [];
    },
    async getTechnician(technicianId) {
      return (await this.listTechnicians()).find(
        (technician) => technician.id === technicianId,
      );
    },
    async listContacts() {
      return [];
    },
    async createCustomer(input: MspCentralCreateCustomerInput) {
      return customerLookupFromRaw({
        address: input.address,
        city: input.city,
        country: input.country,
        customer_group: input.customerGroup
          ? [{ name: input.customerGroup }]
          : undefined,
        email_id: input.email,
        name: input.name,
        phone: input.phone,
        postal_code: input.postalCode,
        state: input.state,
      });
    },
    async listCustomers(query) {
      const rows = (fixtures.requestList.requests ?? []).map((request) =>
        customerLookupFromRaw({
          ...(typeof request.customer === "object" ? request.customer : {}),
          ...request.account,
          name:
            request.account?.name ??
            (typeof request.customer === "string" ? request.customer : undefined),
        }),
      );
      return filterCustomerLookups(uniqueCustomerLookups(rows), query).slice(0, 12);
    },
    async listRequests() {
      return mapMspCentralRequests(fixtures.requestList.requests, {
        profiles,
        requestWebBaseUrl: config.mspCentral.requestWebBaseUrl,
        sourceSystem: "msp-central-fixture",
      });
    },
    async listSites() {
      return (fixtures.requestList.requests ?? []).map((request) => ({
        id: String(request.site?.name ?? request.site_name ?? "unknown"),
        name: String(request.site?.name ?? request.site_name ?? "Unknown site"),
      }));
    },
    async listTechnicians() {
      const technicians = mapMspCentralTechnicians(
        fixtures.technicianList.technicians,
        profiles,
      );
      return technicians.length > 0
        ? technicians
        : profiles.map(staffProfileToTechnician);
    },
    async mergeRequests() {
      return undefined;
    },
    async refreshAccessToken() {
      return "fixture-access-token";
    },
    async updateRequestSchedule() {
      return undefined;
    },
    async updateRequestStatus() {
      return undefined;
    },
  };
}

function createMspCentralLiveClient(config: DispatchConfig): MspCentralClient {
  const configured = Boolean(
    config.mspCentral.baseUrl &&
      config.mspCentral.portal &&
      config.mspCentral.clientId &&
      config.mspCentral.clientSecret &&
      config.mspCentral.refreshToken,
  );
  const assertConfigured = () => {
    if (configured) {
      return;
    }

    throw new MspCentralConfigurationError(
      "MSP Central API not configured.",
    );
  };
  const apiRoot = buildMspCentralApiRoot(config);
  const getAccessToken = () => getCachedAccessToken(config);
  const requestSnapshotStore = getConfiguredMspRequestSnapshotStore({
    portal: config.mspCentral.portal,
  });
  const resolveReplySender = async (actorEmail?: string) => {
    const normalizedActorEmail = cleanEmail(actorEmail);
    if (!normalizedActorEmail) {
      return undefined;
    }

    const payload = await getJson<MspCentralTechnicianListResponse>(
      `${apiRoot}/technicians`,
    );
    const rawTechnician = (payload.technicians ?? []).find((technician) => {
      const technicianEmail =
        cleanEmail(technician.email_id) ?? cleanEmail(technician.email);
      return technicianEmail === normalizedActorEmail;
    });
    const rawTechnicianId = String(rawTechnician?.id ?? "").trim();
    if (rawTechnicianId) {
      return { id: rawTechnicianId };
    }

    const mappedTechnician = mapMspCentralTechnicians(
      payload.technicians ?? [],
      getInitialStaffProfiles(),
    ).find((technician) =>
      [
        technician.mspCentralEmail,
        technician.outlookEmail,
        technician.outlookUserPrincipalName,
        technician.zohoEmail,
      ]
        .map(cleanEmail)
        .includes(normalizedActorEmail),
    );
    const mappedTechnicianId = String(
      mappedTechnician?.mspCentralTechnicianId ?? "",
    ).trim();
    return mappedTechnicianId ? { id: mappedTechnicianId } : undefined;
  };

  return {
    async addRequestReply(input) {
      assertConfigured();
      const requestPayload = await getJson<MspCentralRequestDetailResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
      );
      const request = requestPayload.request;
      const requesterEmail =
        cleanEmail(request?.requester?.email_id) ??
        cleanEmail(request?.requester?.email) ??
        cleanEmail(request?.requester_email);
      if (!request || !requesterEmail) {
        throw new MspCentralConfigurationError(
          "MSP Central requester email is unavailable for this reply.",
        );
      }
      const requestReference = String(
        request.request_number ?? request.id ?? input.requestId,
      ).trim();
      const requestSubject = String(request.subject ?? "Helpdesk request").trim();
      const sender = await resolveReplySender(input.actorEmail);
      const notificationUrl =
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}/notifications`;
      const notification: MspCentralReplyNotification = {
        description: input.description,
        ...(sender ? { sender } : {}),
        subject: `Re: [Request ID :##${requestReference}##] : ${requestSubject}`,
        to: [{ email_id: requesterEmail }],
        type: "reply",
      };
      const postReply = (body: MspCentralReplyNotification) =>
        requestJson<MspCentralActionResponse>(notificationUrl, {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              notification: body,
            }),
          }),
          method: "POST",
        });

      let payload: MspCentralActionResponse;
      try {
        payload = await postReply(notification);
      } catch (error) {
        const requesterId = String(request.requester?.id ?? "").trim();
        if (!isMspRecipientAddressError(error) || !requesterId) {
          throw error;
        }
        payload = await postReply({
          ...notification,
          to: [{ id: requesterId }],
        });
      }
      if (!mspCentralActionSucceeded(payload)) {
        throw new MspCentralConfigurationError(
          "MSP Central email reply failed.",
        );
      }
    },
    async addRequestNote(input) {
      assertConfigured();
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}/notes`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              request_note: {
                add_to_linked_requests: false,
                description: input.description,
                mark_first_response: false,
                notify_technician: false,
                show_to_requester: input.visibility === "customer",
              },
            }),
          }),
          method: "POST",
        },
      );
      if (!mspCentralActionSucceeded(payload)) {
        throw new MspCentralConfigurationError(
          "MSP Central communication save failed.",
        );
      }
    },
    async addRequestWorklog(input) {
      assertConfigured();
      const durationMinutes = roundWorklogMinutes(input.durationMinutes);
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}/worklogs`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              worklog: {
                description: input.description,
                end_time: { value: new Date(input.endedAt).getTime() },
                include_nonoperational_hours: true,
                is_billable: input.worklogType === "billable",
                mark_first_response: false,
                owner: { id: input.ownerId },
                start_time: { value: new Date(input.startedAt).getTime() },
                time_spent: {
                  hours: String(Math.floor(durationMinutes / 60)),
                  minutes: String(durationMinutes % 60),
                },
              },
            }),
          }),
          method: "POST",
        },
      );

      if (!mspCentralActionSucceeded(payload)) {
        throw new MspCentralConfigurationError(
          "MSP Central Work Log save failed.",
        );
      }
    },
    async createRequest(input) {
      assertConfigured();
      const description = appendCommandFingerprint(
        input.description,
        input.commandFingerprint,
      );
      const request = {
        ...(description ? { description } : {}),
        ...(input.impact ? { impact: { name: input.impact } } : {}),
        ...(input.impactDetails ? { impact_details: input.impactDetails } : {}),
        priority: { name: input.priority },
        ...(input.requestType
          ? { request_type: { name: input.requestType } }
          : {}),
        ...(input.contactId
          ? { requester: { id: input.contactId } }
          : input.requesterEmail
            ? { requester: { email_id: input.requesterEmail } }
            : {}),
        ...(input.site ? { site: { name: input.site } } : {}),
        status: { name: input.status?.trim() || "Open" },
        ...(input.category ? { category: { name: input.category } } : {}),
        ...(input.subcategory
          ? { subcategory: { name: input.subcategory } }
          : {}),
        subject: input.subject,
        ...(input.urgency ? { urgency: { name: input.urgency } } : {}),
      };
      const payload = await requestJson<MspCentralActionResponse>(apiRoot + "/requests", {
        body: new URLSearchParams({
          input_data: JSON.stringify({ request }),
        }),
        method: "POST",
      });
      if (!mspCentralActionSucceeded(payload)) {
        throw new MspCentralConfigurationError("MSP Central request creation failed.");
      }
      const id = String(payload.request?.id ?? "").trim();
      const requestNumber = String(payload.request?.request_number ?? id).trim();
      if (!id) {
        throw new MspCentralConfigurationError(
          "MSP Central created the request but did not return its ID.",
        );
      }
      return { id, requestNumber };
    },
    async findRequestByCommandFingerprint(commandFingerprint) {
      assertConfigured();
      const marker = commandFingerprintMarker(commandFingerprint);
      const rawRequests = await fetchRawRequests();
      const match = rawRequests.find((request) =>
        String(request.description ?? "").includes(marker),
      );
      const id = String(match?.id ?? "").trim();
      if (!id) return undefined;
      return {
        id,
        requestNumber: String(match?.request_number ?? id).trim(),
      };
    },
    async assignRequest(input) {
      assertConfigured();
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              request: {
                technician: input.technicianEmail
                  ? { email_id: input.technicianEmail }
                  : { name: input.technicianName },
              },
            }),
          }),
          method: "PUT",
        },
      );
      assertMspCentralActionSucceeded(payload, "technician assignment");
    },
    async clearRequestSchedule(input) {
      assertConfigured();
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              request: {
                scheduled_end_time: null,
                scheduled_start_time: null,
              },
            }),
          }),
          method: "PUT",
        },
      );
      assertMspCentralActionSucceeded(payload, "schedule clearing");
    },
    async getRequest(requestId) {
      assertConfigured();
      const payload = await getJson<MspCentralRequestDetailResponse>(
        `${apiRoot}/requests/${encodeURIComponent(requestId)}`,
      );
      const request = payload.request;

      return request
        ? mapMspCentralRequests([request], {
            profiles: getInitialStaffProfiles(),
            requestWebBaseUrl: config.mspCentral.requestWebBaseUrl,
            sourceSystem: "msp-central",
          })[0]
        : undefined;
    },
    async getRequestContext(requestId) {
      assertConfigured();
      const requestPayload = await getJson<MspCentralRequestDetailResponse>(
        `${apiRoot}/requests/${encodeURIComponent(requestId)}`,
      );
      const rawRequest = requestPayload.request;
      if (!rawRequest) {
        throw new MspCentralConfigurationError("MSP Central request was not found.");
      }
      const request = mapMspCentralRequests([rawRequest], {
        profiles: getInitialStaffProfiles(),
        requestWebBaseUrl: config.mspCentral.requestWebBaseUrl,
        sourceSystem: "msp-central",
      })[0];

      const [notesResult, notificationsResult, worklogsResult] =
        await Promise.allSettled([
          fetchRequestNotes(requestId),
          fetchRequestNotifications(requestId),
          fetchRequestWorklogs(requestId),
        ]);

      if (notesResult.status === "rejected") {
        console.error(
          "MSP Central request notes read failed",
          safeError(notesResult.reason),
        );
      }
      if (worklogsResult.status === "rejected") {
        console.error(
          "MSP Central request worklogs read failed",
          safeError(worklogsResult.reason),
        );
      }

      if (notificationsResult.status === "rejected") {
        console.error(
          "MSP Central request notifications read failed",
          safeError(notificationsResult.reason),
        );
      }

      const mappedNotes =
        notesResult.status === "fulfilled"
          ? mapMspCentralRequestNotes(notesResult.value)
          : { customerResponses: [], internalNotes: [] };
      const notificationReplies =
        notificationsResult.status === "fulfilled"
          ? mapMspCentralRequestNotifications(notificationsResult.value)
          : [];

      return {
        customerResponses: mergeRequestUpdates(
          mappedNotes.customerResponses,
          notificationReplies,
        ),
        internalNotes: mappedNotes.internalNotes,
        notesWarning:
          notesResult.status === "rejected" ||
          notificationsResult.status === "rejected"
            ? "Some ticket communications could not be loaded."
            : undefined,
        request,
        worklogs:
          worklogsResult.status === "fulfilled"
            ? mapMspCentralRequestWorklogs(worklogsResult.value)
            : [],
        worklogsWarning:
          worklogsResult.status === "rejected"
            ? "Previous work logs could not be loaded."
            : undefined,
      };
    },
    async getTechnician(technicianId) {
      return (await this.listTechnicians()).find(
        (technician) => technician.id === technicianId,
      );
    },
    async listContacts(input) {
      assertConfigured();
      const contacts = input?.customerId
        ? await fetchCustomerContacts(input.customerId)
        : await fetchContacts();
      return filterContactLookups(uniqueContactLookups(contacts), input?.query)
        .slice(0, 12);
    },
    async listCustomers(query) {
      assertConfigured();
      const catalogueCustomers = await fetchCustomers().catch((error) => {
        console.warn("MSP Central customer catalogue lookup failed", safeError(error));
        return [];
      });
      const customers = catalogueCustomers.length > 0
        ? catalogueCustomers
        : uniqueCustomerLookups(
            (await this.listRequests()).map((request) => ({
              address: request.siteAddress,
              city: request.siteTown,
              id: request.customer,
              name: request.customer,
            })),
          );
      return filterCustomerLookups(customers, query).slice(0, 12);
    },
    async createCustomer(input: MspCentralCreateCustomerInput) {
      assertConfigured();
      const customer = createCustomerPayload(input);
      if (!customer.name) {
        throw new MspCentralConfigurationError("Customer name is required.");
      }

      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/customers`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({ customer }),
          }),
          method: "POST",
        },
      );

      if (
        !mspCentralActionSucceeded(payload) &&
        !payload.customer &&
        !payload.account
      ) {
        throw new MspCentralConfigurationError(
          "MSP Central customer creation failed.",
        );
      }

      customerLookupCache.delete(`${apiRoot}:customer-lookup`);
      return customerLookupFromRaw(payload.customer ?? payload.account ?? customer);
    },
    async listRequestNotes(requestId) {
      const url = requestChildListUrl(apiRoot, requestId, "notes");
      const payload = await getJson<MspCentralRequestNoteListResponse>(url);
      return payload.notes ?? payload.request_notes ?? [];
    },
    async listRequestNotifications(requestId) {
      return fetchRequestNotifications(requestId);
    },
    async listRequestFormOptions() {
      assertConfigured();
      return fetchRequestFormOptions();
    },
    async createCustomerGroup(input: MspCentralCreateCustomerGroupInput) {
      assertConfigured();
      const name = cleanText(input.name);
      if (!name) {
        throw new MspCentralConfigurationError(
          "Customer group name is required.",
        );
      }

      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/customer_groups`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({ customer_group: { name } }),
          }),
          method: "POST",
        },
      );

      if (!mspCentralActionSucceeded(payload) && !payload.customer_group) {
        throw new MspCentralConfigurationError(
          "MSP Central customer group creation failed.",
        );
      }

      requestFormOptionsCache.delete(`${apiRoot}:request-form-options`);
      return {
        ...(cleanId(payload.customer_group?.id)
          ? { id: cleanId(payload.customer_group?.id) }
          : {}),
        name: cleanText(payload.customer_group?.name) ?? name,
      };
    },
    async listRequests(params) {
      assertConfigured();
      const snapshotStore = params?.status ? null : requestSnapshotStore;
      const rawRequests = params?.cacheOnly
        ? await loadCachedMspRequestsSnapshot({ store: snapshotStore })
        : params?.forceRefresh
          ? await refreshMspRequestsSnapshot({
              fetchRequests: () => fetchRawRequests(params),
              store: snapshotStore,
          })
        : await loadMspRequestsWithSnapshot({
            fetchRequests: () => fetchRawRequests(params),
            store: snapshotStore,
          });
      const enrichedRawRequests = params?.cacheOnly
        ? rawRequests
        : await enrichRawRequestsWithCustomerDetails(rawRequests);

      const mappedRequests = mapMspCentralRequests(enrichedRawRequests, {
        profiles: getInitialStaffProfiles(),
        requestWebBaseUrl: config.mspCentral.requestWebBaseUrl,
        sourceSystem: "msp-central",
      });
      return [
        ...new Map(
          mappedRequests.map((request) => [request.id, request]),
        ).values(),
      ];
    },
    async listRequestWorklogs(requestId) {
      const url = requestChildListUrl(apiRoot, requestId, "worklogs");
      return (await getJson<MspCentralRequestWorklogListResponse>(url))
        .worklogs ?? [];
    },
    async listSites() {
      const requests = await this.listRequests();
      return uniqueNamedRows(
        requests.map((request) => ({
          id: request.site,
          name: request.site,
        })),
      );
    },
    async listTechnicians() {
      assertConfigured();
      const payload = await getJson<MspCentralTechnicianListResponse>(
        `${apiRoot}/technicians`,
      );
      const technicians = mapMspCentralTechnicians(
        payload.technicians ?? [],
        getInitialStaffProfiles(),
      );

      return technicians.length > 0
        ? technicians
        : getInitialStaffProfiles().map(staffProfileToTechnician);
    },
    async mergeRequests(input) {
      assertConfigured();

      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.parentRequestId)}/merge_requests`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              merge_requests: [{ id: input.childRequestId }],
            }),
          }),
          method: "PUT",
        },
      );

      if (!mspCentralActionSucceeded(payload)) {
        throw new MspCentralConfigurationError(
          "MSP Central request merge failed.",
        );
      }
    },
    async refreshAccessToken() {
      assertConfigured();
      return getAccessToken();
    },
    async updateRequestSchedule(input) {
      assertConfigured();
      const request = {
        status: { name: "Scheduled" },
        ...(input.technicianId
          ? { technician: { id: input.technicianId } }
          : input.technicianEmail
            ? { technician: { email_id: input.technicianEmail } }
          : input.technicianName
            ? { technician: { name: input.technicianName } }
            : {}),
      };

      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({ request }),
          }),
          method: "PUT",
        },
      );
      assertMspCentralActionSucceeded(payload, "schedule update");
    },
    async setRequestResolution(input) {
      assertConfigured();
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              request: {
                resolution: { content: input.content },
              },
            }),
          }),
          method: "PUT",
        },
      );
      if (!mspCentralActionSucceeded(payload)) {
        throw new MspCentralConfigurationError(
          "MSP Central solution save failed.",
        );
      }
    },
    async updateRequestStatus(input) {
      assertConfigured();
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              request: { status: { name: input.status } },
            }),
          }),
          method: "PUT",
        },
      );
      assertMspCentralActionSucceeded(payload, "status update");
    },
  };

  async function getJson<T>(url: string): Promise<T> {
    return requestJson<T>(url, { method: "GET" });
  }

  async function fetchRequestNotes(requestId: string) {
    return fetchRequestEntryPages({
      path: "notes",
      readEntries: (payload: MspCentralRequestNoteListResponse) =>
        payload.notes ?? payload.request_notes ?? [],
      requestId,
    });
  }

  async function fetchRequestNotifications(requestId: string) {
    const notifications = await fetchRequestEntryPages({
      path: "notifications",
      readEntries: (payload: MspCentralRequestNotificationListResponse) =>
        payload.notifications ?? [],
      requestId,
      sortField: "sent_time",
    });
    return hydrateRequestNotificationDetails(requestId, notifications);
  }

  async function hydrateRequestNotificationDetails(
    requestId: string,
    notifications: MspCentralRawNotification[],
  ) {
    return Promise.all(
      notifications.map(async (notification) => {
        if (!needsNotificationDetail(notification)) return notification;
        const notificationId = String(notification.id ?? "").trim();
        if (!notificationId) return notification;

        try {
          const detail =
            await getJson<MspCentralRequestNotificationDetailResponse>(
              `${apiRoot}/requests/${encodeURIComponent(
                requestId,
              )}/notifications/${encodeURIComponent(notificationId)}`,
            );
          return { ...notification, ...(detail.notification ?? {}) };
        } catch {
          return notification;
        }
      }),
    );
  }

  function needsNotificationDetail(notification: MspCentralRawNotification) {
    return (
      isCustomerConversationNotification(notification.type) &&
      !String(notification.description ?? "").trim()
    );
  }

  async function fetchRequestWorklogs(requestId: string) {
    return fetchRequestEntryPages({
      path: "worklogs",
      readEntries: (payload: MspCentralRequestWorklogListResponse) =>
        payload.worklogs ?? [],
      requestId,
    });
  }

  async function fetchRequestEntryPages<
    TPayload extends {
      list_info?: MspCentralRequestNoteListResponse["list_info"];
    },
    TEntry,
  >({
    path,
    readEntries,
    requestId,
    sortField = "created_time",
  }: {
    path: "notes" | "notifications" | "worklogs";
    readEntries: (payload: TPayload) => TEntry[];
    requestId: string;
    sortField?: "created_time" | "sent_time";
  }): Promise<TEntry[]> {
    const entries: TEntry[] = [];
    let startIndex = 1;

    for (let page = 0; page < MSP_REQUEST_MAX_PAGES; page += 1) {
      const url = new URL(
        `${apiRoot}/requests/${encodeURIComponent(requestId)}/${path}`,
      );
      url.searchParams.set(
        "input_data",
        JSON.stringify({
          list_info: {
            row_count: MSP_REQUEST_PAGE_SIZE,
            sort_field: sortField,
            sort_order: "desc",
            start_index: startIndex,
          },
        }),
      );
      const payload = await getJson<TPayload>(url.toString());
      const pageEntries = readEntries(payload);
      entries.push(...pageEntries);

      if (
        !mspHasMoreRows(payload.list_info?.has_more_rows) ||
        pageEntries.length === 0
      ) {
        break;
      }

      const returnedStartIndex = mspListNumber(
        payload.list_info?.start_index,
        startIndex,
      );
      const returnedRowCount = mspListNumber(
        payload.list_info?.row_count,
        pageEntries.length,
      );
      const nextStartIndex =
        returnedStartIndex + Math.max(returnedRowCount, pageEntries.length, 1);
      if (nextStartIndex <= startIndex) {
        throw new MspCentralConfigurationError(
          `MSP Central ${path} pagination did not advance.`,
        );
      }
      startIndex = nextStartIndex;
    }

    return entries;
  }

  async function fetchRawRequests(
    params?: Parameters<MspCentralClient["listRequests"]>[0],
  ) {
    const rawRequests: NonNullable<MspCentralRequestListResponse["requests"]> = [];
    let startIndex = 1;

    for (let page = 0; page < MSP_REQUEST_MAX_PAGES; page += 1) {
      const url = new URL(`${apiRoot}/requests`);
      url.searchParams.set(
        "input_data",
        JSON.stringify({
          list_info: {
            row_count: MSP_REQUEST_PAGE_SIZE,
            sort_field: "created_time",
            sort_order: "desc",
            start_index: startIndex,
            filter_by: params?.status
              ? undefined
              : { name: "Open_Requests" },
            search_criteria: requestSearchCriteria(params?.status),
          },
        }),
      );
      const payload = await getJson<MspCentralRequestListResponse>(
        url.toString(),
      );
      const pageRequests = payload.requests ?? [];
      rawRequests.push(...pageRequests);

      if (
        !mspHasMoreRows(payload.list_info?.has_more_rows) ||
        pageRequests.length === 0
      ) {
        break;
      }

      const returnedStartIndex = mspListNumber(
        payload.list_info?.start_index,
        startIndex,
      );
      const returnedRowCount = mspListNumber(
        payload.list_info?.row_count,
        pageRequests.length,
      );
      startIndex = returnedStartIndex + Math.max(returnedRowCount, 1);
    }

    return rawRequests;
  }

  async function fetchCustomers() {
    const cacheKey = `${apiRoot}:customer-lookup`;
    const cached = customerLookupCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.customers;
    }

    const customers =
      (await fetchCustomerPages("customers")) ??
      (await fetchCustomerPages("accounts")) ??
      [];
    const lookups = uniqueCustomerLookups(customers.map(customerLookupFromRaw));
    customerLookupCache.set(cacheKey, {
      customers: lookups,
      expiresAt: Date.now() + 15 * 60_000,
    });
    return lookups;
  }

  async function fetchRequestFormOptions() {
    const cacheKey = `${apiRoot}:request-form-options`;
    const cached = requestFormOptionsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.options;
    }

    const fallback = defaultRequestFormOptions();
    const [
      requestTypes,
      statuses,
      impacts,
      urgencies,
      priorities,
      categories,
      subcategories,
      technicians,
      customerGroups,
    ] = await Promise.all([
      fetchNamedOptions("request_types", "request_types"),
      fetchNamedOptions("statuses", "statuses"),
      fetchNamedOptions("impacts", "impacts"),
      fetchNamedOptions("urgencies", "urgencies"),
      fetchNamedOptions("priorities", "priorities"),
      fetchNamedOptions("categories", "categories"),
      fetchNamedOptions("subcategories", "subcategories"),
      fetchNamedOptions("technicians", "technicians"),
      fetchCustomerGroups(),
    ]);
    const options = {
      categories: sortStrings(categories.length ? categories : fallback.categories),
      customerGroups: sortStrings(customerGroups),
      impacts: impacts.length ? impacts : fallback.impacts,
      priorities: normalizePriorities(priorities, fallback.priorities),
      requestTypes: requestTypes.length ? requestTypes : fallback.requestTypes,
      statuses: statuses.length ? statuses : fallback.statuses,
      subcategories: subcategories.length
        ? sortStrings(subcategories)
        : fallback.subcategories,
      technicians: sortStrings(
        technicians.length ? technicians : fallback.technicians,
      ),
      urgencies: urgencies.length ? urgencies : fallback.urgencies,
    };
    requestFormOptionsCache.set(cacheKey, {
      expiresAt: Date.now() + 15 * 60_000,
      options,
    });
    return options;
  }

  async function fetchNamedOptions(
    path: string,
    responseKey: Exclude<keyof MspCentralNamedOptionListResponse, "list_info">,
  ) {
    try {
      const rows: MspCentralNamedOption[] = [];
      let startIndex = 1;
      for (let page = 0; page < MSP_OPTION_LOOKUP_MAX_PAGES; page += 1) {
        const url = new URL(`${apiRoot}/${path}`);
        url.searchParams.set(
          "input_data",
          JSON.stringify({
            list_info: {
              row_count: MSP_OPTION_LOOKUP_PAGE_SIZE,
              sort_field: "name",
              sort_order: "asc",
              start_index: startIndex,
            },
          }),
        );
        const payload = await getJson<MspCentralNamedOptionListResponse>(
          url.toString(),
        );
        const pageRows =
          payload[responseKey] ??
          payload.options ??
          payload.values ??
          [];
        rows.push(...pageRows);

        if (
          !mspHasMoreRows(payload.list_info?.has_more_rows) ||
          pageRows.length === 0
        ) {
          break;
        }

        const returnedStartIndex = mspListNumber(
          payload.list_info?.start_index,
          startIndex,
        );
        const returnedRowCount = mspListNumber(
          payload.list_info?.row_count,
          pageRows.length,
        );
        startIndex = returnedStartIndex + Math.max(returnedRowCount, 1);
      }
      return uniqueStrings(
        rows.map((option) =>
          cleanText(option.name) ??
          cleanText(option.display_name) ??
          cleanText(option.value),
        ),
      );
    } catch {
      return [];
    }
  }

  async function fetchCustomerGroups() {
    const groupOptions = await fetchNamedOptions(
      "customer_groups",
      "customer_groups",
    );
    if (groupOptions.length > 0) {
      return groupOptions;
    }

    const customers = await fetchCustomers().catch(() => []);
    return uniqueStrings(customers.map(customerGroupName));
  }

  async function fetchCustomerPages(path: "accounts" | "customers") {
    try {
      const rows: MspCentralRawCustomer[] = [];
      let startIndex = 1;
      for (let page = 0; page < MSP_CUSTOMER_LOOKUP_MAX_PAGES; page += 1) {
        const url = new URL(`${apiRoot}/${path}`);
        url.searchParams.set(
          "input_data",
          JSON.stringify({
            list_info: {
              row_count: MSP_REQUEST_PAGE_SIZE,
              sort_field: "name",
              sort_order: "asc",
              start_index: startIndex,
            },
          }),
        );
        const payload = await getJson<MspCentralCustomerListResponse>(
          url.toString(),
        );
        const pageRows = payload.customers ?? payload.accounts ?? [];
        rows.push(...pageRows);

        if (
          !mspHasMoreRows(payload.list_info?.has_more_rows) ||
          pageRows.length === 0
        ) {
          break;
        }

        const returnedStartIndex = mspListNumber(
          payload.list_info?.start_index,
          startIndex,
        );
        const returnedRowCount = mspListNumber(
          payload.list_info?.row_count,
          pageRows.length,
        );
        startIndex = returnedStartIndex + Math.max(returnedRowCount, 1);
      }
      return rows;
    } catch {
      return undefined;
    }
  }

  async function fetchCustomerContacts(customerId: string) {
    const encodedCustomerId = encodeURIComponent(customerId);
    const contacts =
      (await firstNonEmptyContactPages([
        `customers/${encodedCustomerId}/users`,
        `customers/${encodedCustomerId}/requesters`,
        `customers/${encodedCustomerId}/contacts`,
        `accounts/${encodedCustomerId}/users`,
        `accounts/${encodedCustomerId}/requesters`,
        `accounts/${encodedCustomerId}/contacts`,
      ])) ??
      (await fetchContactsForCustomer(customerId)) ??
      [];
    return contacts.map(contactLookupFromRaw).filter(isContactLookup);
  }

  async function firstNonEmptyContactPages(paths: string[]) {
    for (const path of paths) {
      const contacts = await fetchContactPages(path);
      if (contacts && contacts.length > 0) {
        return contacts;
      }
    }
    return undefined;
  }

  async function fetchContacts() {
    const contacts = await fetchContactPages("contacts");
    return (contacts ?? []).map(contactLookupFromRaw).filter(isContactLookup);
  }

  async function fetchContactsForCustomer(customerId: string) {
    const rows = await firstNonEmptyContactPages([
      "requesters",
      "users",
      "contacts",
    ]);
    if (!rows) return undefined;
    const normalizedCustomerId = cleanId(customerId)?.toLowerCase();
    return rows.filter((contact) =>
      contactBelongsToCustomer(contact, normalizedCustomerId),
    );
  }

  async function fetchContactPages(path: string) {
    try {
      const rows: MspCentralRawContact[] = [];
      let startIndex = 1;
      for (let page = 0; page < MSP_CUSTOMER_LOOKUP_MAX_PAGES; page += 1) {
        const url = new URL(`${apiRoot}/${path}`);
        url.searchParams.set(
          "input_data",
          JSON.stringify({
            list_info: {
              row_count: MSP_REQUEST_PAGE_SIZE,
              sort_field: "name",
              sort_order: "asc",
              start_index: startIndex,
            },
          }),
        );
        const payload = await getJson<MspCentralContactListResponse>(
          url.toString(),
        );
        const pageRows =
          payload.users ?? payload.requesters ?? payload.contacts ?? [];
        rows.push(...pageRows);

        if (
          !mspHasMoreRows(payload.list_info?.has_more_rows) ||
          pageRows.length === 0
        ) {
          break;
        }

        const returnedStartIndex = mspListNumber(
          payload.list_info?.start_index,
          startIndex,
        );
        const returnedRowCount = mspListNumber(
          payload.list_info?.row_count,
          pageRows.length,
        );
        startIndex = returnedStartIndex + Math.max(returnedRowCount, 1);
      }
      return rows;
    } catch {
      return undefined;
    }
  }

  async function enrichRawRequestsWithCustomerDetails(
    rawRequests: MspCentralRawRequest[],
  ) {
    const accountIds = uniqueAccountIdsNeedingAddress(rawRequests);
    if (accountIds.length === 0) return rawRequests;

    const details = await withTimeout(
      loadCustomerDetails(accountIds),
      MSP_CUSTOMER_DETAIL_TIMEOUT_MS,
    ).catch((error) => {
      console.warn(
        "MSP Central customer address enrichment skipped",
        safeError(error),
      );
      return new Map<string, NonNullable<MspCentralRawRequest["account"]>>();
    });
    if (details.size === 0) return rawRequests;

    return rawRequests.map((request) => {
      const accountId = cleanId(request.account?.id);
      const account = accountId ? details.get(accountId) : undefined;
      if (!account) return request;

      return {
        ...request,
        account: {
          ...account,
          ...request.account,
        },
      };
    });
  }

  async function loadCustomerDetails(accountIds: string[]) {
    const details = new Map<string, NonNullable<MspCentralRawRequest["account"]>>();
    const workers = Array.from(
      { length: Math.min(4, accountIds.length) },
      async (_, workerIndex) => {
        for (let index = workerIndex; index < accountIds.length; index += 4) {
          const accountId = accountIds[index];
          const account = await getCustomerDetail(accountId);
          if (account) details.set(accountId, account);
        }
      },
    );

    await Promise.all(workers);
    return details;
  }

  async function getCustomerDetail(accountId: string) {
    const cacheKey = `${apiRoot}:customer:${accountId}`;
    const cached = customerDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.account;
    }

    const account =
      (await getCustomerDetailFromPath("customers", accountId)) ??
      (await getCustomerDetailFromPath("accounts", accountId));
    if (account) {
      customerDetailCache.set(cacheKey, {
        account,
        expiresAt: Date.now() + 15 * 60_000,
      });
    }
    return account;
  }

  async function getCustomerDetailFromPath(
    path: "accounts" | "customers",
    accountId: string,
  ) {
    try {
      const payload = await getJson<MspCentralCustomerDetailResponse>(
        `${apiRoot}/${path}/${encodeURIComponent(accountId)}`,
      );
      return payload.customer ?? payload.account;
    } catch {
      return undefined;
    }
  }

  async function requestJson<T>(
    url: string,
    init: { body?: URLSearchParams; method: "GET" | "POST" | "PUT" },
  ): Promise<T> {
    const token = await getAccessToken();
    let response = await sendMspRequest(url, init, token);
    let retriedAfterUnauthorized = false;

    if (!response.ok) {
      const detail = await readMspCentralErrorDetail(response);
      if (
        shouldRetryUnauthorizedWrite(response.status, detail, init.method) &&
        accessTokenCoordinator
      ) {
        await accessTokenCoordinator.invalidate(accessTokenCacheKey(config), token);
        const refreshedToken = await getAccessToken();
        response = await sendMspRequest(url, init, refreshedToken);
        retriedAfterUnauthorized = true;
      }
      if (retriedAfterUnauthorized && response.ok) {
        const payload = (await response.json()) as T;
        if (mspCentralAccessDenied(payload)) {
          throw new MspCentralConfigurationError(
            "MSP Central API request was denied.",
          );
        }

        return payload;
      }
      const finalDetail = retriedAfterUnauthorized
        ? await readMspCentralErrorDetail(response)
        : detail;
      throw new MspCentralConfigurationError(
        finalDetail
          ? `MSP Central API request failed with status ${response.status}: ${finalDetail}.`
          : `MSP Central API request failed with status ${response.status}.`,
        { status: response.status },
      );
    }

    const payload = (await response.json()) as T;
    if (mspCentralAccessDenied(payload)) {
      throw new MspCentralConfigurationError(
        "MSP Central API request was denied.",
      );
    }

    return payload;
  }
}

function sendMspRequest(
  url: string,
  init: { body?: URLSearchParams; method: "GET" | "POST" | "PUT" },
  token: string,
) {
  const timeoutMs =
    init.method === "GET" ? MSP_REQUEST_TIMEOUT_MS : MSP_WRITE_REQUEST_TIMEOUT_MS;
  return fetch(url, {
    body: init.body,
    headers: {
      Accept: "application/vnd.manageengine.sdp.v3+json",
      Authorization: `Zoho-oauthtoken ${token}`,
      ...(init.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    method: init.method,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function uniqueAccountIdsNeedingAddress(rawRequests: MspCentralRawRequest[]) {
  const ids = new Set<string>();

  for (const request of rawRequests) {
    const accountId = cleanId(request.account?.id);
    if (!accountId || rawRequestHasAddressFields(request)) continue;
    ids.add(accountId);
  }

  return [...ids];
}

function rawRequestHasAddressFields(request: MspCentralRawRequest) {
  return Boolean(
    cleanText(request.site?.address) ||
      cleanText(request.site?.street) ||
      cleanText(request.site_address) ||
      cleanText(request.account?.address) ||
      cleanText(request.account?.street) ||
      cleanText(request.account?.shipping_address) ||
      cleanText(request.account?.shipping_street) ||
      cleanText(request.account?.billing_address) ||
      cleanText(request.account?.billing_street),
  );
}

function cleanId(value: unknown) {
  const text = cleanText(value);
  return text && text !== "0" ? text : undefined;
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function customerLookupFromRaw(raw: Partial<MspCentralRawCustomer>) {
  const name =
    cleanText(raw.name) ??
    cleanText(raw.display_name) ??
    cleanText(raw.account_name);
  const id = cleanId(raw.id) ?? name;
  return {
    ...(formatCustomerAddress(raw) ? { address: formatCustomerAddress(raw) } : {}),
    ...(cleanText(raw.city ?? raw.shipping_city ?? raw.billing_city)
      ? { city: cleanText(raw.city ?? raw.shipping_city ?? raw.billing_city) }
      : {}),
    ...(customerGroupName(raw) ? { customerGroup: customerGroupName(raw) } : {}),
    ...(cleanEmail(raw.email_id ?? raw.email)
      ? { email: cleanEmail(raw.email_id ?? raw.email) }
      : {}),
    id: id ?? "unknown",
    name: name ?? "Unknown customer",
    ...(cleanText(raw.phone_number ?? raw.phone)
      ? { phone: cleanText(raw.phone_number ?? raw.phone) }
      : {}),
  };
}

function createCustomerPayload(input: MspCentralCreateCustomerInput) {
  return removeUndefined({
    address: cleanText(input.address),
    city: cleanText(input.city),
    country: cleanText(input.country),
    customer_group: input.customerGroup
      ? [{ name: cleanText(input.customerGroup) }]
      : undefined,
    email_id: cleanEmail(input.email),
    name: cleanText(input.name),
    phone: cleanText(input.phone),
    postal_code: cleanText(input.postalCode),
    state: cleanText(input.state),
  });
}

function customerGroupName(raw: Partial<MspCentralRawCustomer>) {
  if (Array.isArray(raw.customer_group)) {
    return cleanText(raw.customer_group.map((group) => group.name).join(", "));
  }
  if (typeof raw.customer_group === "object" && raw.customer_group) {
    return cleanText(raw.customer_group.name);
  }
  return cleanText(raw.customer_group) ?? cleanText(raw.customer_group_name);
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Partial<T>;
}

function contactLookupFromRaw(raw: MspCentralRawContact) {
  const firstName = cleanText(raw.first_name);
  const lastName = cleanText(raw.last_name);
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const name =
    cleanText(raw.name) ??
    cleanText(raw.display_name) ??
    cleanText(joinedName);
  const email = cleanEmail(raw.email_id ?? raw.email);
  const id = cleanId(raw.id) ?? email ?? name;
  return {
    ...(email ? { email } : {}),
    id: id ?? "unknown",
    name: name ?? email ?? "Unknown contact",
    ...(cleanText(
      raw.mobile_number ??
        raw.mobile ??
        raw.phone_number ??
        raw.phone ??
        raw.contact_number,
    )
      ? {
          phone: cleanText(
            raw.mobile_number ??
              raw.mobile ??
              raw.phone_number ??
              raw.phone ??
              raw.contact_number,
          ),
        }
      : {}),
  };
}

function contactBelongsToCustomer(
  raw: MspCentralRawContact,
  normalizedCustomerId?: string,
) {
  if (!normalizedCustomerId) return true;
  return [
    raw.account?.id,
    raw.account_id,
    raw.customer?.id,
    raw.customer_id,
    raw.account?.name,
    raw.account_name,
    raw.customer?.name,
    raw.customer_name,
  ]
    .map((value) => cleanText(value)?.toLowerCase())
    .some((value) => value === normalizedCustomerId);
}

function isContactLookup(
  contact: ReturnType<typeof contactLookupFromRaw>,
): contact is NonNullable<ReturnType<typeof contactLookupFromRaw>> {
  return contact.id !== "unknown" && contact.name !== "Unknown contact";
}

function uniqueCustomerLookups(customers: MspCentralCustomerLookup[]) {
  return [
    ...new Map(
      customers
        .filter((customer) => customer.id && customer.name)
        .map((customer) => [customer.id, customer]),
    ).values(),
  ];
}

function uniqueContactLookups(
  contacts: ReturnType<typeof contactLookupFromRaw>[],
) {
  return [
    ...new Map(
      contacts
        .filter(isContactLookup)
        .map((contact) => [contact.id, contact]),
    ).values(),
  ];
}

function filterCustomerLookups(
  customers: MspCentralCustomerLookup[],
  query?: string,
) {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) return customers;
  return customers.filter((customer) =>
    [customer.name, customer.email, customer.phone, customer.address, customer.city]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function filterContactLookups(
  contacts: ReturnType<typeof contactLookupFromRaw>[],
  query?: string,
) {
  const normalizedQuery = query?.trim().toLowerCase();
  const filtered = contacts.filter(isContactLookup);
  if (!normalizedQuery) return filtered;
  return filtered.filter((contact) =>
    [contact.name, contact.email, contact.phone]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery),
  );
}

function formatCustomerAddress(raw: Partial<MspCentralRawCustomer>) {
  return (
    cleanText(raw.address) ??
    cleanText(raw.shipping_address) ??
    cleanText(raw.billing_address) ??
    formatAddressParts([
      raw.street,
      raw.city,
      raw.state,
      raw.postal_code ?? raw.zip,
      raw.country,
    ]) ??
    formatAddressParts([
      raw.shipping_street,
      raw.shipping_city,
      raw.shipping_state,
      raw.shipping_code,
      raw.shipping_country,
    ]) ??
    formatAddressParts([
      raw.billing_street,
      raw.billing_city,
      raw.billing_state,
      raw.billing_code,
      raw.billing_country,
    ])
  );
}

function formatAddressParts(parts: unknown[]) {
  const text = parts.map(cleanText).filter(Boolean).join(", ");
  return text || undefined;
}

function defaultRequestFormOptions(): MspCentralRequestFormOptions {
  return {
    categories: [
      "Backup",
      "Cloud Services",
      "Desktop Hardware",
      "General",
      "General Query",
      "Internet",
      "Line of Business Apps",
      "Microsoft 365",
      "Network",
      "Operating System",
      "Phone System",
      "Printers",
      "Procurement",
      "Remote Access",
      "Security",
      "Servers",
      "Services",
      "Software",
      "User Administration",
    ],
    customerGroups: [],
    impacts: ["Affects Business", "Affects Department", "Affects Group", "Affects User"],
    priorities: ["Low", "Medium", "High", "Critical"],
    requestTypes: [
      "General",
      "Incident",
      "Procurement Request",
      "Request For Information",
      "Service Request",
    ],
    statuses: ["Open"],
    subcategories: [],
    technicians: [],
    urgencies: ["Low", "Normal", "High", "Urgent"],
  };
}

function normalizePriorities(
  values: string[],
  fallback: MspCentralRequestFormOptions["priorities"],
) {
  const allowed = new Set(["Critical", "High", "Medium", "Low"]);
  const normalized = values.filter(
    (value): value is MspCentralRequestFormOptions["priorities"][number] =>
      allowed.has(value),
  );
  return normalized.length > 0 ? normalized : fallback;
}

function uniqueStrings(values: Array<string | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function sortStrings(values: string[]) {
  return [...values].sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`MSP Central customer address lookup timed out after ${timeoutMs}ms.`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shouldRetryUnauthorizedWrite(
  status: number,
  detail: string | undefined,
  method: "GET" | "POST" | "PUT",
) {
  return (
    status === 401 &&
    method !== "GET" &&
    !/invalid oauth scope|invalid scope|insufficient scope/i.test(detail ?? "")
  );
}

function requestChildListUrl(
  apiRoot: string,
  requestId: string,
  child: "notes" | "notifications" | "worklogs",
) {
  const url = new URL(
    `${apiRoot}/requests/${encodeURIComponent(requestId)}/${child}`,
  );
  url.searchParams.set(
    "input_data",
    JSON.stringify({
      list_info: {
        row_count: 100,
        sort_field: child === "notifications" ? "sent_time" : "created_time",
        sort_order: "desc",
        start_index: 1,
      },
    }),
  );
  return url.toString();
}

function requestSearchCriteria(status?: string) {
  if (status?.trim()) {
    return {
      condition: "is",
      field: "status.internal_name",
      values: [status.trim()],
    };
  }

  return {
    condition: "is",
    field: "status.in_progress",
    values: [true],
  };
}

function cleanEmail(value?: string | null) {
  const text = value?.trim().toLowerCase();
  if (!text) return undefined;

  const bracketed = text.match(/<\s*([^<>\s@]+@[^<>\s@]+)\s*>/);
  const candidate =
    bracketed?.[1] ??
    text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0];
  if (!candidate) return undefined;

  const email = candidate.replace(/[),.;:]+$/g, "").trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)
    ? email
    : undefined;
}

function isMspRecipientAddressError(error: unknown) {
  return (
    error instanceof Error &&
    /special characters present in recipients'? address/i.test(error.message)
  );
}

function commandFingerprintMarker(commandFingerprint: string) {
  const safe = commandFingerprint.trim().replace(/[^a-f0-9_-]/gi, "").slice(0, 128);
  if (!safe) {
    throw new MspCentralConfigurationError(
      "Command Centre request fingerprint is invalid.",
    );
  }
  return `command-centre:${safe}`;
}

function appendCommandFingerprint(
  description?: string,
  commandFingerprint?: string,
) {
  const cleanDescription = description?.trim();
  if (!commandFingerprint?.trim()) return cleanDescription;
  return [
    cleanDescription,
    `<!-- ${commandFingerprintMarker(commandFingerprint)} -->`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function readMspCentralErrorDetail(response: Response) {
  let payload: Record<string, unknown> | undefined;
  if (typeof response.text === "function") {
    const body = await response.text().catch(() => "");
    payload = safeJsonRecord(body);
  } else if (typeof response.json === "function") {
    payload = (await response.json().catch(() => undefined)) as
      | Record<string, unknown>
      | undefined;
  }
  const responseStatus = payload?.response_status;
  const statuses = Array.isArray(responseStatus)
    ? responseStatus
    : responseStatus && typeof responseStatus === "object"
      ? [responseStatus]
      : [];

  for (const status of statuses) {
    if (!status || typeof status !== "object") continue;
    const record = status as Record<string, unknown>;
    const messages = Array.isArray(record.messages) ? record.messages : [];

    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const text = (message as Record<string, unknown>).message;
      if (typeof text === "string" && text.trim()) {
        return text.trim().replace(/[.]+$/, "").slice(0, 300);
      }
    }

    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim().replace(/[.]+$/, "").slice(0, 300);
    }
  }

  const error = payload?.error;
  if (typeof error === "string" && error.trim()) {
    return error.trim().replace(/[.]+$/, "").slice(0, 300);
  }

  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim().replace(/[.]+$/, "").slice(0, 300);
    }
  }

  return findMspCentralErrorMessage(payload);
}

function safeJsonRecord(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function findMspCentralErrorMessage(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const message = findMspCentralErrorMessage(item);
      if (message) return message;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ["message", "error_message", "display_message"]) {
    const message = record[key];
    if (typeof message === "string" && message.trim()) {
      return message.trim().replace(/[.]+$/, "").slice(0, 300);
    }
  }
  for (const child of Object.values(record)) {
    const message = findMspCentralErrorMessage(child);
    if (message) return message;
  }
  return undefined;
}

function mspHasMoreRows(value: boolean | string | null | undefined) {
  return (
    value === true ||
    (typeof value === "string" && value.trim().toLowerCase() === "true")
  );
}

function mspListNumber(
  value: number | string | null | undefined,
  fallback: number,
) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mspCentralActionSucceeded(payload: MspCentralActionResponse) {
  const statuses = Array.isArray(payload.response_status)
    ? payload.response_status
    : payload.response_status
      ? [payload.response_status]
      : [];

  return statuses.length > 0 && statuses.every(
    (status) => status.status?.trim().toLowerCase() === "success",
  );
}

function assertMspCentralActionSucceeded(
  payload: MspCentralActionResponse,
  action: string,
) {
  if (!mspCentralActionSucceeded(payload)) {
    throw new MspCentralConfigurationError(
      `MSP Central ${action} failed.`,
    );
  }
}

async function refreshAccessToken(config: DispatchConfig) {
  const accountsUrl = (config.mspCentral.accountsUrl || "https://accounts.zoho.com.au")
    .replace(/\/+$/, "");
  const response = await fetch(`${accountsUrl}/oauth/v2/token`, {
    body: new URLSearchParams({
      client_id: config.mspCentral.clientId ?? "",
      client_secret: config.mspCentral.clientSecret ?? "",
      grant_type: "refresh_token",
      refresh_token: config.mspCentral.refreshToken ?? "",
    }),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
    signal: AbortSignal.timeout(MSP_REQUEST_TIMEOUT_MS),
  });
  const payload = await readOAuthTokenResponse(response);

  if (!response.ok || payload.error) {
    throw new MspCentralConfigurationError(
      payload.error
        ? `MSP Central OAuth refresh failed (${payload.error}).`
        : `MSP Central OAuth refresh failed with status ${response.status}.`,
    );
  }

  if (!payload.access_token) {
    throw new MspCentralConfigurationError(
      "MSP Central OAuth refresh response was incomplete.",
    );
  }

  return {
    accessToken: payload.access_token,
    expiresInSeconds:
      Number.isFinite(payload.expires_in) && Number(payload.expires_in) > 0
        ? Number(payload.expires_in)
        : 3600,
  };
}

async function getCachedAccessToken(config: DispatchConfig) {
  const key = accessTokenCacheKey(config);
  accessTokenCoordinator ??= new MspOAuthAccessTokenCoordinator({
    store: getConfiguredMspOAuthTokenStore(),
  });

  return accessTokenCoordinator.getToken(key, () => refreshAccessToken(config));
}

function accessTokenCacheKey(config: DispatchConfig) {
  return buildMspOAuthCacheKey({
    accountsUrl: config.mspCentral.accountsUrl,
    clientId: config.mspCentral.clientId,
    refreshToken: config.mspCentral.refreshToken,
  });
}

function mspCentralAccessDenied(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const error = "error" in payload ? payload.error : undefined;
  return (
    typeof error === "string" &&
    error.trim().toLowerCase().replaceAll("_", " ") === "access denied"
  );
}

async function readOAuthTokenResponse(response: Response) {
  try {
    return (await response.json()) as {
      access_token?: string;
      error?: string;
      expires_in?: number;
    };
  } catch {
    return {};
  }
}

function buildMspCentralApiRoot(config: DispatchConfig) {
  const baseUrl = (config.mspCentral.baseUrl ?? "").replace(/\/+$/, "");
  const portal = config.mspCentral.portal?.trim();

  if (!baseUrl) {
    return "";
  }

  if (baseUrl.includes("/api/v3")) {
    return baseUrl;
  }

  if (/\/app\/[^/]+$/i.test(baseUrl)) {
    return `${baseUrl}/api/v3`;
  }

  if (portal) {
    return `${baseUrl}/app/${encodeURIComponent(portal)}/api/v3`;
  }

  return `${baseUrl}/api/v3`;
}

function uniqueNamedRows(rows: Array<{ id: string; name: string }>) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function mergeRequestUpdates(
  ...groups: MspCentralRequestUpdate[][]
): MspCentralRequestUpdate[] {
  const seen = new Set<string>();
  return groups
    .flat()
    .filter((update) => {
      const key = [
        update.author.trim().toLowerCase(),
        update.body.replace(/\s+/g, " ").trim().toLowerCase(),
        update.createdAt ?? "",
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) =>
      String(left.createdAt ?? "").localeCompare(String(right.createdAt ?? "")),
    );
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message }
    : { message: "Unknown MSP Central error." };
}
