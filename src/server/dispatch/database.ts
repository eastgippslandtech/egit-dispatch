import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";
import { buildMspCentralRequestUrl } from "@/server/msp-central/url";

import { buildDispatchHealthItems } from "./health";
import { todayDateKey } from "./date-scope";
import type {
  ActiveDispatchTimer,
  Appointment,
  DispatchDashboardData,
  DispatchRequest,
  Priority,
  RequestStatus,
  SlaState,
  Technician,
} from "./types";

export interface DispatchDashboardDatabase {
  getDashboardData(): Promise<Pick<
    DispatchDashboardData,
    "appointments" | "requests" | "technicians"
  >>;
}

type DispatchStaffRow = {
  active: boolean;
  baseOffice: string;
  calendarEnabled: boolean;
  displayName: string;
  dispatchEnabled: boolean;
  id: string;
  mspCentralEmail: string;
  mspCentralTechnicianId: string | null;
  mspCentralTechnicianName: string | null;
  outlookEmail: string;
  outlookUserPrincipalName: string;
  role: "admin" | "technician";
  storeLocation: string | null;
  technicianDisplayName: string | null;
  technicianId: string | null;
  technicianOutlookEmail: string | null;
  technicianSdpId: string | null;
  zohoEmail: string;
  zohoPeopleEmployeeId: string | null;
};

type DispatchLinkRow = {
  assignmentRole: "crew" | "lead";
  id: string;
  lastSyncError: string | null;
  lastSyncStatus: string;
  notes: Array<{
    action: string;
    createdAt: string | Date;
    message: string | null;
    payloadSummary: unknown;
    status: string;
  }>;
  outlookCalendarEmail: string | null;
  outlookEventId: string | null;
  scheduledEnd: string | Date | null;
  scheduledStart: string | Date | null;
  sdpRequestId: string;
  sdpRequestNumber: string;
  staffId: string | null;
  technicianDisplayName: string | null;
  technicianId: string | null;
  technicianOutlookEmail: string | null;
  updatedAt: string | Date;
};

let databaseSingleton: DispatchDashboardDatabase | undefined;

export function getConfiguredDispatchDashboardDatabase(
  databaseUrl = process.env.DATABASE_URL,
): DispatchDashboardDatabase | null {
  if (!databaseUrl?.trim()) {
    return null;
  }

  databaseSingleton ??= createPostgresDispatchDashboardDatabase({ databaseUrl });
  return databaseSingleton;
}

export function createPostgresDispatchDashboardDatabase({
  databaseUrl = process.env.DATABASE_URL,
  sql = getPostgresSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): DispatchDashboardDatabase {
  return {
    async getDashboardData() {
      const [staffRows, linkRows] = await Promise.all([
        selectStaffRows(sql),
        selectDispatchRows(sql),
      ]);
      const technicians = staffRows.map(mapTechnician);
      const technicianIdsByStaffId = new Map(
        staffRows.map((staff) => [staff.id, technicianIdForStaff(staff)]),
      );
      const technicianIdsByTechnicianId = new Map(
        staffRows
          .filter((staff) => staff.technicianId)
          .map((staff) => [
            staff.technicianId as string,
            technicianIdForStaff(staff),
          ]),
      );
      const requests = linkRows.filter((row) => row.assignmentRole === "lead").map((row) =>
        mapRequest(row, { technicianIdsByStaffId, technicianIdsByTechnicianId }),
      );
      const appointments = linkRows
        .filter((row) => row.scheduledStart && row.scheduledEnd)
        .map((row) =>
          mapAppointment(row, { technicianIdsByStaffId, technicianIdsByTechnicianId }),
        );

      return { appointments, requests, technicians };
    },
  };
}

function getPostgresSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for Command Centre dispatch data.");
  }

  return getSharedPostgresClient(databaseUrl);
}

