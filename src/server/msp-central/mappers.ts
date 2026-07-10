import type {
  DispatchRequest,
  Priority,
  RequestStatus,
  SlaState,
} from "@/server/dispatch/types";
import { bookingTypeForRequest } from "@/server/dispatch/booking";
import {
  findStaffForMspCentralTechnician,
  getInitialStaffProfiles,
  staffProfileToTechnician,
  type StaffProfile,
} from "@/server/staff/profiles";

import type { MspCentralRawRequest, MspCentralRawTechnician } from "./types";
import { buildMspCentralRequestUrl } from "./url";

type MapRequestOptions = {
  now?: Date;
  profiles?: StaffProfile[];
  requestWebBaseUrl?: string;
  sourceSystem?: DispatchRequest["sourceSystem"];
};

export function mapMspCentralRequest(
  raw: MspCentralRawRequest,
  options: MapRequestOptions = {},
): DispatchRequest {
  const profiles = options.profiles ?? getInitialStaffProfiles();
  const match = findStaffForMspCentralTechnician(
    normalizeTechnician(raw.technician),
    profiles,
  );
  const requestNumber = readString(raw.request_number) ?? readString(raw.id) ?? "REQ-UNKNOWN";
  const dueAt = readString(raw.due_by_time) ?? new Date(0).toISOString();
  const scheduledStart = readString(raw.scheduled_start_time);
  const scheduledEnd = readString(raw.scheduled_end_time);
  const customer =
    readString(raw.account?.name) ??
    readString(raw.customer) ??
    "Unknown customer";
  const onsite = raw.is_onsite ?? raw.onsite ?? undefined;
  const site =
    readString(raw.site?.name) ?? readString(raw.site_name) ?? "Unknown site";
  const warnings = [
    ...assetWarnings(raw),
    match.warning,
    scheduledStart && !scheduledEnd ? "Scheduled end time missing" : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    id: readString(raw.id) ?? requestNumber,
    ageHours: estimateAgeHours(readString(raw.created_time), options.now),
    assetNames: raw.assets
      ?.map((asset) => readString(asset.name))
      .filter((asset): asset is string => Boolean(asset)),
    billable: Boolean(raw.is_billable ?? raw.billable),
    bookingType: bookingTypeForRequest({ customer, onsite, site }),
    category: readPriorityStatusName(raw.category),
    contact:
      readString(raw.requester?.email) ??
      readString(raw.requester_email) ??
      "Unknown contact",
    customer,
    dueAt,
    helpdeskUrl: buildMspCentralRequestUrl(
      requestNumber,
      options.requestWebBaseUrl,
    ),
    item: readPriorityStatusName(raw.item),
    notes: readString(raw.description),
    onsite,
    priority: mapMspCentralPriority(readPriorityStatusName(raw.priority)),
    readyToBook: isReadyToBook(raw, scheduledStart),
    requester:
      readString(raw.requester?.name) ??
      readString(raw.requester_name) ??
      "Unknown requester",
    requestNumber,
    scheduledEnd: scheduledEnd ?? undefined,
    scheduledStart: scheduledStart ?? undefined,
    site,
    siteAddress:
      readString(raw.site?.address) ?? readString(raw.site_address) ?? undefined,
    siteArea: readString(raw.site?.area) ?? readString(raw.site_area) ?? undefined,
    siteName:
      readString(raw.site?.name) ?? readString(raw.site_name) ?? undefined,
    siteTown: readString(raw.site?.city) ?? readString(raw.site_town) ?? undefined,
    slaState: mapMspCentralSlaState(
      readString(raw.sla?.status) ?? readString(raw.sla_status),
      dueAt,
      options.now,
    ),
    sourceSystem: options.sourceSystem ?? "msp-central-fixture",
    status: mapMspCentralStatus(readPriorityStatusName(raw.status), scheduledStart),
    subcategory: readPriorityStatusName(raw.subcategory),
    subject: readString(raw.subject) ?? "Untitled MSP Central request",
    technicianId: match.profile
      ? staffProfileToTechnician(match.profile).id
      : undefined,
    updatedAt: readString(raw.updated_time),
    warnings,
  };
}

export function mapMspCentralRequests(
  rawRequests: MspCentralRawRequest[] = [],
  options: MapRequestOptions = {},
) {
  return rawRequests.map((request) => mapMspCentralRequest(request, options));
}

export function mapMspCentralTechnicians(
  rawTechnicians: MspCentralRawTechnician[] = [],
  profiles: StaffProfile[] = getInitialStaffProfiles(),
) {
  return rawTechnicians
    .map((technician) =>
      findStaffForMspCentralTechnician(normalizeTechnician(technician), profiles),
    )
    .filter((match) => match.profile)
    .map((match) => staffProfileToTechnician(match.profile as StaffProfile));
}

export function mapMspCentralPriority(value?: string): Priority {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "critical" || normalized === "urgent") {
    return "Critical";
  }

  if (normalized === "high") {
    return "High";
  }

  if (normalized === "low") {
    return "Low";
  }

  return "Medium";
}

export function mapMspCentralStatus(
  value?: string,
  scheduledStart?: string | null,
): RequestStatus {
  const normalized = value?.trim().toLowerCase();

  if (scheduledStart || normalized === "scheduled") {
    return "Scheduled";
  }

  if (normalized === "resolved" || normalized === "closed") {
    return "Resolved";
  }

  if (normalized?.includes("ready")) {
    return "Ready for Scheduling";
  }

  return "Open";
}

export function mapMspCentralSlaState(
  value?: string,
  dueAt?: string,
  now = new Date(),
): SlaState {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "overdue" || normalized === "violated") {
    return "overdue";
  }

  if (normalized === "due-soon" || normalized === "due soon" || normalized === "risk") {
    return "due-soon";
  }

  if (dueAt) {
    const dueTime = new Date(dueAt).getTime();
    const hoursUntilDue = (dueTime - now.getTime()) / 3_600_000;

    if (Number.isFinite(hoursUntilDue)) {
      if (hoursUntilDue < 0) {
        return "overdue";
      }

      if (hoursUntilDue <= 4) {
        return "due-soon";
      }
    }
  }

  return "normal";
}

function isReadyToBook(raw: MspCentralRawRequest, scheduledStart?: string | null) {
  if (scheduledStart) {
    return false;
  }

  const readyField = raw.udf_fields?.ready_to_book;
  return readyField === true || readPriorityStatusName(raw.status)?.toLowerCase().includes("ready") === true;
}

function assetWarnings(raw: MspCentralRawRequest) {
  if (raw.assets === null) {
    return ["Assets unavailable"];
  }

  return [];
}

function estimateAgeHours(createdTime?: string, now = new Date()) {
  if (!createdTime) {
    return 0;
  }

  const created = new Date(createdTime).getTime();
  const age = Math.max(0, now.getTime() - created);
  return Math.round(age / 3_600_000);
}

function readPriorityStatusName(
  value?: string | { name?: string | null } | null,
) {
  return typeof value === "string" ? value : readString(value?.name);
}

function normalizeTechnician(technician?: MspCentralRawTechnician | null) {
  return {
    email: readString(technician?.email),
    id: readString(technician?.id),
    name: readString(technician?.name),
  };
}

function readString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const text = String(value).trim();
  return text ? text : undefined;
}
