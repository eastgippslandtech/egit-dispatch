import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";
import type { BookingType, Priority } from "./types";

export type DispatchLinkSyncStatus =
  | "linked"
  | "needs_review"
  | "sdp_only"
  | "outlook_only"
  | "failed";

export type DispatchLinkInput = {
  action: "live_schedule" | "outlook_reconciled";
  bookingType?: BookingType;
  crew?: DispatchCrewLinkInput[];
  contactEmail?: string;
  contactName?: string;
  contactPhone?: string;
  customer?: string;
  description?: string;
  outlookCalendarEmail?: string;
  outlookEventId?: string;
  priority?: Priority;
  requestId: string;
  requestNumber: string;
  scheduledEnd: string;
  scheduledStart: string;
  siteAddress?: string;
  siteName?: string;
  siteTown?: string;
  subject: string;
  syncError?: string;
  syncStatus: DispatchLinkSyncStatus;
  technicianEmail?: string;
  technicianId?: string;
  technicianMspCentralId?: string;
};

export type DispatchCrewLinkInput = {
  outlookCalendarEmail: string;
  outlookEventId?: string;
  syncError?: string;
  syncStatus: DispatchLinkSyncStatus;
  technicianEmail?: string;
  technicianId: string;
};

export interface DispatchLinkStore {
  save(input: DispatchLinkInput): Promise<void>;
}

export function getConfiguredDispatchLinkStore(
  databaseUrl = process.env.DATABASE_URL,
): DispatchLinkStore | null {
  if (!databaseUrl?.trim()) {
    return null;
  }

  return createPostgresDispatchLinkStore({ databaseUrl });
}

export function createPostgresDispatchLinkStore({
  databaseUrl = process.env.DATABASE_URL,
  sql = getSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}): DispatchLinkStore {
  return {
    async save(input) {
      const technicianId = await resolveTechnicianId(sql, {
        email: input.technicianEmail,
        mspCentralId: input.technicianMspCentralId,
        technicianId: input.technicianId,
      });
      const crew = await Promise.all(
        (input.crew ?? []).map(async (member) => ({
          ...member,
          databaseTechnicianId: await resolveTechnicianId(sql, {
            email: member.technicianEmail,
            technicianId: member.technicianId,
          }),
        })),
      );

      const links = await sql<Array<{ id: string }>>`
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
          ${input.outlookEventId ?? null},
          ${input.outlookCalendarEmail ?? null},
          ${technicianId}::uuid,
          ${input.scheduledStart}::timestamptz,
          ${input.scheduledEnd}::timestamptz,
          ${input.syncStatus}::public.dispatch_sync_status,
          ${input.syncError ?? null},
          now()
        )
        on conflict (sdp_request_id) do update set
          sdp_request_number = excluded.sdp_request_number,
          outlook_event_id = excluded.outlook_event_id,
          outlook_calendar_email = excluded.outlook_calendar_email,
          technician_id = excluded.technician_id,
          scheduled_start = excluded.scheduled_start,
          scheduled_end = excluded.scheduled_end,
          last_sync_status = excluded.last_sync_status,
          last_sync_error = excluded.last_sync_error,
          updated_at = now()
        returning id::text as "id"
      `;
      const dispatchLinkId = links[0]?.id;
      if (!dispatchLinkId) {
        throw new Error("The scheduled request link could not be stored.");
      }

      await sql`
        delete from public.dispatch_link_crew
        where dispatch_link_id = ${dispatchLinkId}::uuid
      `;
      for (const member of crew) {
        await sql`
          insert into public.dispatch_link_crew (
            dispatch_link_id,
            technician_id,
            outlook_event_id,
            outlook_calendar_email,
            last_sync_status,
            last_sync_error,
            updated_at
          )
          values (
            ${dispatchLinkId}::uuid,
            ${member.databaseTechnicianId}::uuid,
            ${member.outlookEventId ?? null},
            ${member.outlookCalendarEmail},
            ${member.syncStatus}::public.dispatch_sync_status,
            ${member.syncError ?? null},
            now()
          )
        `;
      }

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
          ${input.outlookEventId ?? null},
          ${technicianId}::uuid,
          ${input.action},
          ${input.syncStatus === "linked" ? "success" : "warning"}::public.dispatch_sync_log_status,
          ${input.syncError ?? "Helpdesk request linked to technician schedule."},
          ${sql.json({
            bookingType: input.bookingType,
            contactEmail: input.contactEmail,
            contactName: input.contactName,
            contactPhone: input.contactPhone,
            crewTechnicianIds: crew.map((member) => member.databaseTechnicianId),
            customerName: input.customer,
            description: input.description,
            priority: input.priority,
            requestStatus: "Scheduled",
            siteAddress: input.siteAddress,
            siteName: input.siteName,
            siteTown: input.siteTown,
            source: input.action,
            subject: input.subject,
          })}
        )
      `;
    },
  };
}

async function resolveTechnicianId(
  sql: postgres.Sql,
  input: {
    email?: string;
    mspCentralId?: string;
    technicianId?: string;
  },
) {
  const technicians = await sql<Array<{ id: string }>>`
        select t.id::text as "id"
        from public.technicians t
        left join public.staff_profiles sp
          on lower(sp.outlook_email) = lower(t.outlook_email)
          or (
            sp.msp_central_technician_id is not null
            and t.sdp_technician_id is not null
            and sp.msp_central_technician_id = t.sdp_technician_id
          )
        where
          t.id::text = ${input.technicianId ?? ""}
          or sp.id::text = ${input.technicianId ?? ""}
          or lower(t.outlook_email) = lower(${input.email ?? ""})
          or lower(sp.zoho_email) = lower(${input.email ?? ""})
          or lower(sp.msp_central_email) = lower(${input.email ?? ""})
          or t.sdp_technician_id = ${input.mspCentralId ?? ""}
        limit 1
      `;
  const technicianId = technicians[0]?.id;
  if (!technicianId) {
    throw new Error("The scheduled technician is not mapped in Command Centre.");
  }
  return technicianId;
}

function getSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for dispatch link persistence.");
  }
  return getSharedPostgresClient(databaseUrl);
}