function selectStaffRows(sql: postgres.Sql) {
  return sql<DispatchStaffRow[]>`
    select
      sp.id::text as "id",
      sp.display_name as "displayName",
      sp.role::text as "role",
      sp.base_office as "baseOffice",
      sp.zoho_email as "zohoEmail",
      (to_jsonb(sp) ->> 'zoho_people_employee_id') as "zohoPeopleEmployeeId",
      sp.outlook_email as "outlookEmail",
      sp.outlook_user_principal_name as "outlookUserPrincipalName",
      sp.msp_central_email as "mspCentralEmail",
      sp.msp_central_technician_id as "mspCentralTechnicianId",
      sp.msp_central_technician_name as "mspCentralTechnicianName",
      sp.active,
      sp.dispatch_enabled as "dispatchEnabled",
      sp.calendar_enabled as "calendarEnabled",
      t.id::text as "technicianId",
      t.display_name as "technicianDisplayName",
      t.outlook_email as "technicianOutlookEmail",
      t.sdp_technician_id as "technicianSdpId",
      t.store_location as "storeLocation"
    from public.staff_profiles sp
    left join public.technicians t on lower(sp.outlook_email) = lower(t.outlook_email)
      or (
        sp.msp_central_technician_id is not null
        and t.sdp_technician_id is not null
        and sp.msp_central_technician_id = t.sdp_technician_id
      )
    where sp.dispatch_enabled = true
    order by sp.display_name
  `;
}

function selectDispatchRows(sql: postgres.Sql) {
  return sql<DispatchLinkRow[]>`
    with assignments as (
      select
        dl.id as assignment_id,
        dl.id as dispatch_link_id,
        dl.technician_id as assignment_technician_id,
        dl.outlook_event_id,
        dl.outlook_calendar_email,
        dl.last_sync_status,
        dl.last_sync_error,
        'lead'::text as assignment_role
      from public.dispatch_links dl

      union all

      select
        crew.id as assignment_id,
        crew.dispatch_link_id,
        crew.technician_id as assignment_technician_id,
        crew.outlook_event_id,
        crew.outlook_calendar_email,
        crew.last_sync_status,
        crew.last_sync_error,
        'crew'::text as assignment_role
      from public.dispatch_link_crew crew
    )
    select
      assignments.assignment_id::text as "id",
      assignments.assignment_role as "assignmentRole",
      dl.sdp_request_id as "sdpRequestId",
      dl.sdp_request_number as "sdpRequestNumber",
      assignments.outlook_event_id as "outlookEventId",
      assignments.outlook_calendar_email as "outlookCalendarEmail",
      assignments.assignment_technician_id::text as "technicianId",
      dl.scheduled_start as "scheduledStart",
      dl.scheduled_end as "scheduledEnd",
      assignments.last_sync_status::text as "lastSyncStatus",
      assignments.last_sync_error as "lastSyncError",
      dl.updated_at as "updatedAt",
      sp.id::text as "staffId",
      t.display_name as "technicianDisplayName",
      t.outlook_email as "technicianOutlookEmail",
      coalesce(logs.notes, '[]'::jsonb) as "notes"
    from assignments
    join public.dispatch_links dl on dl.id = assignments.dispatch_link_id
    left join public.technicians t
      on t.id = assignments.assignment_technician_id
    left join public.staff_profiles sp on lower(sp.outlook_email) = lower(t.outlook_email)
      or (
        sp.msp_central_technician_id is not null
        and t.sdp_technician_id is not null
        and sp.msp_central_technician_id = t.sdp_technician_id
      )
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'action', latest.action,
          'status', latest.status::text,
          'message', latest.message,
          'payloadSummary', latest.payload_summary,
          'createdAt', latest.created_at
        )
        order by latest.created_at desc
      ) as notes
      from (
        select action, status, message, payload_summary, created_at
        from public.dispatch_sync_logs
        where sdp_request_id = dl.sdp_request_id
        order by created_at desc
        limit 20
      ) latest
    ) logs on true
    order by coalesce(dl.scheduled_start, dl.updated_at), dl.sdp_request_number
  `;
}

