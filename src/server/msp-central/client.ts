import type { DispatchConfig } from "@/server/dispatch/env";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

import { MspCentralConfigurationError } from "./errors";
import {
  loadFixtureRequestDetail,
  loadMspCentralFixtureResponses,
} from "./fixtures";
import { mapMspCentralRequests, mapMspCentralTechnicians } from "./mappers";
import {
  buildMspOAuthCacheKey,
  MspOAuthAccessTokenCoordinator,
} from "./token-cache";
import { getConfiguredMspOAuthTokenStore } from "./token-store";
import type {
  MspCentralClient,
  MspCentralRequestDetailResponse,
  MspCentralRequestListResponse,
  MspCentralTechnicianListResponse,
} from "./types";

const MSP_REQUEST_TIMEOUT_MS = 10_000;

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
    async getRequest(requestId) {
      return (await this.listRequests()).find(
        (request) => request.id === requestId || request.requestNumber === requestId,
      ) ?? loadFixtureRequestDetail();
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
      const url = new URL(`${apiRoot}/requests`);
      url.searchParams.set(
        "input_data",
        JSON.stringify({
          list_info: {
            row_count: 100,
            sort_field: "created_time",
            sort_order: "desc",
            start_index: 1,
            ...(params?.status
              ? { search_fields: { status: { name: params.status } } }
              : {}),
          },
        }),
      );
      const payload = await getJson<MspCentralRequestListResponse>(url.toString());

      return mapMspCentralRequests(payload.requests ?? [], {
        profiles: getInitialStaffProfiles(),
        requestWebBaseUrl: config.mspCentral.requestWebBaseUrl,
        sourceSystem: "msp-central",
      });
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
        scheduled_end_time: { value: input.scheduledEnd },
        scheduled_start_time: { value: input.scheduledStart },
        ...(input.technicianName
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

  async function requestJson<T>(
    url: string,
    init: { body?: URLSearchParams; method: "GET" | "POST" | "PUT" },
  ): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
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

      if (response.status === 401 && attempt === 0) {
        await invalidateCachedAccessToken(config, token);
        continue;
      }

      if (!response.ok) {
        throw new MspCentralConfigurationError(
          `MSP Central API request failed with status ${response.status}.`,
        );
      }

      const payload = (await response.json()) as T;
      if (mspCentralAccessDenied(payload)) {
        if (attempt === 0) {
          await invalidateCachedAccessToken(config, token);
          continue;
        }
        throw new MspCentralConfigurationError(
          "MSP Central API request was denied.",
        );
      }

      return payload;
    }

    throw new MspCentralConfigurationError(
      "MSP Central API request was denied.",
    );
  }
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

async function invalidateCachedAccessToken(
  config: DispatchConfig,
  rejectedAccessToken: string,
) {
  await accessTokenCoordinator?.invalidate(
    accessTokenCacheKey(config),
    rejectedAccessToken,
  );
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
