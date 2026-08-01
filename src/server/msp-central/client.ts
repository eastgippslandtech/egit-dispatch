import type { DispatchConfig } from "@/server/dispatch/env";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

import { MspCentralConfigurationError } from "./errors";
import {
  loadFixtureRequestDetail,
  loadMspCentralFixtureResponses,
} from "./fixtures";
import {
  mapMspCentralRequestNotes,
  mapMspCentralRequestWorklogs,
  mapMspCentralRequests,
  mapMspCentralTechnicians,
} from "./mappers";
import {
  getConfiguredMspRequestSnapshotStore,
  loadMspRequestsWithSnapshot,
} from "./request-snapshot";
import {
  buildMspOAuthCacheKey,
  MspOAuthAccessTokenCoordinator,
} from "./token-cache";
import { getConfiguredMspOAuthTokenStore } from "./token-store";
import type {
  MspCentralClient,
  MspCentralRequestDetailResponse,
  MspCentralRequestListResponse,
  MspCentralRequestNoteListResponse,
  MspCentralRequestWorklogListResponse,
  MspCentralTechnicianListResponse,
} from "./types";

const MSP_REQUEST_TIMEOUT_MS = 10_000;
const MSP_REQUEST_PAGE_SIZE = 100;
const MSP_REQUEST_MAX_PAGES = 100;

type MspCentralActionResponse = {
  response_status?:
    | { status?: string | null }
    | Array<{ status?: string | null }>;
};

let accessTokenCoordinator: MspOAuthAccessTokenCoordinator | undefined;

export function createMspCentralClient(config: DispatchConfig): MspCentralClient {
  if (config.dispatchDataSource === "msp-central-fixture") {
    return createMspCentralFixtureClient(config);
  }

  return createMspCentralLiveClient(config);
}

export function resetMspCentralAccessTokenCacheForTests() {
  accessTokenCoordinator?.reset();
  accessTokenCoordinator = undefined;
}