export function buildDatabaseDispatchDashboardData(
  data: Pick<DispatchDashboardData, "appointments" | "requests" | "technicians">,
): DispatchDashboardData {
  return {
    ...data,
    calendarDataSource: "mock",
    calendarReadOnly: true,
    calendarStatusLabel: "Command Centre DB",
    dispatchDataSource: "command-centre-db",
    healthItems: buildDispatchHealthItems(data),
    selectedDateLabel: todayDateKey(),
    selectedRequestId: data.requests[0]?.id ?? "",
    timezone: "Australia/Melbourne",
  };
}

function mapTechnician(row: DispatchStaffRow): Technician {
  const baseOfficeId = row.baseOffice === "Sale" ? "sale" : "bairnsdale";

  return {
    id: technicianIdForStaff(row),
    active: row.active,
    baseOfficeAddress:
      baseOfficeId === "sale"
        ? "387 Raymond Street, Sale VIC 3850"
        : "137 Main Street, Bairnsdale VIC 3875",
    baseOfficeId,
    baseOfficeName: row.baseOffice,
    calendarEnabled: row.calendarEnabled,
    displayName: row.displayName,
    mappingStatus:
      row.technicianId || row.mspCentralEmail || row.mspCentralTechnicianId
        ? "mapped"
        : "missing-sdp",
    mspCentralEmail: row.mspCentralEmail,
    mspCentralTechnicianId: row.mspCentralTechnicianId,
    mspCentralTechnicianName: row.mspCentralTechnicianName,
    outlookEmail: row.outlookEmail,
    outlookUserPrincipalName: row.outlookUserPrincipalName,
    role: row.role,
    sdpTechnicianName: row.mspCentralTechnicianName ?? undefined,
    storeLocation: row.storeLocation ?? row.baseOffice,
    zohoEmail: row.zohoEmail,
    zohoPeopleEmployeeId: row.zohoPeopleEmployeeId,
  };
}

function mapRequest(
  row: DispatchLinkRow,
  {
    technicianIdsByStaffId,
    technicianIdsByTechnicianId,
  }: {
    technicianIdsByStaffId: Map<string, string>;
    technicianIdsByTechnicianId: Map<string, string>;
  },
): DispatchRequest {
  const summaries = payloadSummaries(row);
  const scheduledStart = toOptionalIso(row.scheduledStart);
  const scheduledEnd = toOptionalIso(row.scheduledEnd);
  const dueAt =
    pickString(summaries, ["slaDueAt", "dueAt", "dueBy"]) ??
    scheduledEnd ??
    toIsoString(row.updatedAt);

  return {
    id: row.sdpRequestId,
    activeTimer: activeTimerFromLogs(row),
    ageHours: estimateAgeHours(pickString(summaries, ["createdAt", "createdTime"])),
    billable: pickBoolean(summaries, ["billable", "isBillable"]) ?? true,
    contact:
      pickString(summaries, ["contactPhone", "phone", "requesterEmail", "contactEmail"]) ??
      "Unknown contact",
    customer:
      pickString(summaries, ["customerName", "customer", "accountName", "account"]) ??
      "Unknown customer",
    dueAt,
    helpdeskUrl: pickString(summaries, ["helpdeskUrl", "requestUrl", "url"]) ?? undefined,
    notes:
      pickString(summaries, [
        "description",
        "requestDescription",
        "ticketDescription",
        "details",
        "note",
        "body",
      ]) ?? undefined,
    priority: pickPriority(summaries),
    readyToBook: !scheduledStart && row.lastSyncStatus !== "failed",
    requester:
      pickString(summaries, ["requesterName", "requester", "contactName"]) ??
      "Unknown requester",
    requestNumber: row.sdpRequestNumber,
    scheduledEnd: scheduledEnd ?? undefined,
    scheduledStart: scheduledStart ?? undefined,
    site: pickString(summaries, ["siteName", "site"]) ?? "Unknown site",
    siteAddress: pickString(summaries, ["siteAddress", "address"]) ?? undefined,
    siteArea: pickString(summaries, ["siteArea", "area", "siteTown", "town"]) ?? undefined,
    siteName: pickString(summaries, ["siteName", "site"]) ?? undefined,
    siteTown: pickString(summaries, ["siteTown", "town", "city"]) ?? undefined,
    slaState: pickSlaState(summaries, dueAt),
    sourceSystem: "command-centre-db",
    status: pickStatus(summaries, scheduledStart),
    subject:
      pickString(summaries, ["subject", "title", "requestSubject", "ticketSubject"]) ??
      `Request ${row.sdpRequestNumber}`,
    technicianId: resolveTechnicianId(row, {
      technicianIdsByStaffId,
      technicianIdsByTechnicianId,
    }),
    updatedAt: toIsoString(row.updatedAt),
    warnings: [
      row.lastSyncStatus === "failed" ? row.lastSyncError ?? "Sync failed" : undefined,
      row.lastSyncStatus === "needs_review" ? "Needs review" : undefined,
      !row.technicianId ? "No technician assigned" : undefined,
    ].filter((warning): warning is string => Boolean(warning)),
  };
}

