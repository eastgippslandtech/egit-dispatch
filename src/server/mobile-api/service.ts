import {
  cloneMobileFixture,
  MOBILE_JOB_FIXTURES,
  MOBILE_STAFF_FIXTURES,
} from "../../../apps/technician-mobile/src/testing/fixtures";
import type { MobileJob } from "../../../apps/technician-mobile/src/contracts/mobile";
import type {
  BookingType,
  MobileJobNote,
  MobileJobPermissions,
  MobileJobStatus,
  MobilePriority,
  MobileStaff,
  MobileTravelContext,
  MutationReceipt,
  SyncState,
} from "../../../apps/technician-mobile/src/contracts/mobile";

import type { MobileAuthContext, MobileWorklogCommand } from "./contracts";
import { mockIsoTime } from "@/server/dispatch/date-scope";
import { readDispatchConfig } from "@/server/dispatch/env";
import { getDispatchDesignMockData } from "@/server/dispatch/mock-data";
import {
  applyDispatchTestSyncEvents,
  listDispatchTestSyncEvents,
} from "@/server/dispatch/test-sync";
import type {
  Appointment,
  DispatchDashboardData,
  DispatchRequest,
  Technician,
  TravelCalculatedFrom,
} from "@/server/dispatch/types";
import {
  getConfiguredMobileDatabase,
  type DatabaseJobNoteRow,
  type DatabaseJobRow,
  type DatabaseStaffRow,
  type MobileDatabase,
} from "./database";
import {
  getConfiguredNotificationRepository,
  type PushRegistrationRepository,
} from "@/server/notifications/repository";
import {
  getConfiguredMobileOutlookCalendar,
  type MobileOutlookCalendar,
} from "./outlook";
import { createMspCentralClient } from "@/server/msp-central/client";
import type { MspCentralClient } from "@/server/msp-central/types";
import { createGraphClient } from "@/server/graph/client";
import { validateWorklogDispositionCommand } from "@/server/worklogs/disposition";
import { createPostgresWorklogOutcomeStore } from "@/server/worklogs/outcome-store";
import { createWorklogDispositionProcessor } from "@/server/worklogs/processor";
import { createPostgresWorklogDispositionRepository } from "@/server/worklogs/repository";
import { createWorklogDispositionRuntime } from "@/server/worklogs/runtime";

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
  outlookCalendar = getConfiguredMobileOutlookCalendar(),
  to,
}: {
  auth: MobileAuthContext;
  database?: MobileDatabase | null;
  from: string;
  outlookCalendar?: MobileOutlookCalendar | null;
  to: string;
}): Promise<{ jobs: MobileJob[] }> {
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    const jobs = await database.listJobsForStaff({
      from,
      staffId: staff.id,
      to,
    });
    const testJobs = await listTestSyncedMobileJobs({ auth, from, to });
    const outlookJobs = await listOutlookMobileJobs({
      from,
      outlookCalendar,
      staff,
      to,
    });
    const linkedOutlookEventIds = new Set(
      [...jobs.map(mapDatabaseJob), ...testJobs]
        .map((job) => job.outlookEventId)
        .filter((eventId): eventId is string => Boolean(eventId)),
    );

    return {
      jobs: [
        ...jobs.map(mapDatabaseJob),
        ...testJobs,
        ...outlookJobs.filter(
          (job) =>
            !job.outlookEventId ||
            !linkedOutlookEventIds.has(job.outlookEventId),
        ),
      ].sort((left, right) => left.startAt.localeCompare(right.startAt)),
    };
  }

  if (outlookCalendar) {
    const staff = fixtureStaffAsDatabaseRow(auth);
    return {
      jobs: (
        await listOutlookMobileJobs({
          from,
          outlookCalendar,
          staff,
          to,
        })
      ).sort((left, right) => left.startAt.localeCompare(right.startAt)),
    };
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
  outlookCalendar = getConfiguredMobileOutlookCalendar(),
}: {
  auth: MobileAuthContext;
  database?: MobileDatabase | null;
  jobId: string;
  outlookCalendar?: MobileOutlookCalendar | null;
}): Promise<{ job: MobileJob }> {
  if (database) {
    const staff = await requireDatabaseStaff(database, auth.email);
    const job = await database.findJobForStaff({ jobId, staffId: staff.id });
    if (!job) {
      const testJob = await findTestSyncedMobileJob({ auth, jobId });
      if (testJob) {
        return { job: testJob };
      }
      const outlookJob = await findOutlookMobileJob({
        jobId,
        outlookCalendar,
        staff,
      });
      if (outlookJob) {
        return { job: outlookJob };
      }

      throw Object.assign(new Error("Mobile job was not found."), {
        code: "NOT_FOUND",
        status: 404,
      });
    }
    return { job: mapDatabaseJob(job) };
  }

  if (outlookCalendar && jobId.startsWith("outlook-")) {
    const outlookJob = await findOutlookMobileJob({
      jobId,
      outlookCalendar,
      staff: fixtureStaffAsDatabaseRow(auth),
    });
    if (outlookJob) {
      return { job: outlookJob };
    }
  }

  const job = findOwnedJob(auth, jobId);
  return { job: cloneMobileFixture(job) };
}