function createMspCentralFixtureClient(config: DispatchConfig): MspCentralClient {
  const fixtures = loadMspCentralFixtureResponses();
  const profiles = getInitialStaffProfiles();

  return {
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
    async getTechnician(technicianId) {
      return (await this.listTechnicians()).find(
        (technician) => technician.id === technicianId,
      );
    },
    async listCustomers() {
      return (fixtures.requestList.requests ?? []).map((request) => ({
        id: String(request.account?.name ?? request.customer ?? "unknown"),
        name: String(request.account?.name ?? request.customer ?? "Unknown customer"),
      }));
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

  return {
    async addRequestWorklog(input) {
      assertConfigured();
      const durationMinutes = Math.max(1, Math.round(input.durationMinutes));
      const payload = await requestJson<MspCentralActionResponse>(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}/worklogs`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              worklog: {
                description: input.description,
                end_time: { value: new Date(input.endedAt).getTime() },
                include_nonoperational_hours: true,
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
    async assignRequest(input) {
      assertConfigured();
      await requestJson(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({
              request: { technician: { name: input.technicianName } },
            }),
          }),
          method: "PUT",
        },
      );
    },
    async clearRequestSchedule(input) {
      assertConfigured();
      await requestJson(
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

      const listInput = JSON.stringify({
        list_info: {
          row_count: 100,
          sort_field: "created_time",
          sort_order: "desc",
          start_index: 1,
        },
      });
      const notesUrl = new URL(
        `${apiRoot}/requests/${encodeURIComponent(requestId)}/notes`,
      );
      notesUrl.searchParams.set("input_data", listInput);
      const worklogsUrl = new URL(
        `${apiRoot}/requests/${encodeURIComponent(requestId)}/worklogs`,
      );
      worklogsUrl.searchParams.set("input_data", listInput);

      const [notesResult, worklogsResult] = await Promise.allSettled([
        getJson<MspCentralRequestNoteListResponse>(notesUrl.toString()),
        getJson<MspCentralRequestWorklogListResponse>(worklogsUrl.toString()),
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

      return {
        ...(notesResult.status === "fulfilled"
          ? mapMspCentralRequestNotes(notesResult.value.request_notes)
          : { customerResponses: [], internalNotes: [] }),
        notesWarning:
          notesResult.status === "rejected"
            ? "Latest ticket notes could not be loaded."
            : undefined,
        request,
        worklogs:
          worklogsResult.status === "fulfilled"
            ? mapMspCentralRequestWorklogs(worklogsResult.value.worklogs)
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
    async listCustomers() {
      const requests = await this.listRequests();
      return uniqueNamedRows(
        requests.map((request) => ({
          id: request.customer,
          name: request.customer,
        })),
      );
    },
    async listRequests(params) {
      assertConfigured();
      const rawRequests = await loadMspRequestsWithSnapshot({
        fetchRequests: () => fetchRawRequests(params),
        store: params?.status ? null : requestSnapshotStore,
      });

      const mappedRequests = mapMspCentralRequests(rawRequests, {
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
        scheduled_end_time: { value: toEpochMilliseconds(input.scheduledEnd) },
        scheduled_start_time: { value: toEpochMilliseconds(input.scheduledStart) },
        ...(input.technicianId
          ? { technician: { id: input.technicianId } }
          : input.technicianEmail
            ? { technician: { email_id: input.technicianEmail } }
          : input.technicianName
            ? { technician: { name: input.technicianName } }
            : {}),
      };

      await requestJson(
        `${apiRoot}/requests/${encodeURIComponent(input.requestId)}`,
        {
          body: new URLSearchParams({
            input_data: JSON.stringify({ request }),
          }),
          method: "PUT",
        },
      );
    },
    async updateRequestStatus(input) {
      assertConfigured();
      await requestJson(
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
    },
  };

  async function getJson<T>(url: string): Promise<T> {
    return requestJson<T>(url, { method: "GET" });
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
            get_total_count: true,
            row_count: MSP_REQUEST_PAGE_SIZE,
            sort_field: "created_time",
            sort_order: "desc",
            start_index: startIndex,
            search_criteria: params?.status
              ? {
                  field: "status.internal_name",
                  condition: "is",
                  values: [params.status],
                }
              : {
                  field: "status.in_progress",
                  condition: "is",
                  values: [true],
                },
          },
        }),
      );
      const payload = await getJson<MspCentralRequestListResponse>(
        url.toString(),
      );
      const pageRequests = payload.requests ?? [];
      rawRequests.push(...pageRequests);
      console.info("MSP Central request page read", {
        hasMoreRows: payload.list_info?.has_more_rows,
        page: page + 1,
        requestCount: pageRequests.length,
        returnedRowCount: payload.list_info?.row_count,
        returnedStartIndex: payload.list_info?.start_index,
        startIndex,
        totalCount: payload.list_info?.total_count,
      });

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

  async function requestJson<T>(
    url: string,
    init: { body?: URLSearchParams; method: "GET" | "POST" | "PUT" },
  ): Promise<T> {
    const token = await getAccessToken();
    const response = await fetch(url, {
      body: init.body,
      headers: {
        Accept: "application/vnd.manageengine.sdp.v3+json",
        Authorization: `Zoho-oauthtoken ${token}`,
        ...(init.body
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      method: init.method,
      signal: AbortSignal.timeout(MSP_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const detail = await readMspCentralErrorDetail(response);
      throw new MspCentralConfigurationError(
        detail
          ? `MSP Central API request failed with status ${response.status}: ${detail}.`
          : `MSP Central API request failed with status ${response.status}.`,
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

async function readMspCentralErrorDetail(response: Response) {
  if (typeof response.json !== "function") {
    return undefined;
  }

  const payload = (await response.json().catch(() => undefined)) as
    | Record<string, unknown>
    | undefined;
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

  return undefined;
}

function toEpochMilliseconds(value: string) {
  const milliseconds = new Date(value).getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new MspCentralConfigurationError(
      `Invalid MSP Central schedule timestamp: ${value}`,
    );
  }

  return String(milliseconds);
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

  return statuses.some(
    (status) => status.status?.trim().toLowerCase() === "success",
  );
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

  if (portal) {
    return `${baseUrl}/app/${encodeURIComponent(portal)}/api/v3`;
  }

  return `${baseUrl}/api/v3`;
}

function uniqueNamedRows(rows: Array<{ id: string; name: string }>) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function safeError(error: unknown) {
  return error instanceof Error
    ? { message: error.message }
    : { message: "Unknown MSP Central error." };
}
