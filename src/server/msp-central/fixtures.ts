import { buildDispatchHealthItems } from "@/server/dispatch/health";
import type { DispatchConfig } from "@/server/dispatch/env";
import type { DispatchDashboardData } from "@/server/dispatch/types";
import { getInitialStaffProfiles, staffProfileToTechnician } from "@/server/staff/profiles";

import requestListSample from "./__fixtures__/request-list.sample.json";
import requestDetailSample from "./__fixtures__/request-detail.sample.json";
import technicianListSample from "./__fixtures__/technician-list.sample.json";
import {
  mapMspCentralRequest,
  mapMspCentralRequests,
  mapMspCentralTechnicians,
} from "./mappers";
import type {
  MspCentralRequestDetailResponse,
  MspCentralRequestListResponse,
  MspCentralTechnicianListResponse,
} from "./types";

export function loadMspCentralFixtureResponses() {
  return {
    requestDetail: requestDetailSample as MspCentralRequestDetailResponse,
    requestList: requestListSample as MspCentralRequestListResponse,
    technicianList: technicianListSample as MspCentralTechnicianListResponse,
  };
}

export function getMspCentralFixtureDashboardData(
  config: DispatchConfig,
): DispatchDashboardData {
  const fixtures = loadMspCentralFixtureResponses();
  const profiles = getInitialStaffProfiles();
  const technicians =
    mapMspCentralTechnicians(fixtures.technicianList.technicians, profiles).length > 0
      ? mapMspCentralTechnicians(fixtures.technicianList.technicians, profiles)
      : profiles.map(staffProfileToTechnician);
  const requests = mapMspCentralRequests(fixtures.requestList.requests, {
    now: new Date("2026-07-09T09:00:00+10:00"),
    profiles,
    requestWebBaseUrl: config.mspCentral.requestWebBaseUrl,
    sourceSystem: "msp-central-fixture",
  });

  return {
    appointments: [],
    calendarDataSource: config.calendarDataSource,
    calendarReadOnly: true,
    calendarStatusLabel: "MSP Fixture",
    dispatchDataSource: "msp-central-fixture",
    healthItems: buildDispatchHealthItems({
      appointments: [],
      requests,
      technicians,
    }),
    requests,
    selectedDateLabel: "MSP Central Fixture",
    selectedRequestId: requests[0]?.id ?? "",
    technicians,
    timezone: config.timezone,
  };
}

export function loadFixtureRequestDetail() {
  const fixtures = loadMspCentralFixtureResponses();
  return fixtures.requestDetail.request
    ? mapMspCentralRequest(fixtures.requestDetail.request)
    : undefined;
}
