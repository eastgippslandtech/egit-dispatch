create table public.dispatch_link_crew (
  id uuid primary key default gen_random_uuid(),
  dispatch_link_id uuid not null references public.dispatch_links(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete cascade,
  outlook_event_id text,
  outlook_calendar_email text not null,
  last_sync_status public.dispatch_sync_status not null default 'needs_review',
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dispatch_link_crew_link_technician_unique
    unique (dispatch_link_id, technician_id),
  constraint dispatch_link_crew_outlook_event_unique unique (outlook_event_id)
);

create index dispatch_link_crew_technician_idx
  on public.dispatch_link_crew (technician_id, dispatch_link_id);

alter table public.dispatch_link_crew enable row level security;

revoke all on public.dispatch_link_crew from anon, authenticated;
grant select, insert, update, delete on public.dispatch_link_crew to service_role;
