// Restored from 8f339e0; calculations and payload layout are shared with the legacy PWA.
import { num, round2, Db, DbError, escapeHtml, money, dateKeyInTz } from "./mypay.ts";

// ---------- финансы (общий JSON с сайтом: user_app_data.payload) ----------

export interface TxRow {
  id: string;
  type: "expense" | "income" | "transfer";
  amount: number;
  category: string;
  accountId: string | null;
  toAccountId: string | null;
  date: string;
  note: string;
  source?: string;
}
export interface CategoryRow { id: string; name: string; emoji: string; limit: number }
export interface AccountRow { id: string; name: string; type: string; balance: number }
export interface ExtraPayload {
  transactions?: TxRow[];
  categories?: CategoryRow[];
  accounts?: AccountRow[];
  [key: string]: unknown;
}

export const DEFAULT_CATEGORIES: CategoryRow[] = [
  { id: "food", name: "Еда", emoji: "🍔", limit: 0 }, { id: "transport", name: "Транспорт", emoji: "🚌", limit: 0 }, { id: "home", name: "Жильё", emoji: "🏠", limit: 0 },
  { id: "shopping", name: "Покупки", emoji: "🛍️", limit: 0 }, { id: "health", name: "Здоровье", emoji: "💊", limit: 0 }, { id: "fun", name: "Развлечения", emoji: "🎮", limit: 0 },
  { id: "connect", name: "Связь", emoji: "📱", limit: 0 }, { id: "family", name: "Семья", emoji: "👨‍👩‍👧", limit: 0 }, { id: "other", name: "Другое", emoji: "📦", limit: 0 },
];

const CATEGORY_HINTS: [RegExp, string][] = [
  [/электричк|такси|автобус|метро|трамва|троллейбус|маршрутк|бензин|заправк|проезд|парковк|каршер|поезд|самокат|транспорт/, "Транспорт"],
  [/аренд|квартир|жкх|коммунал|ипотек|ремонт|свет|электрич|газ|вода|квартплат|жиль/, "Жильё"],
  [/аптек|лекарств|врач|стоматолог|зуб|больниц|клиник|таблетк|витамин|анализ|здоров/, "Здоровье"],
  [/кино|игр|бар|пиво|концерт|подписк|стим|steam|netflix|боулинг|клуб|развлеч|кальян|бильярд|театр/, "Развлечения"],
  [/связь|телефон|интернет|мтс|билайн|мегафон|теле2|tele2|сим|тариф|мобил/, "Связь"],
  [/сем[ья]|дет[иея]|ребен|ребён|жен[аеу]|муж|мам[аеу]|пап[аеу]|школ|садик|детск/, "Семья"],
  [/обед|еда|завтрак|ужин|кофе|кафе|столов|перекус|продукт|шаурм|пицц|бургер|доставк|ресторан|чай|хлеб|молок|пятероч|магнит|лент[аеу]|ашан|вкусвилл|перекрест|суши|шашлык|фастфуд|макдон|кфс|kfc|вода|сок|булоч|выпечк/, "Еда"],
  [/одежд|обув|магазин|покупк|озон|ozon|wildberries|вайлдберр|wb|подар|техник|мебел|косметик|маркетплейс|заказ/, "Покупки"],
];

/** Категория по тексту заметки: сначала точное имя категории, потом словарь подсказок. */
export function guessCategory(note: string, categories: CategoryRow[] = DEFAULT_CATEGORIES): CategoryRow {
  const lower = String(note || "").toLowerCase().replace(/ё/g, "е").trim();
  const byName = categories.find((c) => c.name.toLowerCase().replace(/ё/g, "е") === lower);
  if (byName) return byName;
  for (const [re, name] of CATEGORY_HINTS) {
    if (re.test(lower)) {
      const hit = categories.find((c) => c.name === name) || DEFAULT_CATEGORIES.find((c) => c.name === name);
      if (hit) return hit;
    }
  }
  return categories.find((c) => c.name === "Другое") || categories[categories.length - 1] || DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1];
}

export function payloadCategories(payload: ExtraPayload | null | undefined): CategoryRow[] {
  const list = Array.isArray(payload?.categories) ? payload!.categories!.filter((c) => c && typeof c.name === "string" && c.name) : [];
  return list.length ? list.map((c) => ({ id: String(c.id ?? c.name), name: c.name, emoji: c.emoji || "🏷️", limit: num(c.limit) })) : DEFAULT_CATEGORIES.map((c) => ({ ...c }));
}

export function payloadTransactions(payload: ExtraPayload | null | undefined): TxRow[] {
  return Array.isArray(payload?.transactions) ? payload!.transactions!.filter((t) => t && typeof t === "object" && t.id) : [];
}

export function payloadAccounts(payload: ExtraPayload | null | undefined): AccountRow[] {
  return Array.isArray(payload?.accounts) ? payload!.accounts!.filter((a) => a && a.id) : [];
}

