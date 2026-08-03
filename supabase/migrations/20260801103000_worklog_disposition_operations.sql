create table if not exists public.worklog_disposition_operations (
  idempotency_key text primary key,
  request_id text not null,
  disposition text,
  command_payload jsonb not null,
  state text not null default 'pending'
    check (state in ('pending', 'worklog_saved', 'completed', 'recovery_required')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  worklog_saved_at timestamptz,
  completed_at timestamptz,
  execution_owner text
    check (execution_owner is null or execution_owner in ('legacy', 'generic')),
  migrated_operation_id uuid unique,
  migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worklog_disposition_value_check check (
    disposition is null
    or disposition in (
      'complete',
      'return_to_queue',
      'book_forward',
      'transfer_escalate'
    )
  )
);

create index if not exists worklog_disposition_recovery_idx
  on public.worklog_disposition_operations (state, updated_at)
  where state in ('pending', 'worklog_saved', 'recovery_required');

create index if not exists worklog_disposition_request_idx
  on public.worklog_disposition_operations (request_id, created_at desc);

alter table public.worklog_disposition_operations enable row level security;

revoke all on public.worklog_disposition_operations from anon, authenticated;
grant select, insert, update, delete
  on public.worklog_disposition_operations to service_role;

comment on table public.worklog_disposition_operations is
  'Durable idempotency and recovery state for Work Log plus ticket outcome writeback.';
