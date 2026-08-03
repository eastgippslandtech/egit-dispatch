create table if not exists public.request_workflows (
  request_id text primary key,
  template_id text not null,
  template_version integer not null check (template_version > 0),
  template_name text not null,
  classification_source text not null check (
    classification_source in ('deterministic', 'manual', 'zia')
  ),
  classification_confidence numeric(5, 4) not null check (
    classification_confidence >= 0 and classification_confidence <= 1
  ),
  workflow jsonb not null,
  applied_by_email text not null,
  applied_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists request_workflows_template_idx
  on public.request_workflows (template_id, updated_at desc);

create table if not exists public.request_workflow_audit_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null references public.request_workflows(request_id) on delete cascade,
  action text not null check (action in ('template_applied', 'template_replaced', 'track_item_updated')),
  actor_email text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists request_workflow_audit_request_idx
  on public.request_workflow_audit_events (request_id, created_at desc);

alter table public.request_workflows enable row level security;
alter table public.request_workflow_audit_events enable row level security;

revoke all on public.request_workflows from anon, authenticated;
revoke all on public.request_workflow_audit_events from anon, authenticated;
grant select, insert, update, delete on public.request_workflows to service_role;
grant select, insert, update, delete on public.request_workflow_audit_events to service_role;

comment on table public.request_workflows is
  'Versioned Command Centre ticket-template and Track snapshots. Server-only.';
comment on table public.request_workflow_audit_events is
  'Audit trail for ticket template and Track changes. Server-only.';
