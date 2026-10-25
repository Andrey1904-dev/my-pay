// Minimal SDK adapter over the same REST fake used by the bot tests.
import { createFakeBackend } from './fake-backend.mjs';
export function createFakeSupabase({ userId = 'user-a', tables = {}, failWrites = false } = {}) {
  const backend = createFakeBackend({ tables });
  const user = { id: userId, email: `${userId}@example.test`, user_metadata: {} };
  const control = { failWrites, beforeRequest: null, listener: null };
  const sdk = {
    auth: {
      async getSession() { return { data: { session: { user } } }; },
      onAuthStateChange(fn) { control.listener = fn; },
      async signOut() { control.listener?.('SIGNED_OUT', null); return { error: null }; }
    },
    from(table) {
      let method = 'GET', body, single = false;
      const query = new URLSearchParams();
      const chain = {
        select(columns = '*') { query.set('select', columns); return chain; },
        eq(k, v) { query.set(k, `eq.${v}`); return chain; },
        order(k, { ascending = true } = {}) { query.set('order', `${k}.${ascending ? 'asc' : 'desc'}`); return chain; },
        maybeSingle() { single = true; return chain; },
        single() { single = true; return chain; },
        upsert(value, { onConflict } = {}) { method = 'POST'; body = value; if (onConflict) query.set('on_conflict', onConflict); return chain; },
        insert(value) { method = 'POST'; body = value; return chain; },
        update(value) { method = 'PATCH'; body = value; return chain; },
        delete() { method = 'DELETE'; return chain; },
        async then(resolve, reject) {
          try {
            await control.beforeRequest?.({ table, method, body });
            if (control.failWrites && method !== 'GET') return resolve({ data: null, error: { message: 'Failed to fetch' } });
            const response = await backend.fetch(`https://fake.test/rest/v1/${table}?${query}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
            const data = await response.json();
            return resolve({ data: single ? data[0] ?? null : data, error: response.ok ? null : data });
          } catch (e) { return reject(e); }
        }
      };
      return chain;
    }
  };
  return { ...backend, sdk, user, control };
}
