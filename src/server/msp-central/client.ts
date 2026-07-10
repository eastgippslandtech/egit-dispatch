import type { DispatchConfig } from "@/server/dispatch/env";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

import { MspCentralConfigurationError } from "./errors";
import {
  loadFixtureRequestDetail,
  loadMspCentralFixtureResponses,
} from "./fixtures";
import { mapMspCentralRequests, mapMspCentralTechnicians } from "./mappers";
import type { MspCentralClient } from "./types";

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
  const throwNotConfigured = (): never => {
    throw new MspCentralConfigurationError(
      configured
        ? "MSP Central live endpoints are not implemented yet."
        : "MSP Central API not configured.",
    );
  };

  return {
    async getRequest() {
      return throwNotConfigured();
    },
    async getTechnician() {
      return throwNotConfigured();
    },
    async listCustomers() {
      return throwNotConfigured();
    },
    async listRequests() {
      return throwNotConfigured();
    },
    async listSites() {
      return throwNotConfigured();
    },
    async listTechnicians() {
      return throwNotConfigured();
    },
    async refreshAccessToken() {
      return throwNotConfigured();
    },
  };
}
