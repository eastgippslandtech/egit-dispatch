import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";

import type { WorklogOutcomeStore } from "./runtime";

type TechnicianRow = { id: string };

export function createPostgresWorklogOutcomeStore({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): WorklogOutcomeStore {
  return {
    async bookForward(input) {
      const technicianId = await resolveTechnicianId(sql, {
        email: input.technicianEmail ?? input.outlookCalendarEmail,
        technicianId: input.technicianId,
      });

      await sql`
        insert into public.dispatch_links (
          sdp_request_id,
          sdp_request_number,
          outlook_event_id,
          outlook_calendar_email,
          technician_id,
          scheduled_start,
          scheduled_end,
          last_sync_status,
          last_sync_error,
          updated_at
        )
        values (
          ${input.requestId},
          ${input.requestNumber},
          ${input.eventId ?? null},
          ${input.outlookCalendarEmail},
          ${technicianId}::uuid,
          ${input.start}::timestamptz,
          ${input.end}::timestamptz,
          'linked',
          null,
          now()
        )
        on conflict (sdp_request_id) do update set
          sdp_request_number = excluded.sdp_request_number,
          outlook_event_id = excluded.outlook_event_id,
          outlook_calendar_email = excluded.outlook_calendar_email,
          technician_id = excluded.technician_id,
          scheduled_start = excluded.scheduled_start,
          scheduled_end = excluded.scheduled_end,
          last_sync_status = 'linked',
          last_sync_error = null,
          updated_at = now()
      `;

      await sql`
        delete from public.dispatch_link_crew
        where dispatch_link_id = (
          select id from public.dispatch_links where sdp_request_id = ${input.requestId}
        )
      `;

      await recordOutcome(sql, {
        action: "worklog_book_forward",
        eventId: input.eventId,
        message: `Booked forward to ${input.start}.`,
        requestId: input.requestId,
        technicianId,
      });
    },

    async clearSchedule(input) {
      const rows = await sql<Array<{ eventId: string | null; technicianId: string | null }>>`
        update public.dispatch_links
        set
          outlook_event_id = null,
          outlook_calendar_email = null,
          scheduled_start = null,
          scheduled_end = null,
          last_sync_status = ${input.status}::public.dispatch_sync_status,
          last_sync_error = null,
          updated_at = now()
        where sdp_request_id = ${input.requestId}
        returning
          outlook_event_id as "eventId",
          technician_id::text as "technicianId"
      `;

      await sql`
        delete from public.dispatch_link_crew
        where dispatch_link_id = (
          select id from public.dispatch_links where sdp_request_id = ${input.requestId}
        )
      `;

      await recordOutcome(sql, {
        action: "worklog_schedule_cleared",
        eventId: rows[0]?.eventId ?? undefined,
        message: "The active booking was cleared after Work Log submission.",
        requestId: input.requestId,
        technicianId: rows[0]?.technicianId ?? undefined,
      });
    },

    async listCalendarAssignments(input) {
      return sql<Array<{ eventId: string; userPrincipalName: string }>>`
        select
          dl.outlook_event_id as "eventId",
          dl.outlook_calendar_email as "userPrincipalName"
        from public.dispatch_links dl
        where
          dl.sdp_request_id = ${input.requestId}
          and dl.outlook_event_id is not null
          and dl.outlook_calendar_email is not null

        union all

        select
          dlc.outlook_event_id as "eventId",
          dlc.outlook_calendar_email as "userPrincipalName"
        from public.dispatch_link_crew dlc
        inner join public.dispatch_links dl on dl.id = dlc.dispatch_link_id
        where
          dl.sdp_request_id = ${input.requestId}
          and dlc.outlook_event_id is not null
      `;
    },

    async transfer(input) {
      const technicianId = await resolveTechnicianId(sql, {
        email: input.targetEmail,
        technicianId: input.targetTechnicianId,
      });

      await sql`
        update public.dispatch_links
        set
          technician_id = ${technicianId}::uuid,
          outlook_event_id = null,
          outlook_calendar_email = null,
          scheduled_start = null,
          scheduled_end = null,
          last_sync_status = 'sdp_only',
          last_sync_error = null,
          updated_at = now()
        where sdp_request_id = ${input.requestId}
      `;

      await sql`
        delete from public.dispatch_link_crew
        where dispatch_link_id = (
          select id from public.dispatch_links where sdp_request_id = ${input.requestId}
        )
      `;

      await recordOutcome(sql, {
        action: "worklog_transfer_escalate",
        message: input.reason,
        requestId: input.requestId,
        technicianId,
      });
    },
  };
}

async function resolveTechnicianId(
  sql: postgres.Sql,
  input: { email?: string; technicianId: string },
) {
  const rows = await sql<TechnicianRow[]>`
    select t.id::text as "id"
    from public.technicians t
    left join public.staff_profiles sp on lower(sp.outlook_email) = lower(t.outlook_email)
    where
      t.id::text = ${input.technicianId}
      or lower(t.outlook_email) = lower(${input.email ?? ""})
      or lower(sp.zoho_email) = lower(${input.email ?? ""})
      or lower(sp.msp_central_email) = lower(${input.email ?? ""})
    limit 1
  `;
  const technicianId = rows[0]?.id;
  if (!technicianId) {
    throw new Error("The selected technician is not mapped in Command Centre.");
  }
  return technicianId;
}

async function recordOutcome(
  sql: postgres.Sql,
  input: {
    action: string;
    eventId?: string;
    message: string;
    requestId: string;
    technicianId?: string;
  },
) {
  await sql`
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
      ${input.requestId},
      ${input.eventId ?? null},
      ${input.technicianId ?? null}::uuid,
      ${input.action},
      'success',
      ${input.message},
      ${sql.json({ source: "worklog_disposition" })}
    )
  `;
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for Work Log outcomes.");
  }
  return getSharedPostgresClient(databaseUrl);
}
