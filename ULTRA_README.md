# CASE.PLACE SALARY — ULTRA

Готовая сборка сайта и Telegram Edge Function.

1. Загрузи файлы сайта в GitHub Pages.
2. Выполни SQL по порядку:
   - `SUPABASE_SCHEMA.sql` — базовые таблицы и RLS (обязательно первым);
   - `SUPABASE_ULTRA.sql` — таблица `user_app_data` для расходов, целей и шаблонов;
   - `TELEGRAM_SUPABASE.sql` — таблицы и функция кодов для бота;
   - `supabase/push_notifications.sql` — опционально, для Web Push.
3. Опубликуй Edge Functions:
   - `supabase/functions/telegram-mypay` — сам бот (`supabase functions deploy telegram-mypay --no-verify-jwt`);
   - `supabase/functions/send-shift-reminders` — опционально, фоновые push-напоминания.
4. Настрой Secrets и webhook по `telegram_bot_setup.md`.
5. Прогони тесты: `npm i jsdom typescript && node tests/app.test.mjs`.
