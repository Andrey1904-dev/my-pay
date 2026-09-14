-- CASE.PLACE SALARY ULTRA — дополнительное облачное хранилище.
-- Основные таблицы settings / shifts / profiles этот файл НЕ меняет.
-- Запусти целиком в Supabase -> SQL Editor, чтобы расходы, цели,
-- шаблоны и дополнительные данные смен синхронизировались между устройствами.

create table if not exists public.user_app_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_app_data enable row level security;

drop policy if exists "user_app_data_select_own" on public.user_app_data;
create policy "user_app_data_select_own"
on public.user_app_data for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "user_app_data_insert_own" on public.user_app_data;
create policy "user_app_data_insert_own"
on public.user_app_data for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "user_app_data_update_own" on public.user_app_data;
create policy "user_app_data_update_own"
on public.user_app_data for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, update on public.user_app_data to authenticated;
