import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import { mockIsoTime } from "./date-scope";
import { buildDispatchHealthItems } from "./health";
import { applyTravelToAppointment, type TravelEstimate } from "./travel";
import type {
  Appointment,
  BookingType,
  DispatchDashboardData,
  Priority,
  RequestStatus,
} from "./types";

export type DispatchTestSyncEventType =
  | "scheduled"
  | "rescheduled"
  | "cancelled"
  | "notes_updated"
  | "work_logged";

export type DispatchWorkLogVisibility = "Customer-facing" | "Internal";

export type DispatchWorkLogPayload = {
  billable: boolean;
  minutesSpent: number;
  notes: string;
  status?: RequestStatus;
  visibility: DispatchWorkLogVisibility;
  workType: BookingType;
};

export type DispatchTestSyncEvent = {
  id: string;
  eventType: DispatchTestSyncEventType;
  requestId?: string;
  appointmentId?: string;
  technicianId?: string;
  date?: string;
  start?: string;
  end?: string;
  bookingType?: BookingType;
  priority?: Priority;
  notes?: string;
  payload?: {
    liveSync?: {
      error?: string;
      outlookEventId?: string;
      outlookWebLink?: string;
      status: "failed" | "pending" | "synced";
    };
    travel?: TravelEstimate;
    workLog?: DispatchWorkLogPayload;
  };
  createdAt: string;
  createdBy?: string;
};

export type DispatchTestSyncEventInput = Partial<
  Omit<DispatchTestSyncEvent, "createdAt" | "eventType" | "id">
> & {
  id?: string;
  eventType?: DispatchTestSyncEventType;
  createdAt?: string;
};

type DispatchTestSyncRow = {
  id: string;
  event_type: DispatchTestSyncEventType;
  request_id: string | null;
  appointment_id: string | null;
  technician_id: string | null;
  date_key: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_type: BookingType | null;
  priority: Priority | null;
  notes: string | null;
  payload: {
    travel?: TravelEstimate;
    workLog?: DispatchWorkLogPayload;
  } | null;
  created_by: string | null;
  created_at: Date | string;
};

export function normaliseDispatchTestSyncEvent(
  input: DispatchTestSyncEventInput,
): DispatchTestSyncEvent {
  if (!input.eventType) {
    throw new Error("Dispatch test sync event type is required.");
  }

  const id =
    input.id ??
    `test-sync-${input.eventType}-${input.appointmentId ?? input.requestId ?? "event"}-${Date.now()}`;

  return {
    id,
    eventType: input.eventType,
    requestId: cleanOptional(input.requestId),
    appointmentId: cleanOptional(input.appointmentId),
    technicianId: cleanOptional(input.technicianId),
    date: cleanOptional(input.date),
    start: cleanOptional(input.start),
    end: cleanOptional(input.end),
    bookingType: input.bookingType,
    priority: input.priority,
    notes: cleanOptional(input.notes),
    payload: input.payload,
    createdAt: input.createdAt ?? new Date().toISOString(),
    createdBy: cleanOptional(input.createdBy),
  };
}

