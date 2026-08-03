do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'worklog_disposition_migrated_operation_fk'
       and conrelid = 'public.worklog_disposition_operations'::regclass
  ) then
    alter table public.worklog_disposition_operations
      add constraint worklog_disposition_migrated_operation_fk
      foreign key (migrated_operation_id) references public.integration_operations(id);
  end if;
end
$$;
