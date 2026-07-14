create table if not exists public.dispatch_test_schedule_events (
  id text primary key,
  event_type text not null,
  request_id text,
  appointment_id text,
  technician_id text,
  date_key text,
  start_time text,
  end_time text,
  booking_type text,
  priority text,
  notes text,
  payload jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists dispatch_test_schedule_events_created_at_idx
  on public.dispatch_test_schedule_events (created_at);

alter table public.dispatch_test_schedule_events enable row level security;