export function applyDispatchTestSyncEvents(
  dashboard: DispatchDashboardData,
  events: DispatchTestSyncEvent[],
): DispatchDashboardData {
  if (!events.length) {
    return dashboard;
  }

  const requests = dashboard.requests.map((request) => ({ ...request }));
  const appointments = dashboard.appointments.map((appointment) => ({
    ...appointment,
  }));

  for (const event of [...events].sort((first, second) =>
    first.createdAt.localeCompare(second.createdAt),
  )) {
    if (event.eventType === "cancelled") {
      const appointmentIndex = appointments.findIndex((appointment) =>
        appointmentMatchesEvent(appointment, event),
      );

      if (appointmentIndex >= 0) {
        appointments[appointmentIndex] = {
          ...appointments[appointmentIndex],
          status: "tentative",
          syncIssue: "time-mismatch",
          bodyPreview: appendTestNote(
            appointments[appointmentIndex].bodyPreview,
            "Dispatcher test sync cancellation",
          ),
        };
      }

      continue;
    }

    if (event.eventType === "notes_updated") {
      const request = requests.find((candidate) => candidate.id === event.requestId);

      if (request && event.notes) {
        request.notes = event.notes;
        request.updatedAt = event.createdAt;
        request.updateInfo = {
          at: event.createdAt,
          detail: event.notes,
          source: "test-sync",
          summary: "Notes updated",
        };
      }

      continue;
    }

    if (event.eventType === "work_logged") {
      const request = requests.find((candidate) => candidate.id === event.requestId);
      const workLog = event.payload?.workLog;

      if (request && workLog?.notes) {
        request.notes = appendTestNote(request.notes, formatWorkLogNote(workLog));
        request.updatedAt = event.createdAt;
        request.updateInfo = {
          at: event.createdAt,
          detail: workLog.notes,
          source: "test-sync",
          summary: "Work Log added",
        };
        request.warnings = mergeWarnings(request.warnings, ["Work Log added"]);

        if (workLog.status) {
          request.status = workLog.status;
          request.readyToBook = workLog.status === "Resolved" ? false : request.readyToBook;
        }
      }

      continue;
    }

    if (!event.technicianId || !event.date || !event.start || !event.end) {
      continue;
    }

    const request = event.requestId
      ? requests.find((candidate) => candidate.id === event.requestId)
      : undefined;
    const appointmentIndex = appointments.findIndex((appointment) =>
      appointmentMatchesEvent(appointment, event),
    );
    const scheduledStart = mockIsoTime(event.date, event.start);
    const scheduledEnd = mockIsoTime(event.date, event.end);

    if (request) {
      const liveSync = event.payload?.liveSync;
      const liveSyncWarnings =
        liveSync?.status === "failed"
          ? [`Live sync failed: ${liveSync.error ?? "Background sync failed"}`]
          : liveSync?.status === "pending"
            ? ["Live sync pending"]
            : liveSync?.status === "synced"
              ? []
              : ["Test sync"];
      request.status = "Scheduled";
      request.technicianId = event.technicianId;
      request.scheduledStart = scheduledStart;
      request.scheduledEnd = scheduledEnd;
      request.readyToBook = false;
      request.bookingType = event.bookingType ?? request.bookingType;
      request.priority = event.priority ?? request.priority;
      request.updatedAt = event.createdAt;
      request.updateInfo = {
        at: event.createdAt,
        detail: `${event.start}-${event.end}`,
        source: "test-sync",
        summary: event.eventType === "rescheduled" ? "Schedule changed" : "Scheduled",
      };
      request.warnings = mergeWarnings(request.warnings, liveSyncWarnings);
    }

    if (appointmentIndex >= 0) {
      appointments[appointmentIndex] = {
        ...applyTravelToAppointment(
          {
            ...appointments[appointmentIndex],
            requestId:
              event.requestId ?? appointments[appointmentIndex].requestId,
            technicianId: event.technicianId,
            date: event.date,
            start: event.start,
            end: event.end,
            bookingType:
              event.bookingType ?? appointments[appointmentIndex].bookingType,
            bodyPreview: appendTestNote(
              appointments[appointmentIndex].bodyPreview,
              event.payload?.liveSync
                ? "Updated by Command Centre"
                : "Updated by dispatcher test sync",
            ),
            outlookEventId:
              event.payload?.liveSync?.outlookEventId ??
              appointments[appointmentIndex].outlookEventId,
            outlookWebLink:
              event.payload?.liveSync?.outlookWebLink ??
              appointments[appointmentIndex].outlookWebLink,
            readOnly: event.payload?.liveSync?.outlookEventId
              ? false
              : appointments[appointmentIndex].readOnly,
            source: event.payload?.liveSync?.outlookEventId
              ? "linked"
              : appointments[appointmentIndex].source,
            syncIssue:
              event.payload?.liveSync?.status === "failed"
                ? "time-mismatch"
                : appointments[appointmentIndex].syncIssue,
          },
          event.payload?.travel,
        ),
      };
      continue;
    }

    if (request) {
      appointments.push(
        applyTravelToAppointment(
          {
            id: event.appointmentId ?? `test-sync-${request.id}`,
            requestId: request.id,
            technicianId: event.technicianId,
            title: request.subject,
            customer: request.customer,
            bookingType: event.bookingType ?? request.bookingType,
            siteAddress: request.siteAddress,
            siteTown: request.siteTown,
            siteArea: request.siteArea,
            date: event.date,
            start: event.start,
            end: event.end,
            status: "confirmed",
            source: "linked",
            bodyPreview: event.payload?.liveSync
              ? "Scheduled by Command Centre."
              : "Created by dispatcher test sync.",
            outlookEventId: event.payload?.liveSync?.outlookEventId,
            outlookWebLink: event.payload?.liveSync?.outlookWebLink,
            syncIssue:
              event.payload?.liveSync?.status === "failed"
                ? "time-mismatch"
                : undefined,
          },
          event.payload?.travel,
        ),
      );
    }
  }

  return {
    ...dashboard,
    requests,
    appointments,
    healthItems: buildDispatchHealthItems({
      appointments,
      requests,
      technicians: dashboard.technicians,
    }),
  };
}

