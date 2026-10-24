import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const a = '11111111-1111-1111-1111-111111111111';
const b = '22222222-2222-2222-2222-222222222222';

test('PostgreSQL schemas: RLS, Telegram code RPC, and complete account deletion', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon;
      grant execute on function auth.uid() to authenticated, anon;
      insert into auth.users values ('${a}'), ('${b}');
    `);
    // PGlite includes core gen_random_uuid; pgcrypto is not installed in WASM.
    for (const file of ['SUPABASE_SCHEMA.sql','SUPABASE_ULTRA.sql','TELEGRAM_SUPABASE.sql','SUPABASE_ACCOUNT.sql']) {
      await db.exec(read(file).replace('create extension if not exists pgcrypto;', ''));
    }
    // Reapplying the published setup must remain safe.
    await db.exec(read('TELEGRAM_SUPABASE.sql'));
    await db.exec(`insert into public.settings(user_id) values ('${a}'), ('${b}');
      insert into public.shifts(user_id,work_date) values ('${a}','2026-10-24'),('${b}','2026-10-24');
      insert into public.user_app_data(user_id) values ('${a}'), ('${b}');
      insert into public.telegram_bot_events(user_id,direction,message) values ('${a}','in','test'),('${b}','in','other');
      set role authenticated; set request.jwt.claim.sub = '${a}';`);
    const rows = await db.query('select user_id from public.settings');
    assert.deepEqual(rows.rows.map(r=>r.user_id), [a]);
    await assert.rejects(db.exec(`insert into public.shifts(user_id,work_date) values ('${b}','2026-10-25')`), /row-level security/);
    const code = await db.query('select public.create_telegram_link_code() as code');
    assert.match(code.rows[0].code, /^[A-F0-9]{12}$/);
    await db.query('select public.create_telegram_link_code()');
    assert.equal((await db.query('select * from public.telegram_link_codes')).rows.length, 1);
    await db.exec(`set request.jwt.claim.sub = '${b}'`);
    await db.query('select public.create_telegram_link_code()');
    await db.exec(`set request.jwt.claim.sub = '${a}'; select public.delete_own_account(); reset role;`);
    assert.deepEqual((await db.query('select id from auth.users')).rows.map(r=>r.id), [b]);
    for (const table of ['settings','shifts','user_app_data','telegram_bot_events','telegram_link_codes']) {
      assert.equal((await db.query(`select * from public.${table} where user_id = '${a}'`)).rows.length, 0, table);
      assert.equal((await db.query(`select * from public.${table} where user_id = '${b}'`)).rows.length, 1, `preserve ${table}`);
    }
    await db.exec('set role anon');
    await assert.rejects(db.query('select public.create_telegram_link_code()'), /permission denied/);
    await assert.rejects(db.query('select public.delete_own_account()'), /permission denied/);
  } finally { await db.close(); }
});
