import postgres from "postgres";

import type {
  ActiveTimer,
  NoteVisibility,
  StoppedTimer,
} from "../../../apps/technician-mobile/src/contracts/mobile";

export type DatabaseSyncStatus =
  | "linked"
  | "needs_review"
  | "sdp_only"
  | "outlook_only"
  | "failed";

export interface DatabaseStaffRow {
  active: boolean;
  baseOffice: string;
  displayName: string;
  dispatchEnabled: boolean;
  id: string;
  mspCentralEmail: string;
  mspCentralTechnicianId: string | null;
  outlookEmail: string;
  outlookUserPrincipalName: string;
  role: string;
  zohoEmail: string;
}

export interface DatabaseJobNoteRow {
  action: string;
  createdAt: string | Date;
  id: string;
  message: string | null;
  payloadSummary: unknown;
  status: "success" | "warning" | "failed";
}

export interface DatabaseJobRow {
  createdAt: string | Date;
  id: string;
  lastSyncError: string | null;
  lastSyncStatus: DatabaseSyncStatus;
  notes: DatabaseJobNoteRow[];
  outlookCalendarEmail: string | null;
  outlookEventId: string | null;
  scheduledEnd: string | Date | null;
  scheduledStart: string | Date | null;
  sdpRequestId: string;
  sdpRequestNumber: string;
  staff: DatabaseStaffRow;
  technicianId: string | null;
  updatedAt: string | Date;
}

export interface SaveDatabaseWorklogInput {
  action?: "mobile_completion" | "mobile_worklog";
  billable?: boolean;
  body: string;
  clientMutationId: string;
  durationMinutes?: number;
  endedAt?: string;
  followUpNeeded?: boolean;
  installationId: string;
  job: DatabaseJobRow;
  occurredAt?: string;
  startedAt?: string;
  targetStatus?: "Needs Follow-up" | "Resolved";
  timerSessionId?: string | null;
  visibility: NoteVisibility;
  workType?: "billable" | "non_billable" | "internal";
}

export interface SaveDatabaseWorklogResult {
  recordedAt: string;
  resourceId: string;
  resourceVersion: string;
}

export interface SaveDatabaseTimerEventInput {
  action: "mobile_timer_start" | "mobile_timer_stop";
  clientMutationId: string;
  installationId: string;
  job: DatabaseJobRow;
  occurredAt: string;
  timer: ActiveTimer | StoppedTimer;
}

export interface MobileDatabase {
  findJobForStaff(input: {
    jobId: string;
    staffId: string;
  }): Promise<DatabaseJobRow | null>;
  findStaffByZohoEmail(zohoEmail: string): Promise<DatabaseStaffRow | null>;
  listJobsForStaff(input: {
    from: string;
    staffId: string;
    to: string;
  }): Promise<DatabaseJobRow[]>;
  saveTimerEvent(input: SaveDatabaseTimerEventInput): Promise<SaveDatabaseWorklogResult>;
  saveWorklog(input: SaveDatabaseWorklogInput): Promise<SaveDatabaseWorklogResult>;
}

let sqlSingleton: postgres.Sql | undefined;
let databaseSingleton: MobileDatabase | undefined;

export function hasMobileDatabase(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.DATABASE_URL?.trim());
}

export function createPostgresMobileDatabase({
  databaseUrl = process.env.DATABASE_URL,
  sql = getPostgresSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): MobileDatabase {
  return {
    async findStaffByZohoEmail(zohoEmail) {
      const rows = await sql<DatabaseStaffRow[]>`
        select
          id::text as "id",
          display_name as "displayName",
          role::text as "role",
          base_office as "baseOffice",
          zoho_email as "zohoEmail",
          outlook_email as "outlookEmail",
          outlook_user_principal_name as "outlookUserPrincipalName",
          msp_central_email as "mspCentralEmail",
          msp_central_technician_id as "mspCentralTechnicianId",
          active,
          dispatch_enabled as "dispatchEnabled"
        from public.staff_profiles
        where lower(zoho_email) = lower(${zohoEmail})
          and active = true
          and dispatch_enabled = true
        limit 1
      `;

      return rows[0] ?? null;
    },

    async findJobForStaff({ jobId, staffId }) {
      const rows = await selectJobRows(sql, {
        extraWhere: sql`and dl.id = ${jobId}::uuid`,
        staffId,
      });

      return rows[0] ?? null;
    },

    async listJobsForStaff({ from, staffId, to }) {
      return selectJobRows(sql, {
        extraWhere: sql`
          and coalesce(dl.scheduled_start, dl.updated_at)::date >= ${from}::date
          and coalesce(dl.scheduled_start, dl.updated_at)::date <= ${to}::date
        `,
        staffId,
      });
    },

    async saveWorklog(input) {
      const rows = await sql<Array<{ id: string; recordedAt: string | Date }>>`
        insert into public.dispatch_sync_logs (
          sdp_request_id,
          outlook_event_id,
          technician_id,
          action,
          status,
          message,
          payload_summary
        )
        values (
          ${input.job.sdpRequestId},
          ${input.job.outlookEventId},
          ${input.job.technicianId}::uuid,
          ${input.action ?? 'mobile_worklog'},
          'success',
          ${input.body},
          ${sql.json({
            action: input.action ?? "mobile_worklog",
            billable: input.billable,
            body: input.body,
            clientMutationId: input.clientMutationId,
            durationMinutes: input.durationMinutes,
            endedAt: input.endedAt,
            followUpNeeded: input.followUpNeeded,
            installationId: input.installationId,
            occurredAt: input.occurredAt,
            source: "technician-mobile",
            startedAt: input.startedAt,
            targetStatus: input.targetStatus,
            timerSessionId: input.timerSessionId,
            visibility: input.visibility,
            workType: input.workType,
          })}
        )
        returning id::text as "id", created_at as "recordedAt"
      `;

      const saved = rows[0];
      if (!saved) {
        throw Object.assign(new Error("Worklog was not recorded."), {
          code: "BAD_REQUEST",
          status: 500,
        });
      }

      const recordedAt = toIsoString(saved.recordedAt);
      return {
        recordedAt,
        resourceId: saved.id,
        resourceVersion: `db-${input.job.id}-${saved.id}-${recordedAt}`,
      };
    },

    async saveTimerEvent(input) {
      const rows = await sql<Array<{ id: string; recordedAt: string | Date }>>`
        insert into public.dispatch_sync_logs (
          sdp_request_id,
          outlook_event_id,
          technician_id,
          action,
          status,
          message,
          payload_summary
        )
        values (
          ${input.job.sdpRequestId},
          ${input.job.outlookEventId},
          ${input.job.technicianId}::uuid,
          ${input.action},
          'success',
          ${input.action === "mobile_timer_start" ? "Mobile timer started." : "Mobile timer stopped."},
          ${sql.json({
            action: input.action,
            clientMutationId: input.clientMutationId,
            installationId: input.installationId,
            occurredAt: input.occurredAt,
            source: "technician-mobile",
            timer: timerEventPayload(input.timer),
          })}
        )
        returning id::text as "id", created_at as "recordedAt"
      `;

      const saved = rows[0];
      if (!saved) {
        throw Object.assign(new Error("Timer event was not recorded."), {
          code: "BAD_REQUEST",
          status: 500,
        });
      }

      const recordedAt = toIsoString(saved.recordedAt);
      return {
        recordedAt,
        resourceId: saved.id,
        resourceVersion: `db-${input.job.id}-${saved.id}-${recordedAt}`,
      };
    },
  };
}

export function getConfiguredMobileDatabase(): MobileDatabase | null {
  if (!hasMobileDatabase()) {
    return null;
  }

  databaseSingleton ??= createPostgresMobileDatabase();
  return databaseSingleton;
}

function getPostgresSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for Command Centre database access.");
  }

  sqlSingleton ??= postgres(databaseUrl, {
    max: 5,
    prepare: false,
    ssl: "require",
  });

  return sqlSingleton;
}

