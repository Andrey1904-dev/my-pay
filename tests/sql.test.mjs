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
    await db.exec(read('supabase/updates/20261024_refresh_telegram_and_pay_defaults.sql'));
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
    assert.equal((await db.query("select column_default from information_schema.columns where table_schema='public' and table_name='settings' and column_name='base_pay'")).rows[0].column_default, '2415');
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

test('daily total SQL: service-only, atomic deduplication, compare-and-swap and reminder claims', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      insert into auth.users values ('${a}'),('${b}');`);
    for (const file of ['SUPABASE_SCHEMA.sql','TELEGRAM_SUPABASE.sql']) await db.exec(read(file).replace('create extension if not exists pgcrypto;',''));
    // Match production: updated_at exists but the baseline trigger is absent.
    await db.exec('drop trigger shifts_touch_updated_at on public.shifts');
    await db.exec(read('supabase/updates/20261025_telegram_daily_total.sql'));
    // Reapplication does not rewrite data.
    await db.exec(read('supabase/updates/20261025_telegram_daily_total.sql'));
    await db.exec(`insert into public.telegram_links(user_id,chat_id) values ('${a}',111),('${b}',222);`);
    const sh = { cases:1200,is_holiday:false,base_pay:2415,piece_pay:2100,total_pay:4515,piece_rate:1.75 };
    const rpc = async (id, expected, shift=sh, user=a, chat=111) => (await db.query(`select public.telegram_save_daily_total($1,$2,$3,'2026-10-25',$4,$5::jsonb) as result`,[id,chat,user,expected,JSON.stringify(shift)])).rows[0].result;
    await db.exec('set role service_role');
    const first = await rpc(1,null);
    assert.equal(first.status,'created');
    assert.equal(first.shift.cases,1200);
    const updated = await rpc(2,first.shift.updated_at,{...sh,cases:500,piece_pay:875,total_pay:3290});
    assert.equal(updated.status,'updated');
    assert.equal(updated.shift.cases,500);
    const unchanged = await rpc(3,updated.shift.updated_at,{...sh,cases:500});
    assert.equal(unchanged.status,'unchanged');
    assert.equal(unchanged.shift.updated_at,updated.shift.updated_at);
    assert.equal((await rpc(1,null)).status,'duplicate');
    assert.equal((await rpc(4,first.shift.updated_at)).status,'conflict');
    await assert.rejects(rpc(5,null,sh,b,111),/not linked/);
    await assert.rejects(rpc(6,null,{...sh,cases:-1}),/Invalid daily total/);
    await assert.rejects(rpc(7,null,{...sh,cases:20001}),/Invalid daily total/);
    const reminder = () => db.query(`select public.telegram_claim_reminder('${a}','2026-10-25','enter_cases') as claimed`);
    assert.equal((await reminder()).rows[0].claimed,true);
    assert.equal((await reminder()).rows[0].claimed,false);
    await db.exec('reset role');
    assert.equal((await db.query('select cases from public.shifts')).rows[0].cases,500);
    assert.equal((await db.query('select * from public.telegram_processed_updates where update_id in (5,6,7)')).rows.length,0,'errors roll back claims');
    for (const role of ['authenticated','anon']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(rpc(99,null),/permission denied/);
      await assert.rejects(reminder(),/permission denied/);
      await assert.rejects(db.query('select * from public.telegram_processed_updates'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec(`delete from auth.users where id='${a}'`);
    assert.equal((await db.query('select * from public.telegram_processed_updates')).rows.length,0);
    assert.equal((await db.query('select * from public.telegram_reminder_deliveries')).rows.length,0);
  } finally { await db.close(); }
});
