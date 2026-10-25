// Temporary, service-key-only production verification. Deploy explicitly, invoke
// once, then DELETE this Edge Function. Never scheduled. No real chat is used.
import { createBotHandler } from "../telegram-mypay/bot.ts";
import { createRemindersHandler } from "../telegram-reminders/reminders.ts";
import { dateKeyInTz, Db, money } from "../_shared/mypay.ts";
import { selectJoke } from "../_shared/telegram-jokes.ts";

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Promise<Response>): void };

Deno.serve(async req => {
  const env = (key: string) => Deno.env.get(key);
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY")!;
  const url = env("SUPABASE_URL")!;
  const authorization = req.headers.get("authorization") || "";
  if (req.method !== "POST" || !authorization.startsWith("Bearer ")) return Response.json({ ok: false }, { status: 401 });
  // A rotated service key and the runtime-injected key need not be byte-identical.
  // Validate the caller with PostgREST against a private, service-only table.
  // limit=0 returns no account data. anon/authenticated have no SELECT grant.
  const access = await fetch(`${url}/rest/v1/telegram_processed_updates?select=update_id&limit=0`, {
    headers: { apikey: authorization.slice(7), authorization },
  });
  if (!access.ok) return Response.json({ ok: false }, { status: 401 });
  const db = new Db(url, serviceKey, fetch);
  let userId: string | undefined;
  const checks: string[] = [];
  const assert = (condition: unknown, label: string) => { if (!condition) throw new Error(label); checks.push(label); };
  const admin = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`${url}/auth/v1/admin/${path}`, { method, headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!res.ok) throw new Error(`Test account admin operation: ${res.status}`);
    return res.status === 204 ? null : res.json();
  };
  let error: string | undefined;
  let cleaned = false;
  try {
    const password = crypto.randomUUID();
    const created = await admin("users", "POST", { email: `mypay-smoke-${crypto.randomUUID()}@example.invalid`, password, email_confirm: true });
    userId = created.id;
    // Telegram chat IDs have at most 52 significant bits. This safe JS integer
    // exceeds that range and cannot address a real Telegram user or group.
    const chatId = 8_000_000_000_000_000 + Math.floor(Math.random() * 1_000_000);
    await db.insert("settings", { user_id: userId, base_pay: 2415, holiday_pay: 4600, case_price: 7, piece_percent: 25, schedule_start: dateKeyInTz(new Date()) });
    await db.insert("telegram_links", { user_id: userId, chat_id: chatId });
    const messages: { text: string; reply_markup?: { remove_keyboard?: boolean } }[] = [];
    const interceptedFetch: typeof fetch = async (input, init) => {
      const target = new URL(String(input));
      if (target.hostname === "api.telegram.org") {
        const payload = JSON.parse(String(init?.body));
        if (target.pathname.endsWith("/sendMessage")) messages.push(payload);
        return Response.json({ ok: true, result: { message_id: 1 } });
      }
      // Reminder scan is restricted to this test account before any DB access.
      if (target.pathname === "/rest/v1/telegram_preferences") {
        target.searchParams.set("user_id", `eq.${userId}`);
        return fetch(target, init);
      }
      return fetch(input, init);
    };
    const now = new Date();
    const date = dateKeyInTz(now);
    const bot = createBotHandler({ env, fetch: interceptedFetch, now: () => now, logError: () => {} });
    const makeUpdate = (text: string) => ({ update_id: -1, message: { message_id: 1, text, from: { id: chatId, is_bot: false }, chat: { id: chatId, type: "private" } } });
    // Unique IDs outside Telegram's signed 32-bit update ID range, but valid bigint.
    // They cannot collide with actual Telegram updates.
    let updateId = 4_000_000_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const post = (update: unknown) => new Request(`${url}/functions/v1/telegram-mypay`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": env("TELEGRAM_WEBHOOK_SECRET")! }, body: JSON.stringify(update) });
    const send = async (text: string) => { const update = { ...makeUpdate(text), update_id: updateId++ }; await bot(post(update)); return update; };
    const row = () => db.one<{ cases: number; total_pay: number; updated_at: string }>("shifts", `user_id=eq.${userId}&work_date=eq.${date}&select=*`);
    await send("/start");
    assert(messages.at(-1)?.reply_markup?.remove_keyboard, "/start removes keyboard");
    await send("1200");
    assert((await row())?.total_pay === 4515, "create shift and calculate 4515 RUB");
    const replace = await send("500");
    assert((await row())?.cases === 500 && (await row())?.total_pay === 3290, "replace 1200 with 500 and calculate 3290 RUB");
    assert(messages.at(-1)?.text.includes(selectJoke(500)), "threshold joke matches");
    assert(!messages.at(-1)?.text.includes("Упаковано:"), "no quantity line");
    const savedVersion = (await row())?.updated_at;
    await send("500");
    assert((await row())?.updated_at === savedVersion && messages.at(-1)?.text.includes("Данные уже актуальны"), "same total does not update shift");
    await send("1250");
    await bot(post(replace));
    assert((await row())?.cases === 1250, "delayed duplicate cannot revert newer total");
    // Invoke the real deployed webhook with the impossible test chat ID.
    // Its attempted reply is rejected by Telegram, never delivered to a person.
    const live = { ...makeUpdate("525"), update_id: updateId++ };
    const response = await fetch(post(live));
    assert(response.ok && (await row())?.cases === 525 && (await row())?.total_pay === 3333.75, "deployed webhook writes test account correctly");
    // PWA reads via a real authenticated user's JWT, not the service role.
    const signed = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: serviceKey, "content-type": "application/json" }, body: JSON.stringify({ email: created.email, password }) });
    if (!signed.ok) throw new Error("Test account sign-in failed");
    const session = await signed.json();
    const pwaRead = await fetch(`${url}/rest/v1/shifts?user_id=eq.${userId}&select=*`, { headers: { apikey: serviceKey, authorization: `Bearer ${session.access_token}` } });
    const pwaRows = await pwaRead.json();
    assert(pwaRead.ok && pwaRows.length === 1 && pwaRows[0].cases === 525, "authenticated PWA read sees deployed Telegram total through RLS");
    const count = await db.select("shifts", `user_id=eq.${userId}&select=*`);
    assert(count.length === 1, "one shared Supabase row, no duplicate shifts");
    assert(messages.every(m => m.reply_markup?.remove_keyboard), "all captured replies remove keyboard without buttons");
    await db.insert("telegram_preferences", { user_id: userId, chat_id: chatId, enabled: true, reminder_hour: 21 });
    const reminder = createRemindersHandler({ env, fetch: interceptedFetch, now: () => new Date(`${date}T14:05:00Z`) });
    const remind = () => new Request(`${url}/functions/v1/telegram-reminders`, { method: "POST", headers: { authorization: `Bearer ${serviceKey}` } });
    const reminderResponse = await reminder(remind());
    const report = await reminderResponse.json();
    assert(report.checked === 1 && report.sent === 0, "saved shift suppresses entry reminder in isolated cron scan");
    assert(messages.some(m => m.text.includes(money(3290))), "actual calculated salary appears in reply");
  } catch (e) {
    error = e instanceof Error ? e.message : "Smoke test failed";
  } finally {
    if (userId) {
      try { await admin(`users/${userId}`, "DELETE"); cleaned = true; }
      catch { error = `${error || ""} Test account cleanup failed`; }
    }
  }
  return Response.json({ ok: !error && cleaned, checks, cleaned, ...(error ? { error } : {}) }, { status: error || !cleaned ? 500 : 200 });
});
