-- =====================================================================
-- CASE.PLACE SALARY — удаление аккаунта пользователем (App Store 5.1.1(v))
-- Выполни один раз в Supabase → SQL Editor.
-- Функция удаляет текущего пользователя из auth.users; все таблицы приложения
-- (profiles, settings, shifts, user_app_data, telegram_*) связаны с auth.users
-- через ON DELETE CASCADE, поэтому данные стираются вместе с аккаунтом.
-- =====================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Явно чистим прикладные таблицы (на случай, если где-то нет каскада).
  delete from public.telegram_bot_events     where user_id = uid; -- логи бота (без каскада — чистим вручную)
  delete from public.telegram_entries        where user_id = uid;
  delete from public.telegram_pending_inputs where user_id = uid;
  delete from public.telegram_preferences   where user_id = uid;
  delete from public.telegram_link_codes    where user_id = uid;
  delete from public.telegram_links         where user_id = uid;
  delete from public.user_app_data          where user_id = uid;
  delete from public.shifts                 where user_id = uid;
  delete from public.settings               where user_id = uid;
  delete from public.profiles               where id = uid;

  -- Сам аккаунт (сессии, identities и т.д. удаляются каскадом внутри auth).
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;

comment on function public.delete_own_account() is
  'Удаляет текущего пользователя и все его данные. Вызывается из приложения: supabase.rpc(''delete_own_account'').';
