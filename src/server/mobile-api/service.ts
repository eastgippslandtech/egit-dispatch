import {
  cloneMobileFixture,
  MOBILE_JOB_FIXTURES,
  MOBILE_STAFF_FIXTURES,
} from "../../../apps/technician-mobile/src/testing/fixtures";
import type { MobileJob } from "../../../apps/technician-mobile/src/contracts/mobile";
import type {
  ActiveTimer,
  BookingType,
  MobileJobNote,
  MobileJobPermissions,
  MobileJobStatus,
  MobilePriority,
  MobileStaff,
  MutationReceipt,
  StartTimerCommand,
  StoppedTimer,
  StopTimerCommand,
  SyncState,
} from "../../../apps/technician-mobile/src/contracts/mobile";

import type { MobileAuthContext, MobileWorklogCommand } from "./contracts";
import {
  getConfiguredMobileDatabase,
  type DatabaseJobNoteRow,
  type DatabaseJobRow,
  type DatabaseStaffRow,
  type MobileDatabase,
} from "./database";

export const rileyMobileAuth: MobileAuthContext = {
  email: "riley@egit.com.au",
  staffId: "staff-riley",
};

export async function getMobileMe({ auth }: { auth: MobileAuthContext }) {
  const database = getConfiguredMobileDatabase();
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    return { staff: mapDatabaseStaff(staff) };
  }

  const staff = MOBILE_STAFF_FIXTURES.find(
    (candidate) => candidate.email.toLowerCase() === auth.email.toLowerCase(),
  );
  if (!staff) {
    throw Object.assign(new Error("Mobile staff profile was not found."), {
      status: 404,
    });
  }
  return { staff: cloneMobileFixture(staff) };
}

export async function listMobileJobs({
  auth,
  database = getConfiguredMobileDatabase(),
  from,
  to,
}: {
  auth: MobileAuthContext;
  database?: MobileDatabase | null;
  from: string;
  to: string;
}): Promise<{ jobs: MobileJob[] }> {
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    const jobs = await database.listJobsForStaff({
      from,
      staffId: staff.id,
      to,
    });

    return { jobs: jobs.map(mapDatabaseJob) };
  }

  return {
    jobs: MOBILE_JOB_FIXTURES.filter(
      (job) => job.technician.email.toLowerCase() === auth.email.toLowerCase(),
    )
      .filter((job) => {
        const date = job.startAt.slice(0, 10);
        return date >= from && date <= to;
      })
      .sort((left, right) => left.startAt.localeCompare(right.startAt))
      .map(cloneMobileFixture),
  };
}

export async function getMobileJob({
  auth,
  database = getConfiguredMobileDatabase(),
  jobId,
}: {
  auth: MobileAuthContext;
  database?: MobileDatabase | null;
  jobId: string;
}): Promise<{ job: MobileJob }> {
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    const job = await database.findJobForStaff({ jobId, staffId: staff.id });
    if (!job) {
      throw Object.assign(new Error("Mobile job was not found."), {
        code: "NOT_FOUND",
        status: 404,
      });
    }
    return { job: mapDatabaseJob(job) };
  }

  const job = findOwnedJob(auth, jobId);
  return { job: cloneMobileFixture(job) };
}

