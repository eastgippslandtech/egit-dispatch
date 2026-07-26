alter table public.staff_profiles
  add column if not exists zoho_people_employee_id text;

create unique index if not exists staff_profiles_zoho_people_employee_id_unique
  on public.staff_profiles (zoho_people_employee_id)
  where zoho_people_employee_id is not null;

do $$
begin
  create type public.technician_presence_override_status as enum (
    'lunch',
    'leave'
  );
exception
  when duplicate_object then null;
end
$$;

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
$$;

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
  constraint technician_presence_override_time_order check (ends_at > starts_at),
  constraint technician_presence_override_reason_length check (
    reason is null or char_length(reason) <= 120
  )
);

create index technician_presence_overrides_active_idx
  on public.technician_presence_overrides (
    staff_profile_id,
    starts_at,
    ends_at
  )
  where cleared_at is null;

alter table public.technician_presence_overrides enable row level security;

revoke all on public.technician_presence_overrides from anon, authenticated;

grant select, insert, update, delete
  on public.technician_presence_overrides
  to service_role;
