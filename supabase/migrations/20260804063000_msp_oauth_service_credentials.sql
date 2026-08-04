create table if not exists public.msp_oauth_service_credentials (
  id text primary key,
  refresh_token text not null,
  api_domain text,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  constraint msp_oauth_service_credentials_singleton check (id = 'primary')
);

comment on table public.msp_oauth_service_credentials is
  'Server-only MSP Central OAuth service credential. Never exposed to browser or mobile clients.';

alter table public.msp_oauth_service_credentials enable row level security;

revoke all on table public.msp_oauth_service_credentials from anon, authenticated;
