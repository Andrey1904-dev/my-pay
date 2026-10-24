import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
function worker({ cacheKeys = [], fetchImpl = async () => { throw new Error('offline'); }, match = async () => undefined } = {}) {
  const handlers = {}, deleted = [], puts = [];
  const context = { URL, Response, Promise, fetch: fetchImpl,
    caches: { keys: async () => cacheKeys, delete: async key => { deleted.push(key); }, match, open: async () => ({ put: async (...args) => { puts.push(args); } }) },
    self: { location: { origin: 'https://example.test' }, skipWaiting() {}, clients: { claim: async () => {} }, addEventListener: (name, handler) => { handlers[name] = handler; } }
  };
  vm.runInNewContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
  return { handlers, deleted, puts };
}
test('activation removes only this app’s obsolete cache', async () => {
  const w = worker({ cacheKeys: ['my-pay-v1.01', 'my-pay-v1.02', 'another-app-v1'] });
  let done; w.handlers.activate({ waitUntil(p) { done = p; } }); await done;
  assert.deepEqual(w.deleted, ['my-pay-v1.01']);
});
test('offline app navigation returns its own shell and assets never receive HTML fallback', async () => {
  const w = worker({ match: async key => key === './app.html' ? new Response('<html>app</html>') : undefined });
  let response;
  w.handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://example.test/my-pay/app.html' }, respondWith(p) { response = p; }, waitUntil() {} });
  assert.match(await (await response).text(), /app/);
  w.handlers.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://example.test/my-pay/missing.css' }, respondWith(p) { response = p; }, waitUntil() {} });
  assert.equal((await response).type, 'error');
});
