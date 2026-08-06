create table if not exists public.msp_oauth_access_tokens (
  cache_key text primary key,
  access_token text,
  expires_at timestamptz,
  refresh_blocked_until timestamptz,
  refresh_lease_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint msp_oauth_access_token_pair check (
    (access_token is null and expires_at is null)
    or (access_token is not null and expires_at is not null)
  )
);

comment on table public.msp_oauth_access_tokens is
  'Server-only cache coordinating short-lived MSP Central OAuth access tokens across Vercel instances.';

alter table public.msp_oauth_access_tokens enable row level security;

revoke all on table public.msp_oauth_access_tokens from anon, authenticated;
