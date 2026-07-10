create type public.dispatch_sync_status as enum (
  'linked',
  'needs_review',
  'sdp_only',
  'outlook_only',
  'failed'
);

create type public.dispatch_sync_log_status as enum (
  'success',
  'warning',
  'failed'
);

create table public.technicians (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  sdp_technician_id text,
  sdp_technician_name text,
  outlook_email text not null,
  store_location text not null,
  active boolean not null default true,
  default_calendar_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technicians_outlook_email_unique unique (outlook_email),
  constraint technicians_sdp_technician_id_unique unique (sdp_technician_id)
);

create table public.dispatch_links (
  id uuid primary key default gen_random_uuid(),
  sdp_request_id text not null,
  sdp_request_number text not null,
  outlook_event_id text,
  outlook_calendar_email text,
  technician_id uuid references public.technicians(id) on delete set null,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  last_sdp_hash text,
  last_outlook_hash text,
  last_sync_status public.dispatch_sync_status not null default 'needs_review',
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_links_sdp_request_id_unique unique (sdp_request_id),
  constraint dispatch_links_outlook_event_id_unique unique (outlook_event_id),
  constraint dispatch_links_schedule_order check (
    scheduled_start is null
    or scheduled_end is null
    or scheduled_end > scheduled_start
  )
);

create table public.dispatch_sync_logs (
  id uuid primary key default gen_random_uuid(),
  sdp_request_id text,
  outlook_event_id text,
  technician_id uuid references public.technicians(id) on delete set null,
  action text not null,
  status public.dispatch_sync_log_status not null,
  message text,
  payload_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.dispatch_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_settings_key_unique unique (key)
);

create index dispatch_links_technician_schedule_idx
  on public.dispatch_links (technician_id, scheduled_start, scheduled_end);

create index dispatch_links_last_sync_status_idx
  on public.dispatch_links (last_sync_status);

create index dispatch_sync_logs_request_created_idx
  on public.dispatch_sync_logs (sdp_request_id, created_at desc);

create index dispatch_sync_logs_technician_created_idx
  on public.dispatch_sync_logs (technician_id, created_at desc);

alter table public.technicians enable row level security;
alter table public.dispatch_links enable row level security;
alter table public.dispatch_sync_logs enable row level security;
alter table public.dispatch_settings enable row level security;

revoke all on public.technicians from anon, authenticated;
revoke all on public.dispatch_links from anon, authenticated;
revoke all on public.dispatch_sync_logs from anon, authenticated;
revoke all on public.dispatch_settings from anon, authenticated;

grant select, insert, update, delete on public.technicians to service_role;
grant select, insert, update, delete on public.dispatch_links to service_role;
grant select, insert, update, delete on public.dispatch_sync_logs to service_role;
grant select, insert, update, delete on public.dispatch_settings to service_role;
