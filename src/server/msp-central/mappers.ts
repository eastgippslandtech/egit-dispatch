import type {
  DispatchRequest,
  Priority,
  RequestSentiment,
  RequestStatus,
  SlaState,
} from "@/server/dispatch/types";
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

const ADVANCED_WORKS_AUTO_ASSIGNMENT_WARNING =
  "Auto-assigned by Advanced Works/Viridian IT site proximity.";

const OFFICE_COORDINATES = {
  bairnsdale: { latitude: -37.8251, longitude: 147.6305 },
  sale: { latitude: -38.106, longitude: 147.067 },
} as const;

const SITE_COORDINATES = [
  ["bairnsdale", -37.8251, 147.6305],
  ["lakes entrance", -37.881, 147.981],
  ["lake tyers", -37.85, 148.075],
  ["metung", -37.891, 147.853],
  ["paynesville", -37.918, 147.719],
  ["eagle point", -37.9, 147.683],
  ["bruthen", -37.706, 147.833],
  ["orbost", -37.707, 148.455],
  ["omeo", -37.1, 147.594],
  ["sale", -38.106, 147.067],
  ["longford", -38.17, 147.085],
  ["stratford", -37.967, 147.082],
  ["maffra", -37.966, 146.975],
  ["heyfield", -37.982, 146.785],
  ["rosedale", -38.151, 146.783],
  ["traralgon", -38.195, 146.541],
] as const;

