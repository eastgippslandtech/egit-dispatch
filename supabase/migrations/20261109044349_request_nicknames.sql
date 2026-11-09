create table public.request_nicknames (
  request_id text primary key,
  nickname text not null check (char_length(trim(nickname)) between 1 and 80),
  updated_by_email text not null,
  updated_at timestamptz not null default now()
);

alter table public.request_nicknames enable row level security;
revoke all on public.request_nicknames from anon, authenticated;
grant select, insert, update, delete on public.request_nicknames to service_role;

comment on table public.request_nicknames is
  'Shared Command Centre ticket nicknames, independent of MSP Central subjects. Server-only.';
