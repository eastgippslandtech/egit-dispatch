alter table public.integration_connector_health
  add column if not exists last_read_at timestamptz,
  add column if not exists last_write_at timestamptz;

alter table public.integration_audit_events
  add column if not exists actor_email varchar(320)
    check (actor_email is null or actor_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  add column if not exists operator_action varchar(16)
    check (operator_action is null or operator_action in ('retry', 'cancel'));

create index if not exists integration_audit_events_operation_idx
  on public.integration_audit_events (operation_id, created_at desc)
  where operation_id is not null;