export async function saveMobileWorklog({
  auth,
  command,
  database = getConfiguredMobileDatabase(),
  jobId,
}: {
  auth: MobileAuthContext;
  command: MobileWorklogCommand;
  database?: MobileDatabase | null;
  jobId: string;
}) {
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    const job = await database.findJobForStaff({ jobId, staffId: staff.id });
    if (!job) {
      throw Object.assign(new Error("Mobile job was not found."), {
        code: "NOT_FOUND",
        status: 404,
      });
    }

    const mobileJob = mapDatabaseJob(job);
    if (!mobileJob.permissions.canWriteWorklog) {
      throw Object.assign(
        new Error(
          mobileJob.permissions.readOnlyReason ?? "This source is read-only.",
        ),
        { code: "READ_ONLY_SOURCE", status: 409 },
      );
    }

    const body = worklogBody(command);
    if (!body) {
      throw Object.assign(new Error("Worklog body is required."), {
        code: "BAD_REQUEST",
        status: 400,
      });
    }

    const saved = await database.saveWorklog({
      billable: command.billable,
      body,
      clientMutationId: command.clientMutationId,
      durationMinutes: command.durationMinutes,
      endedAt: command.endedAt,
      installationId: command.installationId,
      job,
      occurredAt: command.occurredAt,
      startedAt: command.startedAt,
      timerSessionId: command.timerSessionId,
      visibility: command.visibility,
      workType: command.workType,
    });

    return {
      receipt: {
        clientMutationId: command.clientMutationId,
        mode: "database",
        resourceId: saved.resourceId,
        resourceVersion: saved.resourceVersion,
        status: "pending",
        recordedAt: saved.recordedAt,
      } satisfies MutationReceipt,
    };
  }

  const job = findOwnedJob(auth, jobId);
  if (!job.permissions.canWriteWorklog) {
    throw Object.assign(
      new Error(job.permissions.readOnlyReason ?? "This source is read-only."),
      { code: "READ_ONLY_SOURCE", status: 409 },
    );
  }

  const body = worklogBody(command);
  if (!body) {
    throw Object.assign(new Error("Worklog body is required."), {
      code: "BAD_REQUEST",
      status: 400,
    });
  }

  return {
    receipt: {
      clientMutationId: command.clientMutationId,
      resourceId: `note-${command.clientMutationId}`,
      resourceVersion: `${job.version}-note`,
      status: "applied" as const,
    },
  };
}

export async function startMobileTimer({
  auth,
  command,
  database = getConfiguredMobileDatabase(),
  jobId,
}: {
  auth: MobileAuthContext;
  command: StartTimerCommand;
  database?: MobileDatabase | null;
  jobId: string;
}): Promise<{ timer: ActiveTimer }> {
  const job = database
    ? mapDatabaseJob(
        await requireDatabaseJobForStaff({
          auth,
          database,
          jobId,
        }),
      )
    : findOwnedJob(auth, jobId);

  if (!job.permissions.canStartTimer) {
    throw Object.assign(
      new Error(job.permissions.readOnlyReason ?? "A timer cannot be started for this job."),
      { code: "READ_ONLY_SOURCE", status: 409 },
    );
  }

  const startedAt = requireIsoTimestamp(command.occurredAt, "Timer start time");
  return {
    timer: {
      accumulatedPausedSeconds: 0,
      id: `timer-${command.clientMutationId}`,
      jobId,
      pausedAt: null,
      startedAt,
      technicianId: job.technician.id,
    },
  };
}