export async function saveMobileWorklog({
  auth,
  command,
  database = getConfiguredMobileDatabase(),
  jobId,
  mspClient = getConfiguredMobileMspClient(),
}: {
  auth: MobileAuthContext;
  command: MobileWorklogCommand;
  database?: MobileDatabase | null;
  jobId: string;
  mspClient?: MspCentralClient | null;
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

    const dispositionCommand = buildMobileDispositionCommand({ body, command, job });
    const dispositionResult = await processMobileDisposition({
      command: dispositionCommand,
      mspClient,
    });

    const saved = await database.saveWorklog({
      billable: command.billable,
      body,
      clientMutationId: command.clientMutationId,
      durationMinutes: command.durationMinutes,
      disposition: command.disposition,
      endedAt: command.endedAt,
      installationId: command.installationId,
      job,
      outcomeDetails: command.forwardBooking ?? command.transfer,
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
        status:
          dispositionResult?.status === "recovery_required"
            ? "recovery_required"
            : "pending",
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
  validateMobileDisposition({
    booking: command.forwardBooking
      ? {
          ...command.forwardBooking,
          customer: job.customerName ?? undefined,
          location: job.siteAddress ?? job.siteName ?? undefined,
          requestNumber: job.requestNumber ?? job.id,
          subject: job.title,
          userPrincipalName: command.forwardBooking.technicianEmail,
        }
      : undefined,
    description: body,
    disposition: command.disposition,
    durationMinutes: command.durationMinutes,
    endedAt: command.endedAt ?? command.occurredAt,
    idempotencyKey: command.clientMutationId,
    requestId: job.requestNumber ?? job.id,
    scheduled: true,
    startedAt: command.startedAt ?? command.occurredAt,
    transfer: command.transfer,
  });

  return {
    receipt: {
      clientMutationId: command.clientMutationId,
      resourceId: `note-${command.clientMutationId}`,
      resourceVersion: `${job.version}-note`,
      status: "applied" as const,
    },
  };
}

export async function completeMobileJob({
  auth,
  command,
  database = getConfiguredMobileDatabase(),
  jobId,
  mspClient = getConfiguredMobileMspClient(),
}: {
  auth: MobileAuthContext;
  command: MobileWorklogCommand;
  database?: MobileDatabase | null;
  jobId: string;
  mspClient?: MspCentralClient | null;
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

    await writeMobileWorklogToMsp({
      body,
      command,
      mspClient,
      requestId: job.sdpRequestId,
    });
    if (mspClient?.updateRequestStatus) {
      await mspClient.updateRequestStatus({
        requestId: job.sdpRequestId,
        status: command.followUpNeeded ? "Needs Follow-up" : "Resolved",
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
  auth,
  installationId,
  platform,
  repository = getConfiguredNotificationRepository(),
  pushToken,
}: {
  appVersion: string;
  auth: MobileAuthContext;
  installationId: string;
  platform: string;
  repository?: PushRegistrationRepository | null;
  pushToken: string;
}) {
  if (repository) {
    await repository.registerDevice({
      appVersion,
      installationId,
      platform,
      pushToken,
      staffEmail: auth.email,
    });
  }
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

function buildMobileDispositionCommand({
  body,
  command,
  job,
}: {
  body: string;
  command: MobileWorklogCommand;
  job: DatabaseJobRow;
}) {
  const durationMinutes = Math.max(1, Math.round(command.durationMinutes ?? 1));
  const endedAt = command.endedAt ?? command.occurredAt ?? new Date().toISOString();
  const startedAt =
    command.startedAt ??
    new Date(new Date(endedAt).getTime() - durationMinutes * 60_000).toISOString();
  const summaries = payloadSummaries(job);
  return validateMobileDisposition({
    booking: command.forwardBooking
      ? {
          ...command.forwardBooking,
          customer: pickString(summaries, ["customerName", "customer"]) ?? undefined,
          location:
            pickString(summaries, ["siteAddress", "address", "siteName", "site"]) ??
            undefined,
          requestNumber: job.sdpRequestNumber,
          subject:
            pickString(summaries, ["subject", "title"]) ??
            `Request ${job.sdpRequestNumber}`,
          userPrincipalName: command.forwardBooking.technicianEmail,
        }
      : undefined,
    currentBooking: {
      eventId: job.outlookEventId ?? undefined,
      userPrincipalName: job.outlookCalendarEmail ?? undefined,
    },
    description: body,
    disposition: command.disposition,
    durationMinutes,
    endedAt,
    idempotencyKey: command.clientMutationId,
    requestId: job.sdpRequestId,
    scheduled: Boolean(job.scheduledStart && job.scheduledEnd),
    startedAt,
    transfer: command.transfer,
  });
}

function validateMobileDisposition(
  input: Parameters<typeof validateWorklogDispositionCommand>[0],
) {
  try {
    return validateWorklogDispositionCommand(input);
  } catch (error) {
    throw Object.assign(
      error instanceof Error ? error : new Error("Invalid Work Log outcome."),
      { code: "BAD_REQUEST", status: 400 },
    );
  }
}

async function processMobileDisposition({
  command,
  mspClient,
}: {
  command: ReturnType<typeof buildMobileDispositionCommand>;
  mspClient: MspCentralClient | null;
}) {
  const config = readDispatchConfig();
  if (!mspClient || !config.databaseUrl) {
    await writeMobileWorklogToMsp({
      body: command.description,
      command: {
        baseVersion: "mobile",
        clientMutationId: command.idempotencyKey,
        durationMinutes: command.durationMinutes,
        endedAt: command.endedAt,
        installationId: "mobile",
        startedAt: command.startedAt,
        visibility: "external",
      },
      mspClient,
      requestId: command.requestId,
    });
    return null;
  }

  const runtime = createWorklogDispositionRuntime({
    graphClient: createGraphClient(config.microsoft),
    mspClient,
    outcomeStore: createPostgresWorklogOutcomeStore({
      databaseUrl: config.databaseUrl,
    }),
  });
  return createWorklogDispositionProcessor({
    applyDisposition: runtime.applyDisposition,
    repository: createPostgresWorklogDispositionRepository({
      databaseUrl: config.databaseUrl,
    }),
    saveWorklog: runtime.saveWorklog,
  }).process(command);
}

function getConfiguredMobileMspClient() {
  const config = readDispatchConfig();
  return config.dispatchDataSource === "msp-central"
    ? createMspCentralClient(config)
    : null;
}

async function writeMobileWorklogToMsp({
  body,
  command,
  mspClient,
  requestId,
}: {
  body: string;
  command: MobileWorklogCommand;
  mspClient: MspCentralClient | null;
  requestId: string;
}) {
  if (!mspClient?.addRequestWorklog) {
    return;
  }

  const durationMinutes = Math.max(1, Math.round(command.durationMinutes ?? 1));
  const endedAt = command.endedAt ?? command.occurredAt ?? new Date().toISOString();
  const startedAt =
    command.startedAt ??
    new Date(new Date(endedAt).getTime() - durationMinutes * 60_000).toISOString();

  await mspClient.addRequestWorklog({
    description: body,
    durationMinutes,
    endedAt,
    requestId,
    startedAt,
  });
}

function fixtureStaffAsDatabaseRow(auth: MobileAuthContext): DatabaseStaffRow {
  const staff = MOBILE_STAFF_FIXTURES.find(
    (candidate) =>
      candidate.email.toLowerCase() === auth.email.toLowerCase() ||
      candidate.zohoEmail.toLowerCase() === auth.email.toLowerCase(),
  );
  if (!staff) {
    throw Object.assign(new Error("Mobile staff profile was not found."), {
      code: "UNAUTHORIZED",
      status: 401,
    });
  }

  return {
    active: staff.active,
    baseOffice: staff.baseOffice,
    displayName: staff.displayName,
    dispatchEnabled: true,
    id: staff.id,
    mspCentralEmail: staff.mspCentralEmail,
    mspCentralTechnicianId: staff.mspCentralTechnicianId,
    outlookEmail: staff.outlookEmail,
    outlookUserPrincipalName: staff.outlookUserPrincipalName,
    role: staff.role,
    zohoEmail: staff.zohoEmail,
  };
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

const OUTLOOK_READ_ONLY_PERMISSIONS: MobileJobPermissions = {
  canAddPart: false,
  canAttachEvidence: false,
  canComplete: false,
  canSignOff: false,
  canStartTimer: false,
  canUpdateStatus: false,
  canWriteWorklog: false,
  readOnlyReason: "Outlook calendar events are read-only.",
};

async function listOutlookMobileJobs({
  from,
  outlookCalendar,
  staff,
  to,
}: {
  from: string;
  outlookCalendar: MobileOutlookCalendar | null;
  staff: DatabaseStaffRow;
  to: string;
}) {
  if (!outlookCalendar) {
    return [];
  }

  try {
    const appointments = await outlookCalendar.listAppointments({
      from,
      staff,
      to,
    });
    return appointments
      .map((appointment) => mapOutlookAppointment(staff, appointment))
      .filter((job): job is MobileJob => Boolean(job));
  } catch (error) {
    console.error("Mobile Outlook calendar read failed", safeError(error));
    return [];
  }
}

async function findOutlookMobileJob({
  jobId,
  outlookCalendar,
  staff,
}: {
  jobId: string;
  outlookCalendar: MobileOutlookCalendar | null;
  staff: DatabaseStaffRow;
}) {
  if (!outlookCalendar) {
    return null;
  }

  try {
    const appointment = await outlookCalendar.findAppointment({ jobId, staff });
    return appointment ? mapOutlookAppointment(staff, appointment) : null;
  } catch (error) {
    console.error("Mobile Outlook calendar event read failed", safeError(error));
    return null;
  }
}

function mapOutlookAppointment(
  staff: DatabaseStaffRow,
  appointment: Appointment,
): MobileJob | null {
  if (!appointment.date) {
    return null;
  }

  const startAt = melbourneIsoTime(appointment.date, appointment.start);
  const endAt = melbourneIsoTime(appointment.date, appointment.end);
  return {
    attachments: [],
    bookingType: appointment.bookingType ?? "In house",
    contactEmail: null,
    contactName: null,
    contactPhone: null,
    customerName: appointment.customer,
    customerSignOff: null,
    description: appointment.bodyPreview ?? null,
    endAt,
    id: appointment.id,
    isAllDay: Boolean(appointment.isAllDay),
    outlookEventId: appointment.outlookEventId ?? null,
    outlookWebLink: appointment.outlookWebLink ?? null,
    parts: [],
    permissions: OUTLOOK_READ_ONLY_PERMISSIONS,
    previousNotes: [],
    priority: null,
    requestNumber: appointment.outlookLinkedRequestNumber
      ? `REQ-${appointment.outlookLinkedRequestNumber}`
      : null,
    siteAddress: appointment.siteAddress ?? null,
    siteName: appointment.siteArea ?? null,
    siteTown: appointment.siteTown ?? null,
    slaDueAt: null,
    source: "outlook",
    startAt,
    status: "Scheduled",
    syncState: "synced",
    tags: [
      "Outlook only",
      appointment.outlookIssue === "private" ? "Private" : undefined,
      appointment.isAllDay ? "All day" : undefined,
    ].filter((tag): tag is string => Boolean(tag)),
    technician: mapDatabaseStaff(staff),
    timezone: "Australia/Melbourne",
    title: appointment.title,
    travel: null,
    updatedAt: startAt,
    version: `outlook-${appointment.outlookEventId ?? appointment.id}-${startAt}-${endAt}`,
  };
}

function melbourneIsoTime(dateKey: string, time: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const approximateInstant = new Date(
    Date.UTC(year, month - 1, day, hour, minute),
  );
  const offsetName = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    timeZoneName: "longOffset",
  })
    .formatToParts(approximateInstant)
    .find((part) => part.type === "timeZoneName")?.value;
  const offset = offsetName?.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? "+10:00";

  return `${dateKey}T${time}:00${offset}`;
}

function safeError(error: unknown) {
  return error instanceof Error ? { message: error.message } : { message: "Unknown error" };
}

async function listTestSyncedMobileJobs({
  auth,
  from,
  to,
}: {
  auth: MobileAuthContext;
  from: string;
  to: string;
}) {
  const dashboard = await getTestSyncedMockDashboard();
  if (!dashboard) {
    return [];
  }

  return dashboard.appointments
    .map((appointment) => mapTestSyncedAppointment(dashboard, appointment))
    .filter((job): job is MobileJob => Boolean(job))
    .filter(
      (job) =>
        job.technician.email.toLowerCase() === auth.email.toLowerCase() &&
        job.startAt.slice(0, 10) >= from &&
        job.startAt.slice(0, 10) <= to,
    );
}

async function findTestSyncedMobileJob({
  auth,
  jobId,
}: {
  auth: MobileAuthContext;
  jobId: string;
}) {
  const dashboard = await getTestSyncedMockDashboard();
  if (!dashboard) {
    return null;
  }

  return (
    dashboard.appointments
      .map((appointment) => mapTestSyncedAppointment(dashboard, appointment))
      .find(
        (job): job is MobileJob =>
          job !== null &&
          job.id === jobId &&
          job.technician.email.toLowerCase() === auth.email.toLowerCase(),
      ) ?? null
  );
}

async function getTestSyncedMockDashboard() {
  try {
    const events = await listDispatchTestSyncEvents();
    if (!events.length) {
      return null;
    }

    return applyDispatchTestSyncEvents(getDispatchDesignMockData(), events);
  } catch (error) {
    console.error("Mobile test-sync overlay failed", error);
    return null;
  }
}

function mapTestSyncedAppointment(
  dashboard: DispatchDashboardData,
  appointment: Appointment,
): MobileJob | null {
  const technician = dashboard.technicians.find(
    (candidate) => candidate.id === appointment.technicianId,
  );
  if (!technician || !appointment.date) {
    return null;
  }

  const request = appointment.requestId
    ? dashboard.requests.find((candidate) => candidate.id === appointment.requestId)
    : undefined;
  const priority = request?.priority ?? null;
  const previousNotes: MobileJobNote[] = [];

  if (request?.notes) {
    previousNotes.push({
      id: `${appointment.id}-request-note`,
      localId: null,
      visibility: "external",
      body: request.notes,
      authorName: "Command Centre",
      createdAt: request.updatedAt ?? mockIsoTime(appointment.date, appointment.start),
      updatedAt: request.updatedAt ?? mockIsoTime(appointment.date, appointment.start),
      syncState: "synced",
      canEdit: false,
      canDelete: false,
    });
  }

  if (appointment.bodyPreview) {
    previousNotes.push({
      id: `${appointment.id}-appointment-note`,
      localId: null,
      visibility: "internal",
      body: appointment.bodyPreview,
      authorName: "Command Centre",
      createdAt: mockIsoTime(appointment.date, appointment.start),
      updatedAt: mockIsoTime(appointment.date, appointment.start),
      syncState: "synced",
      canEdit: false,
      canDelete: false,
    });
  }

  return {
    id: appointment.id,
    source: "mock",
    requestNumber: request?.requestNumber ?? null,
    outlookEventId: appointment.outlookEventId ?? null,
    outlookWebLink: appointment.outlookWebLink ?? null,
    version: `test-sync-${appointment.id}-${appointment.date}-${appointment.start}-${appointment.end}`,
    title: request?.subject ?? appointment.title,
    description:
      request?.notes ??
      appointment.bodyPreview ??
      "Dispatcher-created Command Centre test schedule.",
    priority,
    status: mobileStatusForRequest(request),
    bookingType:
      appointment.bookingType ??
      request?.bookingType ??
      (request?.onsite === false ? "Remote" : "Onsite"),
    startAt: mockIsoTime(appointment.date, appointment.start),
    endAt: mockIsoTime(appointment.date, appointment.end),
    timezone: "Australia/Melbourne",
    isAllDay: Boolean(appointment.isAllDay),
    slaDueAt: request?.dueAt ?? null,
    customerName: request?.customer ?? appointment.customer,
    siteName: request?.siteName ?? request?.site ?? null,
    siteAddress: request?.siteAddress ?? appointment.siteAddress ?? null,
    siteTown: request?.siteTown ?? appointment.siteTown ?? null,
    contactName: request?.requester ?? null,
    contactPhone: request?.contact ?? null,
    contactEmail: null,
    technician: mapDispatchTechnician(technician),
    tags: [
      ...(request?.warnings ?? []),
      appointment.travelWarning,
      priority === "Critical" || priority === "High" ? "SLA risk" : undefined,
    ].filter((tag): tag is string => Boolean(tag)),
    travel: mapMobileTravel(appointment),
    previousNotes,
    parts: [],
    attachments: [],
    customerSignOff: null,
    permissions: WRITABLE_PERMISSIONS,
    syncState: "pending",
    updatedAt: mockIsoTime(appointment.date, appointment.start),
  };
}

function mapDispatchTechnician(technician: Technician): MobileStaff {
  const email =
    technician.zohoEmail ??
    technician.outlookUserPrincipalName ??
    technician.outlookEmail ??
    technician.mspCentralEmail ??
    "";

  return {
    id: technician.id,
    displayName: technician.displayName,
    email,
    zohoEmail: technician.zohoEmail ?? email,
    outlookEmail: technician.outlookEmail ?? email,
    outlookUserPrincipalName: technician.outlookUserPrincipalName ?? email,
    mspCentralEmail: technician.mspCentralEmail ?? email,
    mspCentralTechnicianId: technician.mspCentralTechnicianId ?? null,
    role: technician.role === "admin" ? "admin" : "technician",
    baseOffice: technician.baseOfficeId === "sale" ? "Sale" : "Bairnsdale",
    active: technician.active,
  };
}

function mapMobileTravel(appointment: Appointment): MobileJob["travel"] {
  if (
    appointment.travelToSiteMinutes === undefined &&
    appointment.travelBackToOfficeMinutes === undefined
  ) {
    return null;
  }

  return {
    mode: appointment.travelMode ?? "office_to_site_and_back",
    calculatedFrom: mobileTravelCalculatedFrom(
      appointment.travelCalculatedFrom ?? "technician_base_office",
    ),
    calculationReason:
      appointment.travelCalculationReason ?? "Estimated from technician base office",
    baseOfficeName: appointment.officeOriginName ?? null,
    baseOfficeAddress: appointment.officeOriginAddress ?? null,
    travelToSiteMinutes: appointment.travelToSiteMinutes ?? 0,
    travelBackToOfficeMinutes: appointment.travelBackToOfficeMinutes ?? 0,
    estimated: appointment.travelEstimated ?? false,
  };
}

function mobileTravelCalculatedFrom(
  calculatedFrom: TravelCalculatedFrom,
): MobileTravelContext["calculatedFrom"] {
  return calculatedFrom === "manual_override" ? "manual" : calculatedFrom;
}

function mobileStatusForRequest(request?: DispatchRequest): MobileJobStatus {
  if (request?.status === "Resolved") {
    return "Completed";
  }
  if (request?.status === "Open" || request?.status === "Ready for Scheduling") {
    return "Needs Follow-up";
  }
  return "Scheduled";
}

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

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