export function mapMspCentralRequest(
  raw: MspCentralRawRequest,
  options: MapRequestOptions = {},
): DispatchRequest {
  const now = options.now ?? new Date();
  const profiles = options.profiles ?? getInitialStaffProfiles();
  const match = findStaffForMspCentralTechnician(
    normalizeTechnician(raw.technician),
    profiles,
  );
  const requestNumber = readString(raw.request_number) ?? readString(raw.id) ?? "REQ-UNKNOWN";
  const dueAt = readDateTime(raw.due_by_time) ?? new Date(0).toISOString();
  const scheduledStart = readDateTime(raw.scheduled_start_time);
  const scheduledEnd = readDateTime(raw.scheduled_end_time);
  const customer =
    readString(raw.account?.name) ??
    readString(raw.customer) ??
    "Unknown customer";
  const site = readString(raw.site?.name) ?? readString(raw.site_name) ?? "Unknown site";
  const siteAddress =
    readString(raw.site?.address) ?? readString(raw.site_address) ?? undefined;
  const siteArea = readString(raw.site?.area) ?? readString(raw.site_area) ?? undefined;
  const siteName =
    readString(raw.site?.name) ?? readString(raw.site_name) ?? undefined;
  const siteTown = readString(raw.site?.city) ?? readString(raw.site_town) ?? undefined;
  const notes = readString(raw.description);
  const autoAssignment = match.profile
    ? undefined
    : autoAssignAdvancedWorksTechnician({
        customer,
        site,
        siteAddress,
        siteArea,
        siteName,
        siteTown,
        text: [readString(raw.subject), notes],
        technicianHasIdentity: hasTechnicianIdentity(raw.technician),
        now,
      });
  const warnings = [
    ...assetWarnings(raw),
    match.warning,
    autoAssignment ? ADVANCED_WORKS_AUTO_ASSIGNMENT_WARNING : undefined,
    scheduledStart && !scheduledEnd ? "Scheduled end time missing" : undefined,
  ].filter((warning): warning is string => Boolean(warning));

  return {
    id: readString(raw.id) ?? requestNumber,
    ageHours: estimateAgeHours(readDateTime(raw.created_time), now),
    assetNames: raw.assets
      ?.map((asset) => readString(asset.name))
      .filter((asset): asset is string => Boolean(asset)),
    billable: Boolean(raw.is_billable ?? raw.billable),
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
    notes,
    onsite: Boolean(raw.is_onsite ?? raw.onsite),
    priority: mapMspCentralPriority(readPriorityStatusName(raw.priority)),
    readyToBook: isReadyToBook(raw, scheduledStart),
    requester:
      readString(raw.requester?.name) ??
      readString(raw.requester_name) ??
      "Unknown requester",
    requestNumber,
    sentiment: mapMspCentralSentiment(
      readSentiment(raw.sentiment) ??
        readSentiment(raw.sentiment_analysis) ??
        readSentiment(raw.requester_sentiment),
    ),
    scheduledEnd: scheduledEnd ?? undefined,
    scheduledStart: scheduledStart ?? undefined,
    site,
    siteAddress,
    siteArea,
    siteName,
    siteTown,
    slaState: mapMspCentralSlaState(
      readString(raw.sla?.status) ?? readString(raw.sla_status),
      dueAt,
      now,
    ),
    sourceSystem: options.sourceSystem ?? "msp-central-fixture",
    status: mapMspCentralStatus(readPriorityStatusName(raw.status), scheduledStart),
    subcategory: readPriorityStatusName(raw.subcategory),
    subject: readString(raw.subject) ?? "Untitled MSP Central request",
    technicianId: match.profile
      ? staffProfileToTechnician(match.profile).id
      : autoAssignment?.technicianId,
    updatedAt: readDateTime(raw.updated_time),
    updatedByEmail:
      readString(raw.updated_by?.email) ??
      readString(raw.last_updated_by?.email),
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

function autoAssignAdvancedWorksTechnician({
  customer,
  site,
  siteAddress,
  siteArea,
  siteName,
  siteTown,
  text,
  technicianHasIdentity,
  now,
}: {
  customer: string;
  site: string;
  siteAddress?: string;
  siteArea?: string;
  siteName?: string;
  siteTown?: string;
  text: Array<string | undefined>;
  technicianHasIdentity: boolean;
  now: Date;
}) {
  if (
    technicianHasIdentity ||
    !isAdvancedWorksCustomer(customer) ||
    !isOutsideDispatchHours(now)
  ) {
    return undefined;
  }

  const coordinates = findSiteCoordinates([
    siteTown,
    siteArea,
    siteAddress,
    siteName,
    site,
    ...text,
  ]);

  if (!coordinates) {
    return undefined;
  }

  const bairnsdaleDistance = distanceKm(coordinates, OFFICE_COORDINATES.bairnsdale);
  const saleDistance = distanceKm(coordinates, OFFICE_COORDINATES.sale);

  return {
    technicianId:
      bairnsdaleDistance <= saleDistance ? "tech-jervy" : "tech-matt",
  };
}

export function mapMspCentralSentiment(
  value?: string,
): RequestSentiment | undefined {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (
    normalized.includes("negative") ||
    normalized.includes("unhappy") ||
    normalized.includes("dissatisfied")
  ) {
    return "negative";
  }

  if (
    normalized.includes("positive") ||
    normalized.includes("happy") ||
    normalized.includes("satisfied")
  ) {
    return "positive";
  }

  if (normalized.includes("neutral")) {
    return "neutral";
  }

  return undefined;
}

export function isOutsideDispatchHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
    weekday: "short",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  const weekdays = new Set(["Mon", "Tue", "Wed", "Thu", "Fri"]);
  const minutes = hour * 60 + minute;

  return !weekday ||
    !weekdays.has(weekday) ||
    !Number.isFinite(minutes) ||
    minutes < 9 * 60 ||
    minutes >= 17 * 60;
}

function isAdvancedWorksCustomer(customer: string) {
  const normalized = normalizeText(customer);
  return normalized.includes("advanced works") ||
    normalized.includes("advancedworks") ||
    normalized.includes("viridian");
}

function findSiteCoordinates(values: Array<string | undefined>) {
  const haystack = normalizeText(values.filter(Boolean).join(" "));
  const match = SITE_COORDINATES.find(([town]) => haystack.includes(town));

  return match
    ? { latitude: match[1], longitude: match[2] }
    : undefined;
}

function distanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
) {
  const earthRadiusKm = 6371;
  const latitudeDelta = degreesToRadians(to.latitude - from.latitude);
  const longitudeDelta = degreesToRadians(to.longitude - from.longitude);
  const fromLatitude = degreesToRadians(from.latitude);
  const toLatitude = degreesToRadians(to.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) *
      Math.cos(toLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function degreesToRadians(degrees: number) {
  return degrees * (Math.PI / 180);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function readSentiment(
  value?:
    | string
    | { name?: string | null; value?: string | null }
    | null,
) {
  if (typeof value === "string") {
    return readString(value);
  }

  return readString(value?.name) ?? readString(value?.value);
}

function normalizeTechnician(technician?: MspCentralRawTechnician | null) {
  return {
    email: readString(technician?.email),
    id: readString(technician?.id),
    name: readString(technician?.name),
  };
}

function hasTechnicianIdentity(technician?: MspCentralRawTechnician | null) {
  return Boolean(
    readString(technician?.email) ||
      readString(technician?.id) ||
      readString(technician?.name),
  );
}

function readString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const text = String(value).trim();
  return text ? text : undefined;
}

function readDateTime(value: unknown) {
  const candidates =
    typeof value === "object" && value !== null
      ? [
          (value as { value?: unknown }).value,
          (value as { display_value?: unknown }).display_value,
        ]
      : [value];

  for (const candidate of candidates) {
    const parsed = parseDateTimeCandidate(candidate);
    if (parsed) return parsed;
  }

  return undefined;
}

function parseDateTimeCandidate(value: unknown) {
  if (value === null || value === undefined || typeof value === "object") {
    return undefined;
  }

  const text = String(value).trim();
  if (!text) return undefined;

  const numeric = Number(text);
  const timestamp =
    Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(text)
      ? numeric < 100_000_000_000
        ? numeric * 1000
        : numeric
      : Date.parse(text);
  if (!Number.isFinite(timestamp)) return undefined;

  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
