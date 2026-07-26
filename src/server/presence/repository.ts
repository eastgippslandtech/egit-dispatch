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
