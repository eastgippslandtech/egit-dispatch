create table public.integration_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_id text not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued'
    check (state in ('queued','syncing','retrying','synced','review_required','cancelled')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  synced_at timestamptz,
  cancelled_at timestamptz
);

create table public.integration_operation_steps (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null
    references public.integration_operations(id) on delete cascade,
  step_key text not null,
  step_order integer not null check (step_order >= 0),
  connector text not null
    check (connector in ('command_centre','msp_central','outlook','zoho_crm','msp_endpoint','zoho_survey','push','email')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued'
    check (state in ('queued','processing','retrying','succeeded','review_required','cancelled')),
  attempt_count integer not null default 0
    check (attempt_count >= 0),
  next_attempt_at timestamptz,
  lease_token uuid,
  leased_at timestamptz,
  lease_expires_at timestamptz,
  last_error text,
  result jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_id, step_key)
);

create table public.integration_audit_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references public.integration_operations(id) on delete set null,
  request_id text not null,
  event_type text not null,
  actor text,
  connector text
    check (connector is null or connector in ('command_centre','msp_central','outlook','zoho_crm','msp_endpoint','zoho_survey','push','email')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.integration_connector_health (
  connector text primary key
    check (connector in ('command_centre','msp_central','outlook','zoho_crm','msp_endpoint','zoho_survey','push','email')),
  status text not null default 'unknown',
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  consecutive_failures integer not null default 0
    check (consecutive_failures >= 0),
  last_error text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index integration_operation_steps_due_idx
  on public.integration_operation_steps (next_attempt_at, created_at)
  where state in ('queued','retrying');

create index integration_audit_events_request_idx
  on public.integration_audit_events (request_id, created_at desc);

create index integration_operations_failed_idx
  on public.integration_operations (updated_at desc)
  where state in ('retrying','review_required');

create index integration_connector_health_freshness_idx
  on public.integration_connector_health (last_checked_at desc)
  where last_checked_at is not null;

alter table public.integration_operations enable row level security;
alter table public.integration_operation_steps enable row level security;
alter table public.integration_audit_events enable row level security;
alter table public.integration_connector_health enable row level security;

revoke all on public.integration_operations from anon, authenticated;
revoke all on public.integration_operation_steps from anon, authenticated;
revoke all on public.integration_audit_events from anon, authenticated;
revoke all on public.integration_connector_health from anon, authenticated;

grant select, insert, update, delete
  on public.integration_operations to service_role;
grant select, insert, update, delete
  on public.integration_operation_steps to service_role;
grant select, insert, update, delete
  on public.integration_audit_events to service_role;
grant select, insert, update, delete
  on public.integration_connector_health to service_role;