function activeTimerFromLogs(row: DispatchLinkRow): ActiveDispatchTimer | undefined {
  const stoppedTimerIds = new Set<string>();

  for (const note of row.notes) {
    if (note.action !== "mobile_timer_start" && note.action !== "mobile_timer_stop") {
      continue;
    }

    const payload = asRecord(note.payloadSummary);
    const timer = asRecord(payload.timer);
    const timerId = pickNestedString(timer, ["id"]);

    if (!timerId) {
      continue;
    }

    if (note.action === "mobile_timer_stop") {
      stoppedTimerIds.add(timerId);
      continue;
    }

    if (stoppedTimerIds.has(timerId)) {
      continue;
    }

    const jobId = pickNestedString(timer, ["jobId"]);
    const startedAt = pickNestedString(timer, ["startedAt"]);
    const technicianId = pickNestedString(timer, ["technicianId"]);

    if (!jobId || !startedAt || !technicianId) {
      continue;
    }

    return {
      id: timerId,
      jobId,
      startedAt,
      technicianId,
      technicianName:
        pickNestedString(timer, ["technicianName"]) ??
        row.technicianDisplayName ??
        undefined,
    };
  }

  return undefined;
}

function mapAppointment(
  row: DispatchLinkRow,
  maps: {
    technicianIdsByStaffId: Map<string, string>;
    technicianIdsByTechnicianId: Map<string, string>;
  },
): Appointment {
  const summaries = payloadSummaries(row);
  const start = toIsoString(row.scheduledStart ?? row.updatedAt);
  const end = toIsoString(
    row.scheduledEnd ?? new Date(new Date(start).getTime() + 60 * 60 * 1000),
  );

  return {
    id: row.id,
    calendarOwnerEmail: row.outlookCalendarEmail ?? undefined,
    customer:
      pickString(summaries, ["customerName", "customer", "accountName", "account"]) ??
      "Unknown customer",
    date: formatMelbourneDate(start),
    end: formatMelbourneTime(end),
    helpdeskUrl:
      pickString(summaries, ["helpdeskUrl", "requestUrl", "url"]) ??
      buildMspCentralRequestUrl(row.sdpRequestNumber),
    outlookEventId: row.outlookEventId ?? undefined,
    readOnly: true,
    requestId: row.sdpRequestId,
    source: "linked",
    start: formatMelbourneTime(start),
    status: row.lastSyncStatus === "needs_review" ? "tentative" : "confirmed",
    syncIssue:
      row.lastSyncStatus === "failed"
        ? "time-mismatch"
        : row.lastSyncStatus === "needs_review"
          ? "missing-calendar"
          : undefined,
    technicianId: resolveTechnicianId(row, maps) ?? "tech-unassigned",
    title:
      pickString(summaries, ["subject", "title", "requestSubject", "ticketSubject"]) ??
      `Request ${row.sdpRequestNumber}`,
  };
}

