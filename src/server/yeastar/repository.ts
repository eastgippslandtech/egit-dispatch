import postgres from "postgres";

import { getServerlessPostgresOptions } from "@/server/database/postgres-options";
import type { Appointment } from "@/server/dispatch/types";

import type { YeastarToken } from "./client";
import { getMelbourneWeekRange } from "./talk-time";
import type { YeastarCallDirection, YeastarCallSegmentInput, YeastarTranscriptStatus } from "./types";

type CallUpsert = {
  answeredAt?: string;
  callId: string;
  callStatus: string;
  cdrId: string;
  connectedTalkSeconds: number;
  direction: YeastarCallDirection;
  endedAt: string;
  externalNumber: string;
  normalisedExternalNumber?: string;
  rawMetadata: Record<string, unknown>;
  segmentAttributionAvailable: boolean;
  startedAt: string;
  transcriptStatus: YeastarTranscriptStatus;
};

let sqlSingleton: postgres.Sql | undefined;
let repositorySingleton: PostgresYeastarRepository | undefined;

export class PostgresYeastarRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async recordEvent(input: {
    callId?: string;
    eventKey: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    const rows = await this.sql<Array<{ inserted: boolean }>>`
      insert into public.yeastar_ingestion_events (
        event_key, event_type, yeastar_call_id, payload
      ) values (
        ${input.eventKey}, ${input.eventType}, ${input.callId ?? null},
        ${this.sql.json(input.payload as postgres.JSONValue)}
      )
      on conflict (event_key) do nothing
      returning true as inserted
    `;
    return rows[0]?.inserted === true;
  }

  async listPendingEvents(limit = 25) {
    return this.sql<Array<{
      callId: string | null;
      eventKey: string;
      id: string;
      payload: Record<string, unknown>;
    }>>`
      select
        id::text as id,
        event_key as "eventKey",
        yeastar_call_id as "callId",
        payload
      from public.yeastar_ingestion_events
      where processed_at is null
      order by received_at
      limit ${limit}
    `;
  }

  async finishEvent(id: string, error?: string) {
    await this.sql`
      update public.yeastar_ingestion_events
      set processed_at = ${error ? null : new Date()},
          processing_error = ${error ?? null}
      where id = ${id}::uuid
    `;
  }

  async listStaffMappings() {
    return this.sql<Array<{
      extension: string;
      staffId: string;
      technicianId: string;
      userId: string | null;
    }>>`
      select
        ysm.yeastar_extension as extension,
        ysm.yeastar_user_id as "userId",
        sp.id::text as "staffId",
        'tech-' || regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '-', 'g')
          as "technicianId"
      from public.yeastar_staff_mappings ysm
      join public.staff_profiles sp on sp.id = ysm.command_centre_staff_id
      where ysm.active = true and sp.active = true
    `;
  }

  async upsertCall(input: CallUpsert) {
    const rows = await this.sql<Array<{ id: string }>>`
      insert into public.yeastar_calls (
        yeastar_call_id, yeastar_cdr_id, direction, external_number,
        normalised_external_number, started_at, answered_at, ended_at,
        connected_talk_seconds, call_status, transcript_status,
        segment_attribution_available, raw_metadata, next_processing_at
      ) values (
        ${input.callId}, ${input.cdrId}, ${input.direction}, ${input.externalNumber},
        ${input.normalisedExternalNumber ?? null}, ${input.startedAt},
        ${input.answeredAt ?? null}, ${input.endedAt},
        ${input.connectedTalkSeconds}, ${input.callStatus}, ${input.transcriptStatus},
        ${input.segmentAttributionAvailable}, ${this.sql.json(input.rawMetadata as postgres.JSONValue)},
        ${input.transcriptStatus === "awaiting_transcript"
          ? new Date(Date.now() + 5 * 60_000)
          : null}
      )
      on conflict (yeastar_cdr_id) where yeastar_cdr_id is not null do update set
        direction = excluded.direction,
        external_number = excluded.external_number,
        normalised_external_number = excluded.normalised_external_number,
        started_at = excluded.started_at,
        answered_at = excluded.answered_at,
        ended_at = excluded.ended_at,
        connected_talk_seconds = excluded.connected_talk_seconds,
        call_status = excluded.call_status,
        transcript_status = excluded.transcript_status,
        segment_attribution_available = excluded.segment_attribution_available,
        raw_metadata = excluded.raw_metadata,
        updated_at = now()
      returning id::text as id
    `;
    return rows[0].id;
  }

  async upsertSegments(callId: string, segments: YeastarCallSegmentInput[]) {
    for (const segment of segments) {
      await this.sql`
        insert into public.yeastar_call_segments (
          yeastar_call_id, yeastar_segment_id, command_centre_staff_id,
          yeastar_extension, connected_at, disconnected_at,
          external_talk_seconds, raw_metadata
        ) values (
          ${callId}::uuid, ${segment.segmentId},
          ${segment.staffId ?? null}::uuid, ${segment.extension},
          ${segment.connectedAt ?? null}, ${segment.disconnectedAt ?? null},
          ${segment.talkSeconds}, ${this.sql.json((segment.rawMetadata ?? {}) as postgres.JSONValue)}
        )
        on conflict (yeastar_call_id, yeastar_segment_id) do update set
          command_centre_staff_id = excluded.command_centre_staff_id,
          yeastar_extension = excluded.yeastar_extension,
          connected_at = excluded.connected_at,
          disconnected_at = excluded.disconnected_at,
          external_talk_seconds = excluded.external_talk_seconds,
          raw_metadata = excluded.raw_metadata,
          updated_at = now()
      `;
    }
  }

  async updateTranscript(input: {
    actionItems?: unknown[];
    callId: string;
    error?: string;
    status: YeastarTranscriptStatus;
    summary?: string;
    transcript?: string;
  }) {
    await this.sql`
      update public.yeastar_calls
      set transcript_status = ${input.status},
          transcript = ${input.transcript ?? null},
          summary = ${input.summary ?? null},
          action_items = ${this.sql.json((input.actionItems ?? []) as postgres.JSONValue)},
          processing_attempts = processing_attempts + 1,
          last_processing_error = ${input.error ?? null},
          next_processing_at = case
            when ${input.status} = 'awaiting_transcript'
              then now() + interval '5 minutes'
            else null
          end,
          updated_at = now()
      where id = ${input.callId}::uuid
    `;
  }

  async findPhoneMapping(phone: string) {
    const rows = await this.sql<Array<{
      accountId: string | null;
      contactId: string | null;
      contactName: string | null;
      customerName: string | null;
    }>>`
      select
        zoho_contact_id as "contactId",
        zoho_account_id as "accountId",
        customer_name as "customerName",
        contact_name as "contactName"
      from public.phone_customer_mappings
      where normalised_phone_number = ${phone}
      limit 1
    `;
    return rows[0];
  }

  async savePhoneMapping(input: {
    accountId?: string;
    contactId?: string;
    contactName?: string;
    customerName?: string;
    phone: string;
  }) {
    await this.sql`
      insert into public.phone_customer_mappings (
        normalised_phone_number, zoho_contact_id, zoho_account_id,
        customer_name, contact_name
      ) values (
        ${input.phone}, ${input.contactId ?? null}, ${input.accountId ?? null},
        ${input.customerName ?? null}, ${input.contactName ?? null}
      )
      on conflict (normalised_phone_number) do update set
        zoho_contact_id = case
          when phone_customer_mappings.manually_confirmed
            then phone_customer_mappings.zoho_contact_id
          else excluded.zoho_contact_id
        end,
        zoho_account_id = case
          when phone_customer_mappings.manually_confirmed
            then phone_customer_mappings.zoho_account_id
          else excluded.zoho_account_id
        end,
        customer_name = case
          when phone_customer_mappings.manually_confirmed
            then phone_customer_mappings.customer_name
          else excluded.customer_name
        end,
        contact_name = case
          when phone_customer_mappings.manually_confirmed
            then phone_customer_mappings.contact_name
          else excluded.contact_name
        end,
        updated_at = now()
    `;
  }

  async updateCallCustomer(
    callId: string,
    match: {
      accountId?: string | null;
      contactId?: string | null;
      contactName?: string | null;
      customerName?: string | null;
    },
  ) {
    await this.sql`
      update public.yeastar_calls
      set zoho_contact_id = ${match.contactId ?? null},
          zoho_account_id = ${match.accountId ?? null},
          matched_customer_name = ${match.customerName ?? null},
          matched_contact_name = ${match.contactName ?? null},
          updated_at = now()
      where id = ${callId}::uuid
    `;
  }

  async listExternalCallAppointments(from: string, to: string): Promise<Appointment[]> {
    const rows = await this.sql<Array<{
      callId: string;
      customer: string | null;
      direction: YeastarCallDirection;
      endedAt: Date;
      externalNumber: string;
      id: string;
      startedAt: Date;
      talkSeconds: number;
      technicianId: string;
      transcriptStatus: YeastarTranscriptStatus;
    }>>`
      select
        ycs.id::text as id,
        yc.yeastar_call_id as "callId",
        yc.direction,
        yc.external_number as "externalNumber",
        yc.matched_customer_name as customer,
        ycs.connected_at as "startedAt",
        ycs.disconnected_at as "endedAt",
        ycs.external_talk_seconds as "talkSeconds",
        yc.transcript_status as "transcriptStatus",
        'tech-' || regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '-', 'g')
          as "technicianId"
      from public.yeastar_call_segments ycs
      join public.yeastar_calls yc on yc.id = ycs.yeastar_call_id
      join public.staff_profiles sp on sp.id = ycs.command_centre_staff_id
      where ycs.connected_at >= ${from}
        and ycs.connected_at < ${to}
      order by ycs.connected_at
    `;
    return rows.map((row) => ({
      activityType: "external_call",
      callDirection: row.direction,
      customer: row.customer ?? row.externalNumber,
      date: melbourneDate(row.startedAt),
      end: melbourneTime(row.endedAt),
      externalTalkSeconds: row.talkSeconds,
      id: `call-${row.id}`,
      readOnly: true,
      source: "yeastar",
      start: melbourneTime(row.startedAt),
      status: "busy",
      technicianId: row.technicianId,
      title: `${row.direction === "outbound" ? "Outbound" : "Inbound"} call`,
      transcriptStatus: row.transcriptStatus,
      yeastarCallId: row.callId,
    }));
  }

  async getWeeklyTalkTotals(now = new Date()) {
    const range = getMelbourneWeekRange(now);
    const rows = await this.sql<Array<{ seconds: number; technicianId: string }>>`
      select
        'tech-' || regexp_replace(lower(sp.display_name), '[^a-z0-9]+', '-', 'g')
          as "technicianId",
        coalesce(sum(ycs.external_talk_seconds), 0)::integer as seconds
      from public.staff_profiles sp
      left join public.yeastar_call_segments ycs
        on ycs.command_centre_staff_id = sp.id
       and ycs.connected_at >= ${range.start}
       and ycs.connected_at <= ${range.end}
      where sp.active = true
      group by sp.id, sp.display_name
    `;
    return Object.fromEntries(rows.map((row) => [row.technicianId, row.seconds]));
  }

  async listCalls(limit = 100) {
    return this.sql<Array<Record<string, unknown>>>`
      select
        yc.id::text as id,
        yc.direction,
        yc.external_number as "externalNumber",
        yc.started_at as "startedAt",
        yc.ended_at as "endedAt",
        yc.connected_talk_seconds as "connectedTalkSeconds",
        yc.transcript_status as "transcriptStatus",
        yc.matched_customer_name as "customerName",
        yc.matched_contact_name as "contactName",
        yc.summary,
        coalesce(techs.names, '') as technicians
      from public.yeastar_calls yc
      left join lateral (
        select string_agg(distinct sp.display_name, ', ' order by sp.display_name) as names
        from public.yeastar_call_segments ycs
        join public.staff_profiles sp on sp.id = ycs.command_centre_staff_id
        where ycs.yeastar_call_id = yc.id
      ) techs on true
      where yc.transcript_status not in ('ignored_internal', 'ignored_unanswered')
      order by yc.started_at desc
      limit ${limit}
    `;
  }

  async getCall(id: string) {
    const rows = await this.sql<Array<Record<string, unknown>>>`
      select
        yc.id::text as id,
        yc.*,
        coalesce(jsonb_agg(
          jsonb_build_object(
            'extension', ycs.yeastar_extension,
            'talkSeconds', ycs.external_talk_seconds,
            'connectedAt', ycs.connected_at,
            'disconnectedAt', ycs.disconnected_at,
            'technician', sp.display_name
          )
        ) filter (where ycs.id is not null), '[]'::jsonb) as segments
      from public.yeastar_calls yc
      left join public.yeastar_call_segments ycs on ycs.yeastar_call_id = yc.id
      left join public.staff_profiles sp on sp.id = ycs.command_centre_staff_id
      where yc.id = ${id}::uuid
      group by yc.id
    `;
    return rows[0];
  }

  async loadToken(): Promise<YeastarToken | undefined> {
    const rows = await this.sql<Array<{
      accessExpiresAt: Date | null;
      accessToken: string | null;
      refreshExpiresAt: Date | null;
      refreshToken: string | null;
    }>>`
      select
        access_token as "accessToken",
        refresh_token as "refreshToken",
        access_expires_at as "accessExpiresAt",
        refresh_expires_at as "refreshExpiresAt"
      from public.yeastar_api_tokens
      where singleton_key = 'yeastar'
    `;
    const row = rows[0];
    if (!row?.accessToken || !row.accessExpiresAt) return undefined;
    return {
      accessToken: row.accessToken,
      expiresAt: row.accessExpiresAt.getTime(),
      refreshExpiresAt: row.refreshExpiresAt?.getTime(),
      refreshToken: row.refreshToken ?? undefined,
    };
  }

  async saveToken(token: YeastarToken) {
    await this.sql`
      insert into public.yeastar_api_tokens (
        singleton_key, access_token, refresh_token,
        access_expires_at, refresh_expires_at
      ) values (
        'yeastar', ${token.accessToken}, ${token.refreshToken ?? null},
        ${new Date(token.expiresAt)},
        ${token.refreshExpiresAt ? new Date(token.refreshExpiresAt) : null}
      )
      on conflict (singleton_key) do update set
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        access_expires_at = excluded.access_expires_at,
        refresh_expires_at = excluded.refresh_expires_at,
        updated_at = now()
    `;
  }

  tokenStore() {
    return {
      load: () => this.loadToken(),
      save: (token: YeastarToken) => this.saveToken(token),
    };
  }
}

export function getConfiguredYeastarRepository(
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl?.trim()) return null;
  sqlSingleton ??= postgres(databaseUrl, getServerlessPostgresOptions());
  repositorySingleton ??= new PostgresYeastarRepository(sqlSingleton);
  return repositorySingleton;
}

function melbourneDate(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit", month: "2-digit", timeZone: "Australia/Melbourne", year: "numeric",
  }).format(value);
}

function melbourneTime(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit", hour12: false, minute: "2-digit", timeZone: "Australia/Melbourne",
  }).format(value);
}
