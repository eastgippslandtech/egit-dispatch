import postgres from "postgres";

import type {
  PresenceOverride,
  PresenceOverrideSource,
} from "./types";

export type PresenceOverrideRow = {
  clearedAt: string | null;
  createdAt: string;
  createdByEmail: string;
  endsAt: string;
  id: string;
  reason: string | null;
  source: PresenceOverrideSource;
  startsAt: string;
  status: "leave" | "lunch";
  technicianEmail: string;
};

type InsertOverrideRow = Omit<
  PresenceOverrideRow,
  "clearedAt" | "createdAt" | "id"
>;

export type PresenceOverrideStore = {
  clearActive(input: {
    clearedAt: string;
    technicianEmail: string;
  }): Promise<void>;
  insert(row: InsertOverrideRow): Promise<PresenceOverrideRow>;
  listActive(now: Date): Promise<PresenceOverrideRow[]>;
};

export type PresenceOverrideRepository = ReturnType<
  typeof createPresenceOverrideRepository
>;

let sqlSingleton: postgres.Sql | undefined;
let repositorySingleton: PresenceOverrideRepository | undefined;
let schemaReady: Promise<void> | undefined;

export function createPresenceOverrideRepository(
  store: PresenceOverrideStore,
) {
  return {
    async clear({
      now = new Date(),
      technicianEmail,
    }: {
      now?: Date;
      technicianEmail: string;
    }) {
      await store.clearActive({
        clearedAt: now.toISOString(),
        technicianEmail: normalizeEmail(technicianEmail),
      });
    },

    async listActive(now = new Date()): Promise<PresenceOverride[]> {
      return (await store.listActive(now)).map(mapRow);
    },

    async setLeave({
      createdByEmail,
      endsAt,
      now = new Date(),
      reason,
      source,
      technicianEmail,
    }: {
      createdByEmail: string;
      endsAt: string;
      now?: Date;
      reason?: string;
      source: PresenceOverrideSource;
      technicianEmail: string;
    }) {
      const end = new Date(endsAt);
      if (!Number.isFinite(end.getTime()) || end <= now) {
        throw new Error("Leave must end after it starts.");
      }

      await store.clearActive({
        clearedAt: now.toISOString(),
        technicianEmail: normalizeEmail(technicianEmail),
      });
      return mapRow(
        await store.insert({
          createdByEmail: normalizeEmail(createdByEmail),
          endsAt: end.toISOString(),
          reason: safeReason(reason),
          source,
          startsAt: now.toISOString(),
          status: "leave",
          technicianEmail: normalizeEmail(technicianEmail),
        }),
      );
    },

    async startLunch({
      createdByEmail,
      now = new Date(),
      source,
      technicianEmail,
    }: {
      createdByEmail: string;
      now?: Date;
      source: PresenceOverrideSource;
      technicianEmail: string;
    }) {
      const normalizedTechnicianEmail = normalizeEmail(technicianEmail);
      await store.clearActive({
        clearedAt: now.toISOString(),
        technicianEmail: normalizedTechnicianEmail,
      });
      return mapRow(
        await store.insert({
          createdByEmail: normalizeEmail(createdByEmail),
          endsAt: new Date(now.getTime() + 30 * 60_000).toISOString(),
          reason: null,
          source,
          startsAt: now.toISOString(),
          status: "lunch",
          technicianEmail: normalizedTechnicianEmail,
        }),
      );
    },
  };
}

export function getConfiguredPresenceOverrideRepository(
  databaseUrl = process.env.DATABASE_URL,
) {
  if (!databaseUrl?.trim()) {
    return null;
  }

  repositorySingleton ??= createPostgresPresenceOverrideRepository({
    databaseUrl,
  });
  return repositorySingleton;
}

