import type { DispatchConfig } from "@/server/dispatch/env";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

import { MspCentralConfigurationError } from "./errors";
import {
  loadFixtureRequestDetail,
  loadMspCentralFixtureResponses,
} from "./fixtures";
import { mapMspCentralRequests, mapMspCentralTechnicians } from "./mappers";
import type {
  MspCentralClient,
  MspCentralRequestDetailResponse,
  MspCentralRequestListResponse,
  MspCentralTechnicianListResponse,
} from "./types";

export function createMspCentralClient(config: DispatchConfig): MspCentralClient {
  if (config.dispatchDataSource === "msp-central-fixture") {
    return createMspCentralFixtureClient(config);
  }

  return createMspCentralLiveClient(config);
}

function createMspCentralFixtureClient(config: DispatchConfig): MspCentralClient {
  const fixtures = loadMspCentralFixtureResponses();
  const profiles = getInitialStaffProfiles();

  return {
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
    async refreshAccessToken() {
      return "fixture-access-token";
    },
    async updateRequestSchedule() {
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

  return {
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
    async refreshAccessToken() {
      assertConfigured();
      return refreshAccessToken(config);
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
  };

  async function getJson<T>(url: string): Promise<T> {
    return requestJson<T>(url, { method: "GET" });
  }

  async function requestJson<T>(
    url: string,
    init: { body?: URLSearchParams; method: "GET" | "PUT" },
  ): Promise<T> {
    const token = await refreshAccessToken(config);
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
    });

    if (!response.ok) {
      throw new MspCentralConfigurationError(
        `MSP Central API request failed with status ${response.status}.`,
      );
    }

    return (await response.json()) as T;
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
  });

  if (!response.ok) {
    throw new MspCentralConfigurationError(
      `MSP Central OAuth refresh failed with status ${response.status}.`,
    );
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new MspCentralConfigurationError(
      "MSP Central OAuth refresh response was incomplete.",
    );
  }

  return payload.access_token;
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
