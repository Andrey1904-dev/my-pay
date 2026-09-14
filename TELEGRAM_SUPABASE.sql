-- CASE.PLACE SALARY Telegram integration
create table if not exists public.telegram_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint unique not null,
  username text,
  first_name text,
  linked_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.telegram_link_codes (
  code text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_bot_events (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  chat_id bigint,
  direction text not null check (direction in ('in','out')),
  message text,
  created_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_bot_events enable row level security;

drop policy if exists telegram_links_own on public.telegram_links;
create policy telegram_links_own on public.telegram_links for select to authenticated using (auth.uid()=user_id);

drop policy if exists telegram_codes_own on public.telegram_link_codes;
create policy telegram_codes_own on public.telegram_link_codes for select to authenticated using (auth.uid()=user_id);

grant select on public.telegram_links, public.telegram_link_codes to authenticated;

grant usage, select on sequence public.telegram_bot_events_id_seq to service_role;

create or replace function public.create_telegram_link_code()
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare c text;
begin
  delete from public.telegram_link_codes where user_id=auth.uid() or expires_at < now();
  c := upper(substr(encode(gen_random_bytes(6),'hex'),1,8));
  insert into public.telegram_link_codes(code,user_id,expires_at)
  values(c,auth.uid(),now()+interval '10 minutes');
  return c;
end;
$$;
grant execute on function public.create_telegram_link_code() to authenticated;

create table if not exists public.telegram_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint unique not null,
  enabled boolean not null default true,
  reminder_hour integer not null default 21,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.telegram_preferences enable row level security;
drop policy if exists telegram_preferences_own on public.telegram_preferences;
create policy telegram_preferences_own on public.telegram_preferences for select to authenticated using (auth.uid()=user_id);
grant select on public.telegram_preferences to authenticated;

-- Дополнительные функции Telegram: история, точечная отмена и подтверждение
create table if not exists public.telegram_entries (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  chat_id bigint not null,
  work_date date not null,
  cases integer not null check (cases > 0),
  created_at timestamptz not null default now()
);
create index if not exists telegram_entries_user_date_idx on public.telegram_entries(user_id, work_date, created_at desc);
alter table public.telegram_entries enable row level security;
drop policy if exists telegram_entries_own on public.telegram_entries;
create policy telegram_entries_own on public.telegram_entries for select to authenticated using (auth.uid()=user_id);
grant select on public.telegram_entries to authenticated;
grant usage, select on sequence public.telegram_entries_id_seq to service_role;

create table if not exists public.telegram_pending_inputs (
  chat_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  cases integer not null check (cases > 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.telegram_pending_inputs enable row level security;
grant all on public.telegram_entries, public.telegram_pending_inputs to service_role;