function technicianIdForStaff(row: Pick<DispatchStaffRow, "displayName" | "technicianId">) {
  return row.technicianId ?? `tech-${slug(row.displayName)}`;
}

function resolveTechnicianId(
  row: Pick<DispatchLinkRow, "staffId" | "technicianId" | "technicianDisplayName">,
  {
    technicianIdsByStaffId,
    technicianIdsByTechnicianId,
  }: {
    technicianIdsByStaffId: Map<string, string>;
    technicianIdsByTechnicianId: Map<string, string>;
  },
) {
  if (row.staffId) {
    const staffMatch = technicianIdsByStaffId.get(row.staffId);
    if (staffMatch) return staffMatch;
  }

  if (row.technicianId) {
    return technicianIdsByTechnicianId.get(row.technicianId) ?? row.technicianId;
  }

  return row.technicianDisplayName
    ? `tech-${slug(row.technicianDisplayName)}`
    : undefined;
}

function payloadSummaries(row: DispatchLinkRow) {
  return row.notes
    .map((note) => asRecord(note.payloadSummary))
    .filter((summary) => Object.keys(summary).length > 0);
}

function pickString(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const direct = pickNestedString(record, [key]);
      if (direct) return direct;
      const request = pickNestedString(record, ["request", key]);
      if (request) return request;
      const ticket = pickNestedString(record, ["ticket", key]);
      if (ticket) return ticket;
      const sdp = pickNestedString(record, ["sdp", key]);
      if (sdp) return sdp;
    }
  }
  return null;
}

function pickNestedString(record: Record<string, unknown>, path: string[]) {
  let value: unknown = record;
  for (const part of path) {
    if (!isRecord(value)) return null;
    value = value[part];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (isRecord(value) && typeof value.name === "string") {
    return value.name.trim() || null;
  }

  return null;
}

function pickBoolean(records: Array<Record<string, unknown>>, keys: string[]) {
  for (const record of records) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "boolean") return value;
    }
  }
  return null;
}

function pickPriority(records: Array<Record<string, unknown>>): Priority {
  const priority = pickString(records, ["priority", "impact"]);
  const normalized = priority?.toLowerCase() ?? "";
  if (normalized.includes("critical") || normalized.includes("urgent")) {
    return "Critical";
  }
  if (normalized.includes("high")) return "High";
  if (normalized.includes("low")) return "Low";
  return "Medium";
}

function pickStatus(
  records: Array<Record<string, unknown>>,
  scheduledStart: string | null,
): RequestStatus {
  const status = pickString(records, ["status", "requestStatus", "ticketStatus"]);
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("resolved") || normalized.includes("closed")) {
    return "Resolved";
  }
  if (scheduledStart || normalized.includes("scheduled")) {
    return "Scheduled";
  }
  if (normalized.includes("ready")) {
    return "Ready for Scheduling";
  }
  return "Open";
}

function pickSlaState(
  records: Array<Record<string, unknown>>,
  dueAt: string,
): SlaState {
  const state = pickString(records, ["slaState", "slaStatus"]);
  const normalized = state?.toLowerCase() ?? "";
  if (normalized.includes("overdue") || normalized.includes("violated")) {
    return "overdue";
  }
  if (normalized.includes("due") || normalized.includes("risk")) {
    return "due-soon";
  }

  const hoursUntilDue = (new Date(dueAt).getTime() - Date.now()) / 3_600_000;
  if (Number.isFinite(hoursUntilDue)) {
    if (hoursUntilDue < 0) return "overdue";
    if (hoursUntilDue <= 4) return "due-soon";
  }
  return "normal";
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function estimateAgeHours(createdAt: string | null) {
  if (!createdAt) return 0;
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) return 0;
  return Math.max(0, Math.round((Date.now() - createdTime) / 3_600_000));
}

function toOptionalIso(value: string | Date | null) {
  return value ? toIsoString(value) : null;
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function formatMelbourneDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Australia/Melbourne",
    year: "numeric",
  }).format(new Date(value));
}

function formatMelbourneTime(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "Australia/Melbourne",
  }).format(new Date(value));
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
