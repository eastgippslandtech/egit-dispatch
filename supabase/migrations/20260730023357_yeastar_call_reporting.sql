create table public.yeastar_calls (
  id uuid primary key default gen_random_uuid(),
  yeastar_call_id text,
  yeastar_cdr_id text,
  parent_call_id text,
  direction text not null default 'unknown'
    check (direction in ('inbound', 'outbound', 'unknown')),
  external_number text not null,
  normalised_external_number text,
  started_at timestamptz not null,
  answered_at timestamptz,
  ended_at timestamptz not null,
  connected_talk_seconds integer not null default 0
    check (connected_talk_seconds >= 0),
  call_status text not null,
  transcript_status text not null default 'pending'
    check (transcript_status in (
      'pending', 'metadata_received', 'awaiting_transcript', 'complete',
      'failed', 'ignored_internal', 'ignored_unanswered'
    )),
  transcript text,
  summary text,
  action_items jsonb not null default '[]'::jsonb,
  zoho_contact_id text,
  zoho_account_id text,
  zoho_call_id text,
  matched_customer_name text,
  matched_contact_name text,
  recording_reference text,
  segment_attribution_available boolean not null default false,
  processing_attempts integer not null default 0
    check (processing_attempts >= 0),
  next_processing_at timestamptz,
  last_processing_error text,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index yeastar_calls_call_id_unique
  on public.yeastar_calls (yeastar_call_id)
  where yeastar_call_id is not null;
create unique index yeastar_calls_cdr_id_unique
  on public.yeastar_calls (yeastar_cdr_id)
  where yeastar_cdr_id is not null;
create index yeastar_calls_started_at_idx
  on public.yeastar_calls (started_at desc);
create index yeastar_calls_processing_idx
  on public.yeastar_calls (transcript_status, next_processing_at)
  where transcript_status in ('pending', 'metadata_received', 'awaiting_transcript');
create index yeastar_calls_phone_idx
  on public.yeastar_calls (normalised_external_number);

create table public.yeastar_call_segments (
  id uuid primary key default gen_random_uuid(),
  yeastar_call_id uuid not null
    references public.yeastar_calls(id) on delete cascade,
  yeastar_segment_id text not null,
  command_centre_staff_id uuid
    references public.staff_profiles(id) on delete set null,
  yeastar_extension text not null,
  yeastar_user_id text,
  connected_at timestamptz,
  disconnected_at timestamptz,
  external_talk_seconds integer not null default 0
    check (external_talk_seconds >= 0),
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint yeastar_call_segments_unique
    unique (yeastar_call_id, yeastar_segment_id)
);

create index yeastar_call_segments_staff_connected_idx
  on public.yeastar_call_segments
  (command_centre_staff_id, connected_at desc)
  where command_centre_staff_id is not null;

create table public.yeastar_staff_mappings (
  id uuid primary key default gen_random_uuid(),
  command_centre_staff_id uuid not null
    references public.staff_profiles(id) on delete cascade,
  yeastar_user_id text,
  yeastar_extension text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint yeastar_staff_mappings_staff_unique
    unique (command_centre_staff_id),
  constraint yeastar_staff_mappings_extension_unique
    unique (yeastar_extension)
);

create unique index yeastar_staff_mappings_user_unique
  on public.yeastar_staff_mappings (yeastar_user_id)
  where yeastar_user_id is not null;

create table public.phone_customer_mappings (
  id uuid primary key default gen_random_uuid(),
  normalised_phone_number text not null unique,
  zoho_contact_id text,
  zoho_account_id text,
  customer_name text,
  contact_name text,
  contact_crm_url text,
  account_crm_url text,
  manually_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.yeastar_ingestion_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  yeastar_call_id text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);

create index yeastar_ingestion_events_pending_idx
  on public.yeastar_ingestion_events (received_at)
  where processed_at is null;

create table public.yeastar_sync_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create table public.yeastar_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_type text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  discovered_count integer not null default 0,
  processed_count integer not null default 0,
  ignored_count integer not null default 0,
  failed_count integer not null default 0,
  safe_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index yeastar_job_runs_type_started_idx
  on public.yeastar_job_runs (job_type, started_at desc);

create table public.yeastar_api_tokens (
  singleton_key text primary key default 'yeastar'
    check (singleton_key = 'yeastar'),
  access_token text,
  refresh_token text,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.zoho_crm_api_tokens (
  singleton_key text primary key default 'zoho-crm'
    check (singleton_key = 'zoho-crm'),
  access_token text,
  api_domain text,
  access_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.call_reporting_settings (
  singleton_key text primary key default 'call-reporting'
    check (singleton_key = 'call-reporting'),
  crm_matching_enabled boolean not null default true,
  transcript_retention_days integer not null default 365
    check (transcript_retention_days between 30 and 3650),
  updated_at timestamptz not null default now()
);

insert into public.call_reporting_settings (singleton_key)
values ('call-reporting')
on conflict (singleton_key) do nothing;

alter table public.yeastar_calls enable row level security;
alter table public.yeastar_call_segments enable row level security;
alter table public.yeastar_staff_mappings enable row level security;
alter table public.phone_customer_mappings enable row level security;
alter table public.yeastar_ingestion_events enable row level security;
alter table public.yeastar_sync_state enable row level security;
alter table public.yeastar_job_runs enable row level security;
alter table public.yeastar_api_tokens enable row level security;
alter table public.zoho_crm_api_tokens enable row level security;
alter table public.call_reporting_settings enable row level security;

revoke all on public.yeastar_calls from anon, authenticated;
revoke all on public.yeastar_call_segments from anon, authenticated;
revoke all on public.yeastar_staff_mappings from anon, authenticated;
revoke all on public.phone_customer_mappings from anon, authenticated;
revoke all on public.yeastar_ingestion_events from anon, authenticated;
revoke all on public.yeastar_sync_state from anon, authenticated;
revoke all on public.yeastar_job_runs from anon, authenticated;
revoke all on public.yeastar_api_tokens from anon, authenticated;
revoke all on public.zoho_crm_api_tokens from anon, authenticated;
revoke all on public.call_reporting_settings from anon, authenticated;

grant select, insert, update, delete on public.yeastar_calls to service_role;
grant select, insert, update, delete on public.yeastar_call_segments to service_role;
grant select, insert, update, delete on public.yeastar_staff_mappings to service_role;
grant select, insert, update, delete on public.phone_customer_mappings to service_role;
grant select, insert, update, delete on public.yeastar_ingestion_events to service_role;
grant select, insert, update, delete on public.yeastar_sync_state to service_role;
grant select, insert, update, delete on public.yeastar_job_runs to service_role;
grant select, insert, update, delete on public.yeastar_api_tokens to service_role;
grant select, insert, update, delete on public.zoho_crm_api_tokens to service_role;
grant select, insert, update, delete on public.call_reporting_settings to service_role;