export async function listDispatchTestSyncEvents() {
  const sql = await getDispatchTestSyncClient();

  const rows = await sql<DispatchTestSyncRow[]>`
    select id, event_type, request_id, appointment_id, technician_id, date_key,
            start_time, end_time, booking_type, priority, notes, payload,
            created_by, created_at
      from dispatch_test_schedule_events
     order by created_at asc
  `;

  return rows.map(rowToDispatchTestSyncEvent);
}

export async function recordDispatchTestSyncEvent(
  input: DispatchTestSyncEventInput,
  createdBy?: string,
  transactionSql?: postgres.Sql,
) {
  const event = normaliseDispatchTestSyncEvent({
    ...input,
    createdBy: input.createdBy ?? createdBy,
  });
  const sql = transactionSql ?? getDispatchTestSyncClient();

  await sql`
    insert into dispatch_test_schedule_events (
      id, event_type, request_id, appointment_id, technician_id, date_key,
      start_time, end_time, booking_type, priority, notes, payload,
      created_by, created_at
    )
    values (
      ${event.id},
      ${event.eventType},
      ${event.requestId ?? null},
      ${event.appointmentId ?? null},
      ${event.technicianId ?? null},
      ${event.date ?? null},
      ${event.start ?? null},
      ${event.end ?? null},
      ${event.bookingType ?? null},
      ${event.priority ?? null},
      ${event.notes ?? null},
      ${sql.json(event.payload ?? {})},
      ${event.createdBy ?? null},
      ${event.createdAt}
    )
    on conflict (id) do update set
      event_type = excluded.event_type,
      request_id = excluded.request_id,
      appointment_id = excluded.appointment_id,
      technician_id = excluded.technician_id,
      date_key = excluded.date_key,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      booking_type = excluded.booking_type,
      priority = excluded.priority,
      notes = excluded.notes,
      payload = excluded.payload,
      created_by = excluded.created_by,
      created_at = excluded.created_at
  `;

  return event;
}

export async function clearDispatchTestSyncEvents() {
  const sql = await getDispatchTestSyncClient();

  await sql`delete from dispatch_test_schedule_events`;
}

export function getDispatchTestSyncClient(
  databaseUrl = process.env.DATABASE_URL,
) {

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for dispatcher-to-mobile test sync.");
  }

  return getSharedPostgresClient(
    databaseUrl,
    shouldUseSsl(databaseUrl) ? "require" : false,
  );
}

function rowToDispatchTestSyncEvent(
  row: DispatchTestSyncRow,
): DispatchTestSyncEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    requestId: row.request_id ?? undefined,
    appointmentId: row.appointment_id ?? undefined,
    technicianId: row.technician_id ?? undefined,
    date: row.date_key ?? undefined,
    start: row.start_time ?? undefined,
    end: row.end_time ?? undefined,
    bookingType: row.booking_type ?? undefined,
    priority: row.priority ?? undefined,
    notes: row.notes ?? undefined,
    payload: row.payload ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : new Date(row.created_at).toISOString(),
  };
}

function appointmentMatchesEvent(
  appointment: Appointment,
  event: DispatchTestSyncEvent,
) {
  const syncedOutlookEventId = event.payload?.liveSync?.outlookEventId;

  return Boolean(
    (event.appointmentId && appointment.id === event.appointmentId) ||
      (event.requestId && appointment.requestId === event.requestId) ||
      (syncedOutlookEventId &&
        appointment.outlookEventId === syncedOutlookEventId),
  );
}

function appendTestNote(existing: string | undefined, note: string) {
  if (!existing) {
    return note;
  }

  if (existing.includes(note)) {
    return existing;
  }

  return `${existing}\n${note}`;
}

function cleanOptional(value: string | undefined) {
  const clean = value?.trim();
  return clean || undefined;
}

function mergeWarnings(existing: string[], additions: string[]) {
  return Array.from(new Set([...existing, ...additions]));
}

function formatWorkLogNote(workLog: DispatchWorkLogPayload) {
  return `Work Log (${workLog.minutesSpent} min, ${
    workLog.billable ? "billable" : "non-billable"
  }, ${workLog.workType}, ${workLog.visibility}): ${workLog.notes}`;
}

function shouldUseSsl(databaseUrl: string) {
  return !databaseUrl.includes("localhost") && !databaseUrl.includes("127.0.0.1");
}