export async function stopMobileTimer({
  auth,
  command,
  database = getConfiguredMobileDatabase(),
  jobId,
}: {
  auth: MobileAuthContext;
  command: StopTimerCommand;
  database?: MobileDatabase | null;
  jobId: string;
}): Promise<{ timer: StoppedTimer }> {
  const job = database
    ? mapDatabaseJob(
        await requireDatabaseJobForStaff({
          auth,
          database,
          jobId,
        }),
      )
    : findOwnedJob(auth, jobId);

  if (!job.permissions.canStartTimer) {
    throw Object.assign(
      new Error(job.permissions.readOnlyReason ?? "A timer cannot be stopped for this job."),
      { code: "READ_ONLY_SOURCE", status: 409 },
    );
  }

  const startedAt = requireIsoTimestamp(command.startedAt, "Timer start time");
  const stoppedAt = requireIsoTimestamp(command.occurredAt, "Timer stop time");
  if (new Date(stoppedAt) < new Date(startedAt)) {
    throw Object.assign(new Error("Timer stop time cannot be before its start time."), {
      code: "BAD_REQUEST",
      status: 400,
    });
  }

  const actualElapsedMinutes = Math.max(
    1,
    Math.ceil((new Date(stoppedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );

  return {
    timer: {
      accumulatedPausedSeconds: 0,
      actualElapsedMinutes,
      id: command.timerId,
      jobId,
      pausedAt: null,
      roundedMinutes: Math.ceil(actualElapsedMinutes / 15) * 15,
      startedAt,
      stoppedAt,
      technicianId: job.technician.id,
    },
  };
}

export async function completeMobileJob({
  auth,
  command,
  database = getConfiguredMobileDatabase(),
  jobId,
}: {
  auth: MobileAuthContext;
  command: MobileWorklogCommand;
  database?: MobileDatabase | null;
  jobId: string;
}) {
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    const job = await database.findJobForStaff({ jobId, staffId: staff.id });
    if (!job) {
      throw Object.assign(new Error("Mobile job was not found."), {
        code: "NOT_FOUND",
        status: 404,
      });
    }

    const mobileJob = mapDatabaseJob(job);
    if (!mobileJob.permissions.canComplete) {
      throw Object.assign(
        new Error(mobileJob.permissions.readOnlyReason ?? "This source is read-only."),
        { code: "READ_ONLY_SOURCE", status: 409 },
      );
    }

    const body = worklogBody(command);
    if (!body) {
      throw Object.assign(new Error("Completion worklog body is required."), {
        code: "BAD_REQUEST",
        status: 400,
      });
    }

    const targetStatus = command.followUpNeeded ? "Needs Follow-up" : "Resolved";
    const saved = await database.saveWorklog({
      action: "mobile_completion",
      billable: command.billable,
      body,
      clientMutationId: command.clientMutationId,
      durationMinutes: command.durationMinutes,
      endedAt: command.endedAt,
      followUpNeeded: command.followUpNeeded,
      installationId: command.installationId,
      job,
      occurredAt: command.occurredAt,
      startedAt: command.startedAt,
      targetStatus,
      timerSessionId: command.timerSessionId,
      visibility: command.visibility,
      workType: command.workType,
    });

    return {
      receipt: {
        clientMutationId: command.clientMutationId,
        mode: "database",
        resourceId: saved.resourceId,
        resourceVersion: saved.resourceVersion,
        status: "pending",
        recordedAt: saved.recordedAt,
      } satisfies MutationReceipt,
    };
  }

  const job = findOwnedJob(auth, jobId);
  if (!job.permissions.canComplete) {
    throw Object.assign(
      new Error(job.permissions.readOnlyReason ?? "This source is read-only."),
      { code: "READ_ONLY_SOURCE", status: 409 },
    );
  }

  const body = worklogBody(command);
  if (!body) {
    throw Object.assign(new Error("Completion worklog body is required."), {
      code: "BAD_REQUEST",
      status: 400,
    });
  }

  return {
    receipt: {
      clientMutationId: command.clientMutationId,
      resourceId: `complete-${command.clientMutationId}`,
      resourceVersion: `${job.version}-complete`,
      status: "applied" as const,
    },
  };
}

export async function registerMobilePushToken({
  appVersion,
  installationId,
  platform,
}: {
  appVersion: string;
  installationId: string;
  platform: string;
  pushToken: string;
}) {
  return {
    device: {
      appVersion,
      installationId,
      platform,
      registered: true,
    },
  };
}

function findOwnedJob(auth: MobileAuthContext, jobId: string): MobileJob {
  const job = MOBILE_JOB_FIXTURES.find((candidate) => candidate.id === jobId);
  if (!job || job.technician.email.toLowerCase() !== auth.email.toLowerCase()) {
    throw Object.assign(new Error("Mobile job was not found."), {
      code: "NOT_FOUND",
      status: 404,
    });
  }
  return job;
}

async function requireDatabaseStaff(database: MobileDatabase, zohoEmail: string) {
  const staff = await database.findStaffByZohoEmail(zohoEmail);
  if (!staff) {
    throw Object.assign(new Error("Mobile staff profile was not found."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }
  return staff;
}

async function requireDatabaseJobForStaff({
  auth,
  database,
  jobId,
}: {
  auth: MobileAuthContext;
  database: MobileDatabase;
  jobId: string;
}) {
  const staff = await requireDatabaseStaff(database, auth.email);
  const job = await database.findJobForStaff({ jobId, staffId: staff.id });
  if (!job) {
    throw Object.assign(new Error("Mobile job was not found."), {
      code: "NOT_FOUND",
      status: 404,
    });
  }
  return job;
}

const WRITABLE_PERMISSIONS: MobileJobPermissions = {
  canAddPart: true,
  canAttachEvidence: true,
  canComplete: true,
  canSignOff: true,
  canStartTimer: true,
  canUpdateStatus: true,
  canWriteWorklog: true,
  readOnlyReason: null,
};

function mapDatabaseJob(row: DatabaseJobRow): MobileJob {
  const summaries = payloadSummaries(row);
  const startAt = toIsoString(row.scheduledStart ?? row.updatedAt);
  const endAt = toIsoString(
    row.scheduledEnd ?? new Date(new Date(startAt).getTime() + 60 * 60 * 1000),
  );
  const priority = pickPriority(summaries);
  const customerName = pickString(summaries, [
    "customerName",
    "customer",
    "accountName",
    "account",
  ]);
  const siteName = pickString(summaries, ["siteName", "site"]);

  return {
    id: row.id,
    source: "msp_central",
    requestNumber: row.sdpRequestNumber,
    outlookEventId: row.outlookEventId,
    outlookWebLink: null,
    version: `db-${row.id}-${toIsoString(row.updatedAt)}`,
    title:
      pickString(summaries, [
        "subject",
        "title",
        "requestSubject",
        "ticketSubject",
      ]) ?? `Request ${row.sdpRequestNumber}`,
    description:
      pickString(summaries, [
        "description",
        "requestDescription",
        "ticketDescription",
        "details",
      ]) ?? "No request description recorded in Command Centre yet.",
    priority,
    status: pickStatus(summaries) ?? statusFromSync(row.lastSyncStatus),
    bookingType: pickBookingType(summaries, { siteName }),
    startAt,
    endAt,
    timezone: "Australia/Melbourne",
    isAllDay: false,
    slaDueAt: pickString(summaries, ["slaDueAt", "dueAt", "dueBy"]),
    customerName,
    siteName,
    siteAddress: pickString(summaries, ["siteAddress", "address"]),
    siteTown: pickString(summaries, ["siteTown", "town", "city"]),
    contactName: pickString(summaries, ["contactName", "requesterName", "requester"]),
    contactPhone: pickString(summaries, ["contactPhone", "phone"]),
    contactEmail: pickString(summaries, ["contactEmail", "requesterEmail", "email"]),
    technician: mapDatabaseStaff(row.staff),
    tags: tagsFor(row, priority),
    travel: null,
    previousNotes: row.notes.map(mapDatabaseNote),
    parts: [],
    attachments: [],
    customerSignOff: null,
    permissions: WRITABLE_PERMISSIONS,
    syncState: syncStateFrom(row.lastSyncStatus),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function mapDatabaseStaff(row: DatabaseStaffRow): MobileStaff {
  return {
    id: row.id,
    displayName: row.displayName,
    email: row.zohoEmail,
    zohoEmail: row.zohoEmail,
    outlookEmail: row.outlookEmail,
    outlookUserPrincipalName: row.outlookUserPrincipalName,
    mspCentralEmail: row.mspCentralEmail,
    mspCentralTechnicianId: row.mspCentralTechnicianId,
    role: row.role === "admin" ? "admin" : "technician",
    baseOffice: row.baseOffice === "Sale" ? "Sale" : "Bairnsdale",
    active: row.active,
  };
}

function mapDatabaseNote(note: DatabaseJobNoteRow): MobileJobNote {
  const payload = asRecord(note.payloadSummary);
  const body =
    pickNestedString(payload, ["note"]) ??
    pickNestedString(payload, ["body"]) ??
    pickNestedString(payload, ["summary"]) ??
    note.message ??
    `${note.action} ${note.status}`;

  return {
    id: note.id,
    localId: null,
    visibility: visibilityFromPayload(payload),
    body,
    authorName: pickNestedString(payload, ["authorName"]) ?? "Command Centre",
    createdAt: toIsoString(note.createdAt),
    updatedAt: toIsoString(note.createdAt),
    syncState: note.status === "failed" ? "failed" : "synced",
    canEdit: false,
    canDelete: false,
  };
}

function payloadSummaries(row: DatabaseJobRow) {
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

function pickPriority(records: Array<Record<string, unknown>>): MobilePriority | null {
  const priority = pickString(records, ["priority", "impact"]);
  if (!priority) return null;
  const normalized = priority.toLowerCase();
  if (normalized.includes("critical") || normalized.includes("urgent")) {
    return "Critical";
  }
  if (normalized.includes("high")) return "High";
  if (normalized.includes("low")) return "Low";
  return "Medium";
}

function pickStatus(records: Array<Record<string, unknown>>): MobileJobStatus | null {
  const status = pickString(records, ["status", "requestStatus", "ticketStatus"]);
  if (!status) return null;
  const normalized = status.toLowerCase();
  if (normalized.includes("complete") || normalized.includes("resolved") || normalized.includes("closed")) {
    return "Completed";
  }
  if (normalized.includes("customer")) return "Waiting on Customer";
  if (normalized.includes("part")) return "Waiting on Parts";
  if (normalized.includes("follow")) return "Needs Follow-up";
  if (normalized.includes("progress")) return "In Progress";
  if (normalized.includes("cancel") || normalized.includes("access")) {
    return "Cancelled / No Access";
  }
  return "Scheduled";
}

function pickBookingType(
  records: Array<Record<string, unknown>>,
  { siteName }: { siteName: string | null },
): BookingType {
  const bookingType = pickString(records, ["bookingType", "jobMode", "mode"]);
  const normalized = `${bookingType ?? ""} ${siteName ?? ""}`.toLowerCase();
  if (normalized.includes("remote")) return "Remote";
  if (normalized.includes("house") || normalized.includes("workshop")) {
    return "In house";
  }
  return "Onsite";
}

function statusFromSync(status: DatabaseJobRow["lastSyncStatus"]): MobileJobStatus {
  if (status === "failed" || status === "needs_review") return "Needs Follow-up";
  return "Scheduled";
}

function syncStateFrom(status: DatabaseJobRow["lastSyncStatus"]): SyncState {
  if (status === "linked") return "synced";
  if (status === "failed") return "failed";
  if (status === "needs_review") return "conflict";
  return "pending";
}

function tagsFor(row: DatabaseJobRow, priority: MobilePriority | null) {
  return [
    priority === "Critical" || priority === "High" ? "SLA risk" : undefined,
    row.lastSyncStatus === "needs_review" ? "Needs review" : undefined,
    row.lastSyncStatus === "failed" ? "Sync failed" : undefined,
  ].filter((tag): tag is string => Boolean(tag));
}

function visibilityFromPayload(record: Record<string, unknown>) {
  const visibility = pickNestedString(record, ["visibility"])?.toLowerCase();
  return visibility === "internal" ? "internal" : "external";
}

function worklogBody(command: MobileWorklogCommand) {
  return (command.body ?? command.summary ?? "").trim();
}

function requireIsoTimestamp(value: string | undefined, label: string) {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw Object.assign(new Error(`${label} is required.`), {
      code: "BAD_REQUEST",
      status: 400,
    });
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
