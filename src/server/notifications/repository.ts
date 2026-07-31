import type postgres from "postgres";

import { getSharedPostgresClient } from "@/server/database/client";
import { getInitialStaffProfiles } from "@/server/staff/profiles";

export type PushDeviceRegistration = {
  appVersion: string;
  installationId: string;
  platform: string;
  pushToken: string;
  staffEmail: string;
};

export type NotificationRequestState = {
  fingerprint: string;
  priority: string;
  requestId: string;
  requestNumber: string;
  scheduledEnd?: string;
  scheduledStart?: string;
  status: string;
  technicianId?: string;
  updatedAt?: string;
  updatedByEmail?: string;
};

export type NotificationDelivery = {
  body: string;
  eventKey: string;
  eventType: string;
  providerReceiptId?: string;
  requestId: string;
  status: "sent" | "no_device" | "failed";
  technicianId: string;
  title: string;
};

export type PushRegistrationRepository = {
  registerDevice(input: PushDeviceRegistration): Promise<void>;
};

let repositorySingleton: PostgresNotificationRepository | undefined;

export class PostgresNotificationRepository
  implements PushRegistrationRepository
{
  constructor(private readonly sql: postgres.Sql) {}

  async registerDevice(input: PushDeviceRegistration) {
    const rows = await this.sql<Array<{ id: string }>>`
      insert into public.mobile_push_devices (
        staff_profile_id,
        installation_id,
        platform,
        push_token,
        app_version,
        active,
        last_registered_at
      )
      select
        sp.id,
        ${input.installationId},
        ${input.platform},
        ${input.pushToken},
        ${input.appVersion},
        true,
        now()
      from public.staff_profiles sp
      where lower(sp.zoho_email) = lower(${input.staffEmail})
      on conflict (installation_id) do update set
        staff_profile_id = excluded.staff_profile_id,
        platform = excluded.platform,
        push_token = excluded.push_token,
        app_version = excluded.app_version,
        active = true,
        last_registered_at = now(),
        updated_at = now()
      returning id::text as id
    `;

    if (!rows[0]) {
      throw new Error("The mobile staff profile could not register for notifications.");
    }
  }

  async getState(requestId: string) {
    const rows = await this.sql<
      Array<NotificationRequestState & { snapshot: NotificationRequestState }>
    >`
      select snapshot
      from public.dispatch_request_notification_state
      where request_id = ${requestId}
      limit 1
    `;

    return rows[0]?.snapshot;
  }

  async getStates(requestIds: string[]) {
    if (requestIds.length === 0) {
      return new Map<string, NotificationRequestState>();
    }

    const rows = await this.sql<
      Array<{ requestId: string; snapshot: NotificationRequestState }>
    >`
      select
        request_id as "requestId",
        snapshot
      from public.dispatch_request_notification_state
      where request_id in ${this.sql(requestIds)}
    `;

    return new Map(rows.map((row) => [row.requestId, row.snapshot]));
  }

  async saveState(state: NotificationRequestState) {
    await this.sql`
      insert into public.dispatch_request_notification_state (
        request_id,
        request_number,
        technician_id,
        fingerprint,
        snapshot,
        last_observed_at
      )
      values (
        ${state.requestId},
        ${state.requestNumber},
        ${state.technicianId ?? null},
        ${state.fingerprint},
        ${this.sql.json(state)},
        now()
      )
      on conflict (request_id) do update set
        request_number = excluded.request_number,
        technician_id = excluded.technician_id,
        fingerprint = excluded.fingerprint,
        snapshot = excluded.snapshot,
        last_observed_at = now(),
        updated_at = now()
    `;
  }

  async saveStates(states: NotificationRequestState[]) {
    if (states.length === 0) {
      return;
    }

    const values = states.map((state) => ({
      fingerprint: state.fingerprint,
      request_id: state.requestId,
      request_number: state.requestNumber,
      snapshot: this.sql.json(state),
      technician_id: state.technicianId ?? null,
    }));

    await this.sql`
      insert into public.dispatch_request_notification_state ${
        this.sql(
          values,
          "request_id",
          "request_number",
          "technician_id",
          "fingerprint",
          "snapshot",
        )
      }
      on conflict (request_id) do update set
        request_number = excluded.request_number,
        technician_id = excluded.technician_id,
        fingerprint = excluded.fingerprint,
        snapshot = excluded.snapshot,
        last_observed_at = now(),
        updated_at = now()
    `;
  }

  async listPushTokens(technicianId: string) {
    const profile = getInitialStaffProfiles().find(
      (candidate) =>
        `tech-${candidate.displayName.toLowerCase()}` === technicianId,
    );
    if (!profile) {
      return [];
    }

    const rows = await this.sql<Array<{ pushToken: string }>>`
      select mpd.push_token as "pushToken"
      from public.mobile_push_devices mpd
      join public.staff_profiles sp on sp.id = mpd.staff_profile_id
      where lower(sp.zoho_email) = lower(${profile.zohoEmail})
        and mpd.active = true
      order by mpd.last_registered_at desc
    `;

    return [...new Set(rows.map((row) => row.pushToken))];
  }

  async listPushTokensByTechnician(technicianIds: string[]) {
    const profiles = getInitialStaffProfiles().filter((candidate) =>
      technicianIds.includes(`tech-${candidate.displayName.toLowerCase()}`),
    );
    if (profiles.length === 0) {
      return new Map<string, string[]>();
    }

    const emails = profiles.map((profile) => profile.zohoEmail.toLowerCase());
    const rows = await this.sql<
      Array<{ pushToken: string; staffEmail: string }>
    >`
      select
        mpd.push_token as "pushToken",
        lower(sp.zoho_email) as "staffEmail"
      from public.mobile_push_devices mpd
      join public.staff_profiles sp on sp.id = mpd.staff_profile_id
      where lower(sp.zoho_email) in ${this.sql(emails)}
        and mpd.active = true
      order by mpd.last_registered_at desc
    `;

    return new Map(
      profiles.map((profile) => {
        const email = profile.zohoEmail.toLowerCase();
        const technicianId = `tech-${profile.displayName.toLowerCase()}`;
        return [
          technicianId,
          [
            ...new Set(
              rows
                .filter((row) => row.staffEmail === email)
                .map((row) => row.pushToken),
            ),
          ],
        ];
      }),
    );
  }

  async recordDelivery(input: NotificationDelivery) {
    await this.sql`
      insert into public.mobile_notification_deliveries (
        request_id,
        technician_id,
        event_type,
        event_key,
        title,
        body,
        status,
        provider_receipt_id
      )
      values (
        ${input.requestId},
        ${input.technicianId},
        ${input.eventType},
        ${input.eventKey},
        ${input.title},
        ${input.body},
        ${input.status},
        ${input.providerReceiptId ?? null}
      )
      on conflict (event_key) do nothing
    `;
  }
}

export function getConfiguredNotificationRepository(
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl?.trim()) {
    return null;
  }

  repositorySingleton ??= new PostgresNotificationRepository(
    getSharedPostgresClient(databaseUrl),
  );
  return repositorySingleton;
}
