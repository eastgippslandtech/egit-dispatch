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

import { bookingTypeForRequest } from "@/server/dispatch/booking";
import { cleanRequestTitle } from "@/server/dispatch/request-title";
import type {
  MspCentralRawAttachment,
  MspCentralRawNotification,
  MspCentralRawRequest,
  MspCentralRawRequestNote,
  MspCentralRawTechnician,
  MspCentralRawWorklog,
  MspCentralRequestUpdate,
} from "./types";
import { buildMspCentralRequestUrl } from "./url";

type MapRequestOptions = {
  now?: Date;
  profiles?: StaffProfile[];
  requestWebBaseUrl?: string;
  sourceSystem?: DispatchRequest["sourceSystem"];
};

const ADVANCED_WORKS_AUTO_ASSIGNMENT_WARNING =
  "Auto-assigned by Advanced Works/Viridian IT site proximity.";

const MIN_VALID_DATE_TIME = Date.UTC(2000, 0, 1);

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
  const technicianIdentity = normalizeTechnician(raw.technician);
  const match = findStaffForMspCentralTechnician(
    technicianIdentity,
    profiles,
  );
  const requestNumber = readMspCentralDisplayRequestNumber(raw);
  const requestLinkId = readMspCentralInternalRequestId(raw.id) ?? requestNumber;
  const dueAt = readDateTime(raw.due_by_time) ?? "";
  const scheduledStart = readDateTime(raw.scheduled_start_time);
  const scheduledEnd = readDateTime(raw.scheduled_end_time);
  const customer =
    readString(raw.account?.name) ??
    readPriorityStatusName(raw.customer) ??
    "Unknown customer";
  const notes = htmlToPlainText(raw.description);
  const notesHtml = htmlDisplayContent(raw.description);
  const inferredSiteTown = findKnownSiteTown([
    readString(raw.subject),
    notes,
    ...readUdfTextValues(raw.udf_fields),
  ]);
  const siteAddressDetails = readMspCentralSiteAddress(raw);
  const siteAddress = siteAddressDetails?.address;
  const siteArea = readString(raw.site?.area) ?? readString(raw.site_area) ?? undefined;
  const siteName =
    readString(raw.site?.name) ?? readString(raw.site_name) ?? inferredSiteTown;
  const siteTown =
    readString(raw.site?.city) ??
    readString(raw.site_town) ??
    siteAddressDetails?.city ??
    inferredSiteTown;
  const site = siteName ?? siteAddress ?? siteTown ?? "Unknown site";
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
  const contactEmail =
    readString(raw.requester?.email) ??
    readString(raw.requester?.email_id) ??
    readString(raw.requester_email);
  const contactPhone =
    readString(raw.requester?.phone) ??
    readString(raw.requester?.phone_number) ??
    readString(raw.requester?.mobile) ??
    readString(raw.requester?.mobile_number) ??
    readString(raw.requester?.contact_number) ??
    readString(raw.requester_phone) ??
    readString(raw.requester_mobile);

  const request: DispatchRequest = {
    id: readString(raw.id) ?? requestNumber,
    ageHours: estimateAgeHours(readDateTime(raw.created_time), now),
    attachments: mapMspCentralRequestAttachments(raw.attachments),
    assetNames: raw.assets
      ?.map((asset) => readString(asset.name))
      .filter((asset): asset is string => Boolean(asset)),
    billable: Boolean(raw.is_billable ?? raw.billable),
    category: readPriorityStatusName(raw.category),
    contact: contactEmail ?? contactPhone ?? "Unknown contact",
    contactEmail,
    contactPhone,
    customer,
    crmAccountId: readString(raw.account?.id),
    dueAt,
    helpdeskUrl: buildMspCentralRequestUrl(
      requestLinkId,
      options.requestWebBaseUrl,
    ),
    item: readPriorityStatusName(raw.item),
    notes,
    notesHtml,
    onsite: optionalBoolean(raw.is_onsite ?? raw.onsite),
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
    siteAddressSource: siteAddress ? "msp-central" : undefined,
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
    subject:
      cleanRequestTitle(readString(raw.subject), requestNumber) ||
      "Untitled MSP Central request",
    mspCentralTechnicianEmail: technicianIdentity.email ?? undefined,
    mspCentralTechnicianId: technicianIdentity.id ?? undefined,
    mspCentralTechnicianName: technicianIdentity.name ?? undefined,
    technicianId: match.profile
      ? staffProfileToTechnician(match.profile).id
      : autoAssignment?.technicianId,
    updatedAt: readDateTime(raw.updated_time),
    updatedByEmail:
      readString(raw.updated_by?.email) ??
      readString(raw.last_updated_by?.email),
    warnings,
  };

  return {
    ...request,
    bookingType: bookingTypeForRequest(request),
  };
}

