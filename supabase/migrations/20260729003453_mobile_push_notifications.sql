create table if not exists public.mobile_push_devices (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null
    references public.staff_profiles(id) on delete cascade,
  installation_id text not null,
  platform text not null,
  push_token text not null,
  app_version text not null,
  active boolean not null default true,
  last_registered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobile_push_devices_installation_unique unique (installation_id),
  constraint mobile_push_devices_platform_check
    check (platform in ('ios', 'android', 'web'))
);

create index if not exists mobile_push_devices_staff_active_idx
  on public.mobile_push_devices (staff_profile_id, active);

create table if not exists public.dispatch_request_notification_state (
  request_id text primary key,
  request_number text not null,
  technician_id text,
  fingerprint text not null,
  snapshot jsonb not null,
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mobile_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  technician_id text not null,
  event_type text not null,
  event_key text not null,
  title text not null,
  body text not null,
  status text not null,
  provider_receipt_id text,
  created_at timestamptz not null default now(),
  constraint mobile_notification_deliveries_event_unique unique (event_key),
  constraint mobile_notification_deliveries_status_check
    check (status in ('sent', 'no_device', 'failed'))
);

create index if not exists mobile_notification_deliveries_request_idx
  on public.mobile_notification_deliveries (request_id, created_at desc);

alter table public.mobile_push_devices enable row level security;
alter table public.dispatch_request_notification_state enable row level security;
alter table public.mobile_notification_deliveries enable row level security;

revoke all on public.mobile_push_devices from anon, authenticated;
revoke all on public.dispatch_request_notification_state from anon, authenticated;
revoke all on public.mobile_notification_deliveries from anon, authenticated;

grant select, insert, update, delete on public.mobile_push_devices to service_role;
grant select, insert, update, delete
  on public.dispatch_request_notification_state to service_role;
grant select, insert, update, delete
  on public.mobile_notification_deliveries to service_role;