export function createPostgresPresenceOverrideRepository({
  databaseUrl = process.env.DATABASE_URL,
  sql = getPostgresSql(databaseUrl),
}: {
  databaseUrl?: string;
  sql?: postgres.Sql;
} = {}) {
  const store: PresenceOverrideStore = {
    async clearActive({ clearedAt, technicianEmail }) {
      await ensurePresenceOverrideSchema(sql);
      await sql`
        update public.technician_presence_overrides
        set cleared_at = ${clearedAt},
            updated_at = ${clearedAt}
        where staff_profile_id in (
          select id
          from public.staff_profiles
          where lower(zoho_email) = lower(${technicianEmail})
             or lower(outlook_email) = lower(${technicianEmail})
        )
          and cleared_at is null
          and ends_at > ${clearedAt}
      `;
    },

    async insert(row) {
      await ensurePresenceOverrideSchema(sql);
      const inserted = await sql<PresenceOverrideRow[]>`
        with selected_staff as (
          select id, zoho_email
          from public.staff_profiles
          where active = true
            and (
              lower(zoho_email) = lower(${row.technicianEmail})
              or lower(outlook_email) = lower(${row.technicianEmail})
            )
          limit 1
        )
        insert into public.technician_presence_overrides (
          staff_profile_id,
          status,
          starts_at,
          ends_at,
          reason,
          source,
          created_by_email
        )
        select
          selected_staff.id,
          ${row.status},
          ${row.startsAt},
          ${row.endsAt},
          ${row.reason},
          ${row.source},
          ${row.createdByEmail}
        from selected_staff
        returning
          id::text as "id",
          ${row.technicianEmail}::text as "technicianEmail",
          status::text as "status",
          starts_at::text as "startsAt",
          ends_at::text as "endsAt",
          reason,
          source::text as "source",
          created_by_email as "createdByEmail",
          created_at::text as "createdAt",
          cleared_at::text as "clearedAt"
      `;

      if (!inserted[0]) {
        throw new Error("Technician is not enabled for Command Centre presence.");
      }
      return inserted[0];
    },

    async listActive(now) {
      await ensurePresenceOverrideSchema(sql);
      return sql<PresenceOverrideRow[]>`
        select
          presence.id::text as "id",
          staff.zoho_email as "technicianEmail",
          presence.status::text as "status",
          presence.starts_at::text as "startsAt",
          presence.ends_at::text as "endsAt",
          presence.reason,
          presence.source::text as "source",
          presence.created_by_email as "createdByEmail",
          presence.created_at::text as "createdAt",
          presence.cleared_at::text as "clearedAt"
        from public.technician_presence_overrides presence
        join public.staff_profiles staff on staff.id = presence.staff_profile_id
        where presence.cleared_at is null
          and presence.starts_at <= ${now.toISOString()}
          and presence.ends_at > ${now.toISOString()}
          and staff.active = true
        order by presence.starts_at desc
      `;
    },
  };

  return createPresenceOverrideRepository(store);
}

function getPostgresSql(databaseUrl?: string) {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required for presence overrides.");
  }

  sqlSingleton ??= postgres(databaseUrl, {
    max: 3,
    prepare: false,
    ssl: "require",
  });
  return sqlSingleton;
}

async function ensurePresenceOverrideSchema(sql: postgres.Sql) {
  schemaReady ??= (async () => {
    await sql.unsafe(`
      alter table public.staff_profiles
        add column if not exists zoho_people_employee_id text
    `);
    await sql.unsafe(`
      create unique index if not exists staff_profiles_zoho_people_employee_id_unique
        on public.staff_profiles (zoho_people_employee_id)
        where zoho_people_employee_id is not null
    `);
    await sql.unsafe(`
      do $$
      begin
        create type public.technician_presence_override_status as enum (
          'lunch',
          'leave'
        );
      exception
        when duplicate_object then null;
      end
      $$
    `);
    await sql.unsafe(`
      do $$
      begin
        create type public.technician_presence_override_source as enum (
          'dispatch',
          'technician_app',
          'system'
        );
      exception
        when duplicate_object then null;
      end
      $$
    `);
    await sql.unsafe(`
      create table if not exists public.technician_presence_overrides (
        id uuid primary key default gen_random_uuid(),
        staff_profile_id uuid not null
          references public.staff_profiles(id) on delete cascade,
        status public.technician_presence_override_status not null,
        starts_at timestamptz not null,
        ends_at timestamptz not null,
        reason text,
        source public.technician_presence_override_source not null,
        created_by_email text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        cleared_at timestamptz,
        constraint technician_presence_override_time_order
          check (ends_at > starts_at),
        constraint technician_presence_override_reason_length
          check (reason is null or char_length(reason) <= 120)
      )
    `);
    await sql.unsafe(`
      create index if not exists technician_presence_overrides_active_idx
        on public.technician_presence_overrides (
          staff_profile_id,
          starts_at,
          ends_at
        )
        where cleared_at is null
    `);
    await sql.unsafe(`
      alter table public.technician_presence_overrides enable row level security
    `);
    await sql.unsafe(`
      revoke all on public.technician_presence_overrides from anon, authenticated
    `);
    await sql.unsafe(`
      grant select, insert, update, delete
        on public.technician_presence_overrides
        to service_role
    `);
  })();

  await schemaReady;
}

function mapRow(row: PresenceOverrideRow): PresenceOverride {
  return {
    clearedAt: row.clearedAt ?? undefined,
    createdAt: toIso(row.createdAt),
    createdByEmail: normalizeEmail(row.createdByEmail),
    endsAt: toIso(row.endsAt),
    id: row.id,
    reason: row.reason ?? undefined,
    source: row.source,
    startsAt: toIso(row.startsAt),
    status: row.status,
    technicianEmail: normalizeEmail(row.technicianEmail),
  };
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function safeReason(value?: string) {
  const reason = value?.trim().replace(/\s+/g, " ");
  return reason ? reason.slice(0, 120) : null;
}

function toIso(value: string) {
  return new Date(value).toISOString();
}