function optionalBoolean(value: boolean | null | undefined) {
  return typeof value === "boolean" ? value : undefined;
}

export function mapMspCentralRequests(
  rawRequests: MspCentralRawRequest[] = [],
  options: MapRequestOptions = {},
) {
  return rawRequests.map((request) => mapMspCentralRequest(request, options));
}

export function mapMspCentralRequestAttachments(
  attachments: MspCentralRawAttachment[] | null | undefined = [],
) {
  return (attachments ?? [])
    .map((attachment, index) => {
      const fileName =
        readString(attachment.file_name) ??
        readString(attachment.filename) ??
        readString(attachment.name);
      if (!fileName) {
        return undefined;
      }

      return {
        id: readString(attachment.id) ?? `attachment-${index + 1}`,
        byteLength: readAttachmentByteLength(attachment.size),
        fileName,
        mimeType: readString(attachment.content_type),
        url:
          readString(attachment.url) ??
          readString(attachment.href) ??
          readString(attachment.attachment_url),
      };
    })
    .filter((attachment): attachment is NonNullable<typeof attachment> =>
      Boolean(attachment),
    );
}

export function mapMspCentralTechnicians(
  rawTechnicians: MspCentralRawTechnician[] = [],
  profiles: StaffProfile[] = getInitialStaffProfiles(),
) {
  return rawTechnicians
    .map((technician) => {
      const identity = normalizeTechnician(technician);
      const match = findStaffForMspCentralTechnician(identity, profiles);

      if (!match.profile) {
        return undefined;
      }

      return {
        ...staffProfileToTechnician(match.profile),
        mspCentralEmail: identity.email ?? match.profile.mspCentralEmail,
        mspCentralTechnicianId:
          identity.id ?? match.profile.mspCentralTechnicianId,
        mspCentralTechnicianName:
          identity.name ?? match.profile.mspCentralTechnicianName,
        sdpTechnicianName:
          identity.name ?? match.profile.mspCentralTechnicianName ?? undefined,
      };
    })
    .filter((technician): technician is NonNullable<typeof technician> =>
      Boolean(technician),
    );
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

  if (normalized === "resolved" || normalized === "closed") {
    return "Resolved";
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return "Cancelled";
  }

  if (scheduledStart || normalized === "scheduled") {
    return "Scheduled";
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

export function mapMspCentralRequestNotes(
  notes: MspCentralRawRequestNote[] = [],
) {
  const customerResponses: MspCentralRequestUpdate[] = [];
  const internalNotes: MspCentralRequestUpdate[] = [];

  notes.forEach((note, index) => {
    const body = htmlToPlainText(note.description);
    if (!body) return;

    const update = {
      author:
        readString(note.created_by?.name) ??
        readString(note.created_by?.email_id) ??
        readString(note.created_by?.email) ??
        "Unknown author",
      body,
      bodyHtml: htmlDisplayContent(note.description),
      createdAt: readDateTime(note.created_time),
      id: readString(note.id) ?? `request-note-${index}`,
    };

    const shownToRequester =
      note.show_to_requester === true ||
      (note.show_to_requester == null &&
        note.created_by?.is_technician === false);

    if (shownToRequester) {
      customerResponses.push(update);
    } else {
      internalNotes.push(update);
    }
  });

  return { customerResponses, internalNotes };
}

export function mapMspCentralRequestNotifications(
  notifications: MspCentralRawNotification[] = [],
) {
  return notifications.flatMap((notification, index) => {
    if (!isCustomerConversationNotification(notification.type)) return [];
    const body = htmlToPlainText(notification.description);
    if (!body) return [];

    return [
      {
        author:
          readString(notification.sender?.name) ??
          readString(notification.sender?.email_id) ??
          "Helpdesk",
        body,
        bodyHtml: htmlDisplayContent(notification.description),
        createdAt: readDateTime(notification.sent_time ?? notification.time),
        id: readString(notification.id) ?? `request-notification-${index}`,
      } satisfies MspCentralRequestUpdate,
    ];
  });
}

export function isCustomerConversationNotification(type?: string | null) {
  const normalized = type?.trim().toLowerCase();
  return (
    normalized === "reply" ||
    normalized === "email" ||
    normalized === "conversation"
  );
}

export function mapMspCentralRequestWorklogs(
  worklogs: MspCentralRawWorklog[] = [],
) {
  return worklogs.map((worklog, index): MspCentralRequestUpdate => ({
    author:
      readString(worklog.owner?.name) ??
      readString(worklog.owner?.email_id) ??
      readString(worklog.created_by?.name) ??
      readString(worklog.created_by?.email_id) ??
      "Unknown technician",
    body: htmlToPlainText(worklog.description) || "Work logged.",
    bodyHtml: htmlDisplayContent(worklog.description),
    createdAt:
      readDateTime(worklog.recorded_time) ??
      readDateTime(worklog.start_time) ??
      undefined,
    durationMinutes: readWorklogDurationMinutes(worklog),
    id: readString(worklog.id) ?? `request-worklog-${index}`,
    isBillable:
      typeof worklog.is_billable === "boolean"
        ? worklog.is_billable
        : undefined,
  }));
}

function readWorklogDurationMinutes(worklog: MspCentralRawWorklog) {
  const hours = Number(worklog.time_spent?.hours ?? 0);
  const minutes = Number(worklog.time_spent?.minutes ?? 0);
  const total = hours * 60 + minutes;

  if (Number.isFinite(total) && total > 0) {
    return Math.round(total);
  }

  const start = readDateTime(worklog.start_time);
  const end = readDateTime(worklog.end_time);
  if (!start || !end) {
    return undefined;
  }

  const elapsed = (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : undefined;
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
  const town = findKnownSiteTown(values)?.toLowerCase();
  const match = SITE_COORDINATES.find(([candidate]) => candidate === town);

  return match
    ? { latitude: match[1], longitude: match[2] }
    : undefined;
}

function findKnownSiteTown(values: Array<string | undefined>) {
  const haystack = ` ${normalizeText(values.filter(Boolean).join(" "))} `;
  const match = [...SITE_COORDINATES]
    .sort(([left], [right]) => right.length - left.length)
    .find(([town]) => haystack.includes(` ${town} `));

  return match?.[0].replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readMspCentralSiteAddress(raw: MspCentralRawRequest) {
  const accountShippingAddress = readString(raw.account?.shipping_address);
  const accountBillingAddress = readString(raw.account?.billing_address);

  return firstUsableAddress(
    formatStructuredAddress({
      city: raw.site?.city,
      code: raw.site?.code ?? raw.site?.postal_code ?? raw.site?.zip,
      country: raw.site?.country,
      state: raw.site?.state,
      street: raw.site?.address,
    }),
    formatStructuredAddress({
      city: raw.site?.city,
      code: raw.site?.code ?? raw.site?.postal_code ?? raw.site?.zip,
      country: raw.site?.country,
      state: raw.site?.state,
      street: raw.site_address,
    }),
    formatStructuredAddress({
      city: raw.site?.city,
      code: raw.site?.code ?? raw.site?.postal_code ?? raw.site?.zip,
      country: raw.site?.country,
      state: raw.site?.state,
      street: raw.site?.street,
    }),
    formatStructuredAddress({
      city: raw.account?.shipping_city,
      code: raw.account?.shipping_code,
      country: raw.account?.shipping_country,
      state: raw.account?.shipping_state,
      street: raw.account?.shipping_street,
    }),
    fullAddressCandidate(accountShippingAddress, raw.account?.shipping_city),
    formatStructuredAddress({
      city: raw.account?.billing_city,
      code: raw.account?.billing_code,
      country: raw.account?.billing_country,
      state: raw.account?.billing_state,
      street: raw.account?.billing_street,
    }),
    fullAddressCandidate(accountBillingAddress, raw.account?.billing_city),
    formatStructuredAddress({
      city: raw.account?.city,
      code: raw.account?.postal_code ?? raw.account?.zip,
      country: raw.account?.country,
      state: raw.account?.state,
      street: raw.account?.address ?? raw.account?.street,
    }),
  );
}

function fullAddressCandidate(
  address?: string,
  city?: string | null,
) {
  const cleanAddress = cleanAddressText(address);
  if (!cleanAddress) return undefined;

  return {
    address: cleanAddress,
    city: readString(city) ?? findKnownSiteTown([cleanAddress]),
  };
}

function firstUsableAddress(
  ...candidates: Array<{ address?: string; city?: string } | undefined>
) {
  return candidates.find((candidate) =>
    isUsableStreetAddress(candidate?.address),
  );
}

function formatStructuredAddress(parts: {
  city?: string | null;
  code?: string | null;
  country?: string | null;
  state?: string | null;
  street?: string | null;
}) {
  const street = readString(parts.street);
  if (!street) return undefined;

  const city = readString(parts.city);
  const stateAndCode = [readString(parts.state), readString(parts.code)]
    .filter(Boolean)
    .join(" ");
  const country = readString(parts.country);
  const locality = [city, stateAndCode].filter(Boolean).join(" ");
  const address = [street, locality, country].filter(Boolean).join(", ");

  return { address, city };
}

function cleanAddressText(value?: string) {
  return value
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(", ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,+/g, ",")
    .trim() || undefined;
}

function isUsableStreetAddress(address?: string) {
  const value = address?.trim();
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (
    [
      "business",
      "n/a",
      "na",
      "none",
      "remote",
      "remote / virtual",
      "unknown",
      "unknown site",
    ].includes(normalized)
  ) {
    return false;
  }

  return /\d+\s+[a-z]/i.test(value) && /[a-z]{3,}/i.test(value);
}

function readUdfTextValues(fields?: Record<string, unknown> | null) {
  if (!fields) {
    return [];
  }

  return Object.entries(fields)
    .filter(([key]) => /address|location|site|suburb|town/i.test(key))
    .map(([, value]) => readString(value));
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
    email:
      readString(technician?.email_id) ?? readString(technician?.email),
    id: readString(technician?.id),
    name: readString(technician?.name),
  };
}

function hasTechnicianIdentity(technician?: MspCentralRawTechnician | null) {
  return Boolean(
    readString(technician?.email_id) ||
      readString(technician?.email) ||
      readString(technician?.id) ||
      readString(technician?.name),
  );
}

function readString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const text = String(value).trim();
  return text ? text : undefined;
}

function readAttachmentByteLength(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim())
        : Number.NaN;

  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readMspCentralDisplayRequestNumber(raw: MspCentralRawRequest) {
  return (
    readString(raw.display_id) ??
    readString(raw.display_number) ??
    readString(raw.number) ??
    readString(raw.request_id) ??
    readString(raw.request_number) ??
    readString(raw.id) ??
    "REQ-UNKNOWN"
  );
}

function readMspCentralInternalRequestId(value: unknown) {
  const id = readString(value);
  return id && /^\d{10,}$/.test(id) ? id : undefined;
}

export function htmlToPlainText(value?: string | null) {
  const text = value?.trim();
  if (!text) return undefined;

  return text
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(?:p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*li(?:\s[^>]*)?>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || undefined;
}

function htmlDisplayContent(value?: string | null) {
  return value?.trim() || undefined;
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
  if (Number.isFinite(numeric) && numeric <= 0) {
    return undefined;
  }
  const timestamp =
    Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(text)
      ? numeric < 100_000_000_000
        ? numeric * 1000
        : numeric
      : Date.parse(text);
  if (!Number.isFinite(timestamp) || timestamp < MIN_VALID_DATE_TIME) {
    return undefined;
  }

  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
