// Точка входа Edge Function напоминаний (Deno). Деплой:
//   supabase functions deploy telegram-reminders --no-verify-jwt
// Запускается по расписанию раз в час (pg_cron + pg_net, см. telegram_bot_setup.md).
import { createRemindersHandler } from "./reminders.ts";

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response> | Response): void };

Deno.serve(createRemindersHandler({
  env: (key) => Deno.env.get(key),
  fetch: (input, init) => fetch(input, init),
}));
