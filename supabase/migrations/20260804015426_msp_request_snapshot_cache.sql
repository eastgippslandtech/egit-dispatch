create table if not exists public.msp_request_snapshots (
  cache_key text primary key,
  requests jsonb not null default '[]'::jsonb,
  fetched_at timestamptz,
  retry_after timestamptz,
  refresh_lease_until timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.msp_request_snapshots is
  'Server-only cache for the last successful MSP Central request list.';

alter table public.msp_request_snapshots enable row level security;

revoke all on table public.msp_request_snapshots from anon, authenticated;
