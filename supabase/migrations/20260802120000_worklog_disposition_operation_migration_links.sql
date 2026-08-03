alter table public.worklog_disposition_operations
  add column if not exists execution_owner text,
  add column if not exists migrated_operation_id uuid,
  add column if not exists migrated_at timestamptz;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'worklog_disposition_execution_owner_check'
       and conrelid = 'public.worklog_disposition_operations'::regclass
  ) then
    alter table public.worklog_disposition_operations
      add constraint worklog_disposition_execution_owner_check
      check (execution_owner is null or execution_owner in ('legacy', 'generic'));
  end if;
end
$$;

create unique index if not exists worklog_disposition_migrated_operation_uidx
  on public.worklog_disposition_operations (migrated_operation_id)
  where migrated_operation_id is not null;
