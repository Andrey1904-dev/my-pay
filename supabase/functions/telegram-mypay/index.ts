// Точка входа Edge Function (Deno). Деплой:
//   supabase functions deploy telegram-mypay --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET (SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам).
import { createBotHandler } from "./bot.ts";

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response> | Response): void };

Deno.serve(createBotHandler({
  env: (key) => Deno.env.get(key),
  fetch: (input, init) => fetch(input, init),
}));