/** Счёт для операции из бота: по имени в заметке, иначе наличные, иначе первый. */
export function pickAccount(accounts: AccountRow[], note: string): { account: AccountRow | null; note: string } {
  if (!accounts.length) return { account: null, note };
  const words = note.split(" ");
  const last = (words[words.length - 1] || "").toLowerCase().replace(/ё/g, "е");
  const named = last ? accounts.find((a) => a.name.toLowerCase().replace(/ё/g, "е").startsWith(last) && last.length >= 3) : undefined;
  if (named) return { account: named, note: words.slice(0, -1).join(" ") };
  return { account: accounts.find((a) => a.type === "cash") || accounts[0], note };
}

export function monthTransactions(payload: ExtraPayload | null | undefined, monthPrefix: string, type: TxRow["type"]): TxRow[] {
  return payloadTransactions(payload).filter((t) => t.type === type && typeof t.date === "string" && t.date.startsWith(monthPrefix));
}

export function sumAmount(rows: { amount: unknown }[]): number {
  return round2(rows.reduce((a, r) => a + Math.max(0, num(r.amount)), 0));
}



/** Explicit commands only: a bare number is always a daily case total. */
export async function manageFinance(
  db: Db, userId: string, kind: string, arg: string, updateId: number, now: Date,
): Promise<string | null> {
  const removing = kind === "delete_expense";
  const match = arg.match(/^((?:\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,]\d{1,2})?)\s+([^\n]{1,300})$/);
  const amount = match ? Number(match[1].replace(/[ \u00a0]/g, "").replace(",", ".")) : 0;
  if (removing ? !/^[a-zA-Z0-9_-]{1,100}$/.test(arg) : !match || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) {
    return removing ? "Укажи ID операции: /delete_expense ID. ID показаны в разделе «💸 Расходы»." : `Укажи сумму и описание: /${kind} 350 обед. Обычное число сохраняет выработку.`;
  }
  if (!Number.isSafeInteger(updateId) || updateId < 0) throw new Error("Invalid update id");
  const row = await db.one<{ payload: ExtraPayload; updated_at: string }>("user_app_data", `user_id=eq.${userId}&select=payload,updated_at`);
  const payload = row?.payload ?? {};
  const processed = Array.isArray(payload.telegramFinanceUpdates) ? payload.telegramFinanceUpdates.map(String) : [];
  const marker = String(updateId);
  const id = `tg_update_${marker}`;
  if (processed.includes(marker) || payloadTransactions(payload).some(t => t.id === id)) return null;
  const next: ExtraPayload = { ...payload, telegramFinanceUpdates: [...processed, marker] };
  // Keep the entire original array, including unrecognized legacy records.
  const all = Array.isArray(payload.transactions) ? payload.transactions : [];
  let reply: string;
  if (removing) {
    const target = payloadTransactions(payload).find(t => t.id === arg && (t.type === "expense" || t.type === "income"));
    if (!target) return "Операция не найдена в твоём аккаунте или уже удалена.";
    next.transactions = all.filter(t => t?.id !== arg);
    reply = `🗑 ${target.type === "expense" ? "Расход" : "Доход"} ${money(target.amount)} удалён.`;
  } else {
    const picked = pickAccount(payloadAccounts(payload), match![2]);
    const category = kind === "expense" ? guessCategory(picked.note, payloadCategories(payload)).name
      : /аванс/i.test(picked.note) ? "Аванс" : /зарплат|^зп$/i.test(picked.note) ? "Зарплата" : /подработк|халтур/i.test(picked.note) ? "Подработка" : /подар/i.test(picked.note) ? "Подарок" : "Другое";
    const tx: TxRow = { id, type: kind === "expense" ? "expense" : "income", amount: round2(amount), category,
      accountId: picked.account?.id ?? null, toAccountId: null, date: dateKeyInTz(now), note: picked.note, source: "telegram" };
    next.transactions = [...all, tx];
    reply = `${kind === "expense" ? "💸 Записал расход" : "💰 Записал доход"}: <b>${money(tx.amount)}</b> · ${escapeHtml(category)}${picked.account ? ` · ${escapeHtml(picked.account.name)}` : ""}\nID <code>${id}</code>\nУдалить: <code>/delete_expense ${id}</code>`;
  }
  // The change and update marker are one atomic JSON write. Replays, including
  // after deletion, cannot recreate a transaction. Never upsert a stale snapshot.
  const updatedAt = new Date(Math.max(now.getTime(), (Date.parse(row?.updated_at ?? "") || 0) + 1)).toISOString();
  const patch = { payload: next, updated_at: updatedAt };
  try {
    const result = row
      ? await db.update("user_app_data", `user_id=eq.${userId}&updated_at=eq.${encodeURIComponent(row.updated_at)}`, patch)
      : await db.insert("user_app_data", { user_id: userId, ...patch });
    if (result.length) return reply;
  } catch (error) {
    if (!(error instanceof DbError) || error.status !== 409) throw error;
  }
  const latest = await db.one<{ payload: ExtraPayload }>("user_app_data", `user_id=eq.${userId}&select=payload`);
  if (Array.isArray(latest?.payload?.telegramFinanceUpdates) && latest.payload.telegramFinanceUpdates.map(String).includes(marker)) return null;
  return "⚠️ Данные успели измениться на другом устройстве. Ничего не перезаписано. Открой расходы и повтори команду новым сообщением.";
}
