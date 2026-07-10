create type public.staff_role as enum (
  'admin',
  'technician'
);

create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  role public.staff_role not null default 'technician',
  base_office text not null,
  zoho_email text not null,
  outlook_email text not null,
  outlook_user_principal_name text not null,
  msp_central_email text not null,
  msp_central_technician_id text,
  msp_central_technician_name text,
  active boolean not null default true,
  calendar_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_profiles_zoho_email_unique unique (zoho_email),
  constraint staff_profiles_outlook_email_unique unique (outlook_email),
  constraint staff_profiles_outlook_upn_unique unique (outlook_user_principal_name),
  constraint staff_profiles_msp_central_email_unique unique (msp_central_email),
  constraint staff_profiles_msp_central_technician_id_unique unique (msp_central_technician_id)
);

create index staff_profiles_active_idx
  on public.staff_profiles (active);

create index staff_profiles_identity_lookup_idx
  on public.staff_profiles (
    zoho_email,
    outlook_user_principal_name,
    msp_central_email
  );

alter table public.staff_profiles enable row level security;

revoke all on public.staff_profiles from anon, authenticated;

grant select, insert, update, delete on public.staff_profiles to service_role;
