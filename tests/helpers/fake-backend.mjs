// Мини-эмуляция PostgREST и Telegram Bot API для тестов Edge Functions.
// Поддерживает ровно то подмножество запросов, которое использует бот:
// фильтры eq/gt/gte/lte, order, limit, insert, upsert (on_conflict), patch, delete.

export function createFakeBackend({ tables = {}, telegramFail = false } = {}) {
  const db = {};
  for (const [name, rows] of Object.entries(tables)) db[name] = rows.map((r) => ({ ...r }));
  let nextId = 1000;
  const telegramCalls = [];
  const restLog = [];

  function table(name) {
    if (!db[name]) db[name] = [];
    return db[name];
  }

  function parseQuery(search) {
    const params = new URLSearchParams(search);
    const filters = [];
    let order = null, limit = Infinity, onConflict = null;
    for (const [key, value] of params) {
      if (key === "select") continue;
      if (key === "order") { const [col, dir] = value.split("."); order = { col, desc: dir === "desc" }; continue; }
      if (key === "limit") { limit = parseInt(value, 10); continue; }
      if (key === "on_conflict") { onConflict = value.split(","); continue; }
      const m = value.match(/^(eq|neq|gt|gte|lt|lte)\.(.*)$/s);
      if (!m) throw new Error(`fake-backend: unsupported filter ${key}=${value}`);
      filters.push({ col: key, op: m[1], value: m[2] });
    }
    return { filters, order, limit, onConflict };
  }

  function matches(row, filters) {
    return filters.every(({ col, op, value }) => {
      const a = row[col];
      const av = typeof a === "number" ? a : String(a ?? "");
      const bv = typeof a === "number" ? Number(value) : value;
      switch (op) {
        case "eq": return typeof a === "boolean" ? String(a) === value : av === bv;
        case "neq": return av !== bv;
        case "gt": return av > bv;
        case "gte": return av >= bv;
        case "lt": return av < bv;
        case "lte": return av <= bv;
        default: return false;
      }
    });
  }

  function respond(body, status = 200) {
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  function withDefaults(name, row) {
    const out = { ...row };
    if (out.id === undefined && !["telegram_pending_inputs", "telegram_links", "telegram_preferences", "telegram_link_codes", "settings"].includes(name)) out.id = String(nextId++);
    if (out.created_at === undefined) out.created_at = new Date(Date.now() + nextId).toISOString();
    return out;
  }

  async function handleRest(method, tableName, search, body) {
    const rows = table(tableName);
    const q = parseQuery(search);
    restLog.push({ method, table: tableName, search });
    if (method === "GET") {
      let out = rows.filter((r) => matches(r, q.filters));
      if (q.order) out = out.sort((a, b) => (a[q.order.col] < b[q.order.col] ? -1 : a[q.order.col] > b[q.order.col] ? 1 : 0) * (q.order.desc ? -1 : 1));
      return respond(out.slice(0, q.limit));
    }
    if (method === "POST") {
      const payload = Array.isArray(body) ? body : [body];
      const result = [];
      for (const item of payload) {
        if (q.onConflict) {
          const existing = rows.find((r) => q.onConflict.every((c) => String(r[c]) === String(item[c])));
          if (existing) { Object.assign(existing, item); result.push(existing); continue; }
        }
        if (tableName === "telegram_entries" && !(item.cases > 0)) return respond({ message: "check constraint cases > 0" }, 400);
        const row = withDefaults(tableName, item);
        rows.push(row);
        result.push(row);
      }
      return respond(result, 201);
    }
    if (method === "PATCH") {
      const out = rows.filter((r) => matches(r, q.filters));
      out.forEach((r) => Object.assign(r, body));
      return respond(out);
    }
    if (method === "DELETE") {
      const out = rows.filter((r) => matches(r, q.filters));
      db[tableName] = rows.filter((r) => !out.includes(r));
      return respond(out);
    }
    return respond({ message: "unsupported" }, 405);
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input));
    const method = (init.method || "GET").toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.hostname === "api.telegram.org") {
      const methodName = url.pathname.split("/").pop();
      telegramCalls.push({ method: methodName, payload: body });
      if (telegramFail) return respond({ ok: false, description: "boom" }, 500);
      return respond({ ok: true, result: { message_id: telegramCalls.length } });
    }
    const m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (!m) return respond({ message: "not found" }, 404);
    return handleRest(method, m[1], url.search, body);
  }

  return {
    db,
    fetch: fetchImpl,
    telegramCalls,
    restLog,
    sent(kind = "sendMessage") { return telegramCalls.filter((c) => c.method === kind).map((c) => c.payload); },
    lastText() { const c = telegramCalls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1); return c ? c.payload.text : ""; },
  };
}

export function telegramRequest(update, { secret = "s3cret", method = "POST" } = {}) {
  return new Request("https://example.functions.supabase.co/telegram-mypay", {
    method,
    headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret },
    body: method === "POST" ? JSON.stringify(update) : undefined,
  });
}

export function messageUpdate(text, { chatId = 111, userId = 5, username = "andrey", firstName = "Андрей", type = "private" } = {}) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    message: {
      message_id: Math.floor(Math.random() * 1e6),
      text,
      chat: { id: chatId, type },
      from: { id: userId, username, first_name: firstName },
    },
  };
}

export function callbackUpdate(data, { chatId = 111, messageId = 77 } = {}) {
  return {
    update_id: Math.floor(Math.random() * 1e9),
    callback_query: {
      id: "cb" + Math.floor(Math.random() * 1e6),
      data,
      from: { id: 5, username: "andrey", first_name: "Андрей" },
      message: { message_id: messageId, chat: { id: chatId, type: "private" } },
    },
  };
}
