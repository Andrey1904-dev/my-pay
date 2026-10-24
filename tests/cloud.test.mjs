import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, tick, key } from './helpers/load-app.mjs';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
const apps = [];
afterEach(() => { while (apps.length) apps.pop().close(); });
async function open(backend, opts = {}) {
  backend.control.listener = null;
  const app = loadApp({ ...opts, supabase: backend.sdk }); apps.push(app);
  for (let n = 0; n < 100; n++) {
    if (backend.control.listener) return app;
    await tick(5);
  }
  throw new Error('Auth did not initialize');
}
const plain = x => JSON.parse(JSON.stringify(x));
const storage = app => Object.fromEntries(Object.keys(app.window.localStorage).map(k => [k, app.window.localStorage.getItem(k)]));

test('offline save/delete/save coalesces to latest action and replays before cloud pull', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  backend.control.failWrites = true;
  app.input('casesInput', 100); await app.MyPay.saveHomeShift();
  await app.MyPay.deleteShift(key(), { confirmFirst: false });
  app.input('casesInput', 700); await app.MyPay.saveHomeShift();
  const shifts = app.MyPay.loadQueue().filter(op => op.type.endsWith('Shift'));
  assert.equal(shifts.length, 1); assert.equal(shifts[0].shift.cases, 700);
  backend.control.failWrites = false;
  app.window.dispatchEvent(new app.window.Event('online')); await tick(60);
  assert.equal(backend.db.shifts[0].cases, 700);
  assert.equal(app.MyPay.state.shifts[key()].cases, 700);
  assert.equal(app.MyPay.loadQueue().length, 0);
});

test('metadata snapshot survives a reload before sync', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  backend.control.failWrites = true;
  app.input('templateName', 'Шаблон'); app.input('templateCases', 350); await app.MyPay.saveTemplate(); await tick(10);
  const cached = storage(app);
  assert.equal(app.MyPay.loadQueue().find(op => op.type === 'saveExtra').extra.templates.length, 2);
  backend.control.failWrites = false;
  const restored = await open(backend, { storage: cached });
  assert.equal(restored.MyPay.state.extra.templates[1].cases, 350);
  assert.equal(backend.db.user_app_data[0].payload.templates[1].cases, 350);
});

test('pending writes retain local data when server remains unavailable after reload', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  backend.control.failWrites = true;
  app.input('templateName', 'Шаблон'); app.input('templateCases', 550); await app.MyPay.saveTemplate(); await tick(10);
  const restored = await open(backend, { storage: storage(app) });
  assert.equal(restored.MyPay.state.extra.templates[1].cases, 550);
  assert.ok(restored.MyPay.loadQueue().length);
  assert.ok(restored.$('authModal').classList.contains('hidden'));
});

test('another account never receives cached metadata or queued shifts', async () => {
  const a = createFakeSupabase(); const app = await open(a);
  a.control.failWrites = true;
  app.input('casesInput', 1000); await app.MyPay.saveHomeShift();
  app.input('templateName', 'Шаблон'); app.input('templateCases', 900); await app.MyPay.saveTemplate(); await tick(10);
  const b = createFakeSupabase({ userId: 'user-b' });
  const next = await open(b, { storage: storage(app) });
  assert.deepEqual(plain(next.MyPay.state.shifts), {});
  assert.equal(next.MyPay.state.extra.templates.length, 1);
  assert.equal(b.db.shifts.length, 0);
  assert.equal(b.db.user_app_data.length, 0);
});

test('offline settings are durable and restored to the same account', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  backend.control.failWrites = true;
  app.MyPay.openSettings(); app.input('settingBase', 3000); await app.MyPay.saveSettings();
  backend.control.failWrites = false;
  const next = await open(backend, { storage: storage(app) });
  assert.equal(next.MyPay.state.settings.basePay, 3000);
  assert.equal(backend.db.settings[0].base_pay, 3000);
});

test('editing a shift during an in-flight upload preserves the newer operation', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  let release; let started;
  const entered = new Promise(r => { started = r; });
  backend.control.beforeRequest = async ({ table, method }) => {
    if (table === 'shifts' && method === 'POST' && !release) {
      await new Promise(r => { release = r; started(); });
    }
  };
  app.input('casesInput', 100); const first = app.MyPay.saveHomeShift(); await entered;
  app.input('casesInput', 800); const second = app.MyPay.saveHomeShift();
  release(); await Promise.all([first, second]);
  assert.equal(backend.db.shifts[0].cases, 800);
  assert.equal(app.MyPay.loadQueue().length, 0);
});

test('legacy queue restores its metadata payload before pulling server state', async () => {
  const backend = createFakeSupabase();
  const app = await open(backend, { extra: { templates: [{ id: 'old', name: 'Старый', cases: 100 }] }, storage: { myPayCloudQueue: [{ type: 'saveExtra', queuedAt: 1 }] } });
  assert.equal(backend.db.user_app_data[0].payload.templates[0].id, 'old');
  assert.equal(app.MyPay.state.extra.templates.length, 1);
});

test('offline backup import queues all writes and preserves historical pay', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  backend.control.failWrites = true;
  const backup = app.MyPay.parseBackup(JSON.stringify({ settings: { basePay: 3000 }, shifts: { '2026-01-12': { cases: 1000, holiday: false, base: 2415, piece: 1750, total: 4465 } }, extra: {} }));
  await app.MyPay.restoreBackup(backup);
  assert.equal(app.MyPay.state.shifts['2026-01-12'].total, 4465);
  assert.ok(app.MyPay.loadQueue().some(op => op.type === 'saveShift'));
  backend.control.failWrites = false;
  const restored = await open(backend, { storage: storage(app) });
  assert.equal(restored.MyPay.state.shifts['2026-01-12'].total, 4465);
  assert.equal(restored.MyPay.state.extra.shiftMeta['2026-01-12'].bonus, 300);
});

test('offline reload without CDN SDK still queues edits for the cached account', async () => {
  const backend = createFakeSupabase(); const app = await open(backend);
  const offline = loadApp({ storage: storage(app), online: false }); apps.push(offline);
  offline.input('casesInput', 1200); await offline.MyPay.saveHomeShift();
  assert.equal(offline.MyPay.loadQueue().find(op => op.type === 'saveShift').userId, backend.user.id);
  offline.input('templateName', 'Без сети'); offline.input('templateCases', 500); await offline.MyPay.saveTemplate();
  const restored = await open(backend, { storage: storage(offline) });
  assert.equal(restored.MyPay.state.shifts[key()].cases, 1200);
  assert.ok(restored.MyPay.state.extra.templates.some(t => t.name === 'Без сети'));
});
