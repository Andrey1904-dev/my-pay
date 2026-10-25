-- Additive only: no saved shifts, tariffs, secrets or cron jobs are changed.
begin;
-- Preserve the effective per-case rate even when a total is replaced with zero.
alter table public.shifts add column if not exists piece_rate numeric;
-- Production did not have the version trigger present in the baseline SQL.
-- A dedicated trigger avoids changing the shared profile/settings trigger function.
create or replace function public.bump_shift_version()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create or replace trigger shifts_version before update on public.shifts
for each row execute function public.bump_shift_version();

create table if not exists public.telegram_processed_updates (
  update_id bigint primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.telegram_processed_updates enable row level security;
revoke all on public.telegram_processed_updates from public, anon, authenticated;
grant all on public.telegram_processed_updates to service_role;

create table if not exists public.telegram_reminder_deliveries (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key(user_id, work_date, kind)
);
alter table public.telegram_reminder_deliveries enable row level security;
revoke all on public.telegram_reminder_deliveries from public, anon, authenticated;
grant all on public.telegram_reminder_deliveries to service_role;

create or replace function public.telegram_save_daily_total(
  p_update_id bigint, p_chat_id bigint, p_user_id uuid, p_date date,
  p_expected timestamptz, p_shift jsonb
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  previous public.shifts%rowtype;
  saved public.shifts%rowtype;
  existed boolean;
  claimed bigint;
  outcome text;
begin
  -- A service-only RPC also revalidates the chat/account binding in the transaction.
  perform 1 from public.telegram_links where chat_id = p_chat_id and user_id = p_user_id for share;
  if not found then raise exception 'Telegram account is not linked'; end if;
  if p_update_id < 0 or p_date is null or
     (p_shift->>'cases')::numeric not between 0 and 20000 or
     (p_shift->>'cases')::numeric <> trunc((p_shift->>'cases')::numeric) then
    raise exception 'Invalid daily total';
  end if;
  insert into public.telegram_processed_updates(update_id,user_id)
    values(p_update_id,p_user_id) on conflict do nothing returning update_id into claimed;
  if claimed is null then return jsonb_build_object('status','duplicate'); end if;
  -- Row lock coordinates concurrent bot calls and ordinary PWA UPDATE/DELETE.
  select * into previous from public.shifts where user_id=p_user_id and work_date=p_date for update;
  existed := found;
  if (existed and previous.updated_at is distinct from p_expected) or
     (not existed and p_expected is not null) then
    return jsonb_build_object('status','conflict');
  end if;
  if existed and previous.cases = (p_shift->>'cases')::integer then
    return jsonb_build_object('status','unchanged','shift',to_jsonb(previous));
  end if;
  if existed then
    update public.shifts set cases=(p_shift->>'cases')::integer,
      is_holiday=(p_shift->>'is_holiday')::boolean,
      base_pay=(p_shift->>'base_pay')::numeric, piece_pay=(p_shift->>'piece_pay')::numeric,
      piece_rate=(p_shift->>'piece_rate')::numeric,
      total_pay=(p_shift->>'total_pay')::numeric
      where user_id=p_user_id and work_date=p_date returning * into saved;
    outcome := 'updated';
  else
    insert into public.shifts(user_id,work_date,cases,is_holiday,base_pay,piece_pay,total_pay,piece_rate)
      values(p_user_id,p_date,(p_shift->>'cases')::integer,(p_shift->>'is_holiday')::boolean,
        (p_shift->>'base_pay')::numeric,(p_shift->>'piece_pay')::numeric,(p_shift->>'total_pay')::numeric,(p_shift->>'piece_rate')::numeric)
      on conflict(user_id,work_date) do nothing returning * into saved;
    if not found then return jsonb_build_object('status','conflict'); end if;
    outcome := 'created';
  end if;
  return jsonb_build_object('status',outcome,'shift',to_jsonb(saved));
end;
$$;
revoke all on function public.telegram_save_daily_total(bigint,bigint,uuid,date,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.telegram_save_daily_total(bigint,bigint,uuid,date,timestamptz,jsonb) to service_role;

create or replace function public.telegram_claim_reminder(p_user_id uuid,p_date date,p_kind text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.telegram_reminder_deliveries(user_id,work_date,kind)
    values(p_user_id,p_date,p_kind) on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.telegram_claim_reminder(uuid,date,text) from public,anon,authenticated;
grant execute on function public.telegram_claim_reminder(uuid,date,text) to service_role;
commit;
