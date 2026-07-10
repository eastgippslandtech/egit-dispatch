alter table public.staff_profiles
  add column dispatch_enabled boolean not null default true;

create index staff_profiles_dispatch_enabled_idx
  on public.staff_profiles (dispatch_enabled)
  where dispatch_enabled = true;