function selectJobRows(
  sql: postgres.Sql,
  {
    extraWhere,
    staffId,
  }: {
    extraWhere: ReturnType<postgres.Sql>;
    staffId: string;
  },
) {
  return sql<DatabaseJobRow[]>`
    select
      dl.id::text as "id",
      dl.sdp_request_id as "sdpRequestId",
      dl.sdp_request_number as "sdpRequestNumber",
      dl.outlook_event_id as "outlookEventId",
      dl.outlook_calendar_email as "outlookCalendarEmail",
      dl.technician_id::text as "technicianId",
      dl.scheduled_start as "scheduledStart",
      dl.scheduled_end as "scheduledEnd",
      dl.last_sync_status::text as "lastSyncStatus",
      dl.last_sync_error as "lastSyncError",
      dl.created_at as "createdAt",
      dl.updated_at as "updatedAt",
      jsonb_build_object(
        'id', sp.id::text,
        'displayName', sp.display_name,
        'role', sp.role::text,
        'baseOffice', sp.base_office,
        'zohoEmail', sp.zoho_email,
        'outlookEmail', sp.outlook_email,
        'outlookUserPrincipalName', sp.outlook_user_principal_name,
        'mspCentralEmail', sp.msp_central_email,
        'mspCentralTechnicianId', sp.msp_central_technician_id,
        'active', sp.active,
        'dispatchEnabled', sp.dispatch_enabled
      ) as "staff",
      coalesce(logs.notes, '[]'::jsonb) as "notes"
    from public.dispatch_links dl
    left join public.technicians t on t.id = dl.technician_id
    join public.staff_profiles sp on sp.id = ${staffId}::uuid
      and (
        t.id is not null
        and (
          lower(sp.outlook_email) = lower(t.outlook_email)
          or (
            sp.msp_central_technician_id is not null
            and t.sdp_technician_id is not null
            and sp.msp_central_technician_id = t.sdp_technician_id
          )
        )
      )
    left join lateral (
      select jsonb_agg(
        jsonb_build_object(
          'id', latest.id::text,
          'action', latest.action,
          'status', latest.status::text,
          'message', latest.message,
          'payloadSummary', latest.payload_summary,
          'createdAt', latest.created_at
        )
        order by latest.created_at desc
      ) as notes
      from (
        select id, action, status, message, payload_summary, created_at
        from public.dispatch_sync_logs
        where sdp_request_id = dl.sdp_request_id
        order by created_at desc
        limit 5
      ) latest
    ) logs on true
    where true
      ${extraWhere}
    order by coalesce(dl.scheduled_start, dl.updated_at), dl.sdp_request_number
  `;
}

function toIsoString(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function timerEventPayload(timer: ActiveTimer | StoppedTimer) {
  return {
    accumulatedPausedSeconds: timer.accumulatedPausedSeconds,
    actualElapsedMinutes: "actualElapsedMinutes" in timer ? timer.actualElapsedMinutes : undefined,
    id: timer.id,
    jobId: timer.jobId,
    pausedAt: timer.pausedAt,
    roundedMinutes: "roundedMinutes" in timer ? timer.roundedMinutes : undefined,
    startedAt: timer.startedAt,
    stoppedAt: "stoppedAt" in timer ? timer.stoppedAt : undefined,
    technicianId: timer.technicianId,
  };
}
