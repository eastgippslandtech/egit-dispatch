create table if not exists public.mobile_dispatch_claims (
  request_id text primary key,
  staff_id uuid not null references public.staff_profiles(id) on delete cascade,
  idempotency_key text not null,
  created_at timestamptz not null default now()
);

comment on table public.mobile_dispatch_claims is
  'Atomic reservations used by technician-mobile claims of unassigned MSP Central requests.';

alter table public.mobile_dispatch_claims enable row level security;
revoke all on table public.mobile_dispatch_claims from anon, authenticated;
grant select, insert, update, delete on table public.mobile_dispatch_claims to service_role;
