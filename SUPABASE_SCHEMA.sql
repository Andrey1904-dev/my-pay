-- ============================================================
-- CASE.PLACE SALARY — базовая схема Supabase
-- Выполни целиком в Supabase → SQL Editor → Run.
-- Порядок: этот файл → SUPABASE_ULTRA.sql → TELEGRAM_SUPABASE.sql
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- settings ----------
-- Дефолты соответствуют текущей модели оплаты:
--   (1 900 ₽ выход + 200 ₽ обед) × 1,15 районный коэффициент Екатеринбурга = 2 415 ₽
--   сделка: 7 ₽ за чехол × 25% = 1,75 ₽ за чехол (без районного коэффициента)
create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  base_pay numeric not null default 2415,
  holiday_pay numeric not null default 4600,
  case_price numeric not null default 7,
  piece_percent numeric not null default 25,
  schedule_start date not null default current_date,
  monthly_goal numeric not null default 60000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- shifts ----------
create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  cases integer not null default 0 check (cases >= 0),
  is_holiday boolean not null default false,
  base_pay numeric not null default 2415,
  piece_pay numeric not null default 0,
  total_pay numeric not null default 2415,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, work_date)
);

-- Профиль и настройки создаются из браузера после signUp.
-- Email-подтверждение в Supabase должно быть отключено,
-- иначе signUp не вернёт session и вход не завершится.

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.shifts enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid()=id);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid()=id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid()=id) with check (auth.uid()=id);
create policy "profiles_delete_own" on public.profiles for delete using (auth.uid()=id);

drop policy if exists "settings_select_own" on public.settings;
drop policy if exists "settings_insert_own" on public.settings;
drop policy if exists "settings_update_own" on public.settings;
drop policy if exists "settings_delete_own" on public.settings;
create policy "settings_select_own" on public.settings for select using (auth.uid()=user_id);
create policy "settings_insert_own" on public.settings for insert with check (auth.uid()=user_id);
create policy "settings_update_own" on public.settings for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "settings_delete_own" on public.settings for delete using (auth.uid()=user_id);

drop policy if exists "shifts_select_own" on public.shifts;
drop policy if exists "shifts_insert_own" on public.shifts;
drop policy if exists "shifts_update_own" on public.shifts;
drop policy if exists "shifts_delete_own" on public.shifts;
create policy "shifts_select_own" on public.shifts for select using (auth.uid()=user_id);
create policy "shifts_insert_own" on public.shifts for insert with check (auth.uid()=user_id);
create policy "shifts_update_own" on public.shifts for update using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "shifts_delete_own" on public.shifts for delete using (auth.uid()=user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.settings, public.shifts to authenticated;

-- ---------- updated_at триггеры ----------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists settings_touch_updated_at on public.settings;
create trigger settings_touch_updated_at before update on public.settings
for each row execute function public.touch_updated_at();

drop trigger if exists shifts_touch_updated_at on public.shifts;
create trigger shifts_touch_updated_at before update on public.shifts
for each row execute function public.touch_updated_at();

-- ---------- Миграция легаси-настроек (2150 / 7 / 20 и 2627.84 / 1.69 / 100 → новая модель) ----------
-- Выполни один раз, если аккаунты создавались по старой схеме.
update public.settings
set base_pay = 2415, case_price = 7, piece_percent = 25,
    holiday_pay = case when holiday_pay = 4050 then 4600 else holiday_pay end
where (base_pay = 2150 and case_price = 7 and piece_percent = 20)
   or (base_pay = 2627.84 and case_price = 1.69 and piece_percent = 100)
   or (base_pay = 2415 and case_price = 8.05 and piece_percent = 25);

-- Актуальные дефолты также для уже созданной таблицы.
alter table public.settings alter column holiday_pay set default 4600;
alter table public.settings alter column case_price set default 7;

-- Исправление сохранённых смен только с точным старым стандартным тарифом.
-- Премия извлекается из старых компонентов и сохраняется; повторный запуск безопасен.
update public.shifts
set base_pay = case when is_holiday then 4600 else 2415 end,
    piece_pay = cases * 1.75,
    total_pay = (case when is_holiday then 4600 else 2415 end) + cases * 1.75
      + greatest(0, round(total_pay - base_pay - piece_pay, 2))
where base_pay = (case when is_holiday then 4050 else 2415 end)
  and cases >= 0 and abs(piece_pay - cases * 2.0125) <= 0.0051
  and total_pay - base_pay - piece_pay >= -0.011;
