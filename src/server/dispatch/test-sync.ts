import postgres from "postgres";

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
  | "timer_started"
  | "timer_stopped"
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

export type DispatchTimerPayload = {
  id: string;
  jobId: string;
  startedAt: string;
  stoppedAt?: string;
  technicianId: string;
  technicianName?: string;
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
    timer?: DispatchTimerPayload;
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
    timer?: DispatchTimerPayload;
    travel?: TravelEstimate;
    workLog?: DispatchWorkLogPayload;
  } | null;
  created_by: string | null;
  created_at: Date | string;
};

let sqlSingleton: postgres.Sql | undefined;
let schemaReady: Promise<void> | undefined;

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
      }

      continue;
    }

    if (event.eventType === "work_logged") {
      const request = requests.find((candidate) => candidate.id === event.requestId);
      const workLog = event.payload?.workLog;

      if (request && workLog?.notes) {
        request.notes = appendTestNote(request.notes, formatWorkLogNote(workLog));
        request.updatedAt = event.createdAt;
        request.warnings = mergeWarnings(request.warnings, ["Work Log added"]);

        if (workLog.status) {
          request.status = workLog.status;
          request.readyToBook = workLog.status === "Resolved" ? false : request.readyToBook;
        }
      }

      continue;
    }

    if (event.eventType === "timer_started") {
      const request = requests.find((candidate) => candidate.id === event.requestId);
      const timer = event.payload?.timer;

      if (request && timer) {
        request.activeTimer = {
          id: timer.id,
          jobId: timer.jobId,
          startedAt: timer.startedAt,
          technicianId: timer.technicianId,
          technicianName: timer.technicianName,
        };
        request.updatedAt = event.createdAt;
        request.warnings = mergeWarnings(request.warnings, ["Active timer"]);
      }

      continue;
    }

    if (event.eventType === "timer_stopped") {
      const request = requests.find((candidate) => candidate.id === event.requestId);
      const timer = event.payload?.timer;

      if (request && (!timer || request.activeTimer?.id === timer.id)) {
        request.activeTimer = undefined;
        request.updatedAt = event.createdAt;
        request.warnings = request.warnings.filter(
          (warning) => warning !== "Active timer",
        );
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
      request.status = "Scheduled";
      request.technicianId = event.technicianId;
      request.scheduledStart = scheduledStart;
      request.scheduledEnd = scheduledEnd;
      request.readyToBook = false;
      request.bookingType = event.bookingType ?? request.bookingType;
      request.priority = event.priority ?? request.priority;
      request.updatedAt = event.createdAt;
      request.warnings = mergeWarnings(request.warnings, ["Test sync"]);
    }

    if (appointmentIndex >= 0) {
      appointments[appointmentIndex] = {
        ...applyTravelToAppointment(
          {
            ...appointments[appointmentIndex],
            technicianId: event.technicianId,
            date: event.date,
            start: event.start,
            end: event.end,
            bookingType:
              event.bookingType ?? appointments[appointmentIndex].bookingType,
            bodyPreview: appendTestNote(
              appointments[appointmentIndex].bodyPreview,
              "Updated by dispatcher test sync",
            ),
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
            bodyPreview: "Created by dispatcher test sync.",
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

  await ensureDispatchTestSyncSchema(sql);
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
) {
  const event = normaliseDispatchTestSyncEvent({
    ...input,
    createdBy: input.createdBy ?? createdBy,
  });
  const sql = await getDispatchTestSyncClient();

  await ensureDispatchTestSyncSchema(sql);
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

  await ensureDispatchTestSyncSchema(sql);
  await sql`delete from dispatch_test_schedule_events`;
}

async function getDispatchTestSyncClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for dispatcher-to-mobile test sync.");
  }

  sqlSingleton ??= postgres(databaseUrl, {
    max: 5,
    prepare: false,
    ssl: shouldUseSsl(databaseUrl) ? "require" : false,
  });

  return sqlSingleton;
}

async function ensureDispatchTestSyncSchema(sql: postgres.Sql) {
  schemaReady ??= (async () => {
    await sql.unsafe(`
      create table if not exists dispatch_test_schedule_events (
        id text primary key,
        event_type text not null,
        request_id text,
        appointment_id text,
        technician_id text,
        date_key text,
        start_time text,
        end_time text,
        booking_type text,
        priority text,
        notes text,
        payload jsonb not null default '{}'::jsonb,
        created_by text,
        created_at timestamptz not null default now()
      )
    `);
    await sql.unsafe(`
      alter table dispatch_test_schedule_events
        add column if not exists payload jsonb not null default '{}'::jsonb
    `);
    await sql.unsafe(`
      create index if not exists dispatch_test_schedule_events_created_at_idx
        on dispatch_test_schedule_events (created_at)
    `);
    await sql.unsafe(`
      alter table dispatch_test_schedule_events enable row level security
    `);
  })();

  await schemaReady;
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
  return Boolean(
    (event.appointmentId && appointment.id === event.appointmentId) ||
      (event.requestId && appointment.requestId === event.requestId),
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
