import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftComparisonText } from '../supabase/functions/_shared/shift-comparison.ts';
import { createBotHandler } from '../supabase/functions/telegram-mypay/bot.ts';
import { MAIN_KEYBOARD, money } from '../supabase/functions/_shared/mypay.ts';
import { selectJoke } from '../supabase/functions/_shared/telegram-jokes.ts';
import { createFakeBackend, messageUpdate, telegramRequest } from './helpers/fake-backend.mjs';

const user='11111111-1111-1111-1111-111111111111';
const today='2026-10-25';
const now=new Date('2026-10-25T12:00:00Z');
const env={TELEGRAM_BOT_TOKEN:'123:ABC',TELEGRAM_WEBHOOK_SECRET:'s3cret',SUPABASE_URL:'https://fake.test',SUPABASE_SERVICE_ROLE_KEY:'service'};
const historical=(date,total,over={})=>({user_id:user,work_date:date,cases:500,is_holiday:false,base_pay:3000,piece_pay:1000,total_pay:total,updated_at:'2026-01-01T00:00:00Z',...over});
function setup(shifts=[],extra={}) {
  const backend=createFakeBackend({tables:{
    telegram_links:[{user_id:user,chat_id:111}],
    settings:[{user_id:user,base_pay:2415,holiday_pay:4600,case_price:7,piece_percent:25,schedule_start:'2026-10-20'}],
    shifts,...extra,
  }});
  const bot=createBotHandler({env:k=>env[k],fetch:backend.fetch,now:()=>now});
  const send=async text=>{const res=await bot(telegramRequest(messageUpdate(text)));assert.equal(res.status,200);return backend.lastText().replace(/\u00a0/g,' ');};
  return {backend,bot,send};
}

for(const [date,label] of [['2026-10-24','вчера'],['2026-10-20','несколько дней назад, через выходные'],['2026-09-30','прошлый месяц'],['2025-12-31','прошлый год']]) {
  test(`предыдущая смена ${label}: поиск не ограничен вчерашним днём/месяцем/годом`,async()=>{
    const {backend,send}=setup([historical(date,4000)]);
    const old=structuredClone(backend.db.shifts[0]);
    const text=await send('1000');
    assert.match(text,/📈 На 165 ₽ больше прошлой смены!/);
    assert.deepEqual(backend.db.shifts[0],old);
    const query=backend.restLog.find(x=>x.table==='shifts'&&x.search.includes('work_date=lt.'));
    const params=new URLSearchParams(query.search);
    assert.equal(params.get('user_id'),`eq.${user}`);
    assert.equal(params.get('work_date'),`lt.${today}`);
    assert.equal(params.get('order'),'work_date.desc');
    assert.equal(params.get('limit'),'1');
  });
}

for(const [pay,expected] of [[3000,'📈 На 1 165 ₽ больше прошлой смены!'],[5000,'📉 На 835 ₽ меньше прошлой смены!'],[4165,'🟰 Столько же, сколько в прошлую смену!']]) {
  test(`сравнение с ${pay}: корректные направление и сумма`,async()=>{
    const {backend,send}=setup([historical('2026-10-24',pay)]);
    const text=await send('1000');
    assert.ok(text.includes(expected),text);
    assert.equal(text.split('\n\n').length,4);
    assert.ok(text.endsWith(`😂 ${selectJoke(1000)}`));
    assert.doesNotMatch(text,/Упаковано:|На 0 ₽|меньше.*−|меньше.*-/);
    assert.equal(backend.sent().length,1);
    assert.deepEqual(backend.sent()[0].reply_markup,MAIN_KEYBOARD);
  });
}

test('первая смена: сравнения нет, ответ по-прежнему три блока',async()=>{
  const {send}=setup();const text=await send('1000');
  assert.doesNotMatch(text,/прошл[оую]/);assert.equal(text.split('\n\n').length,3);
});

test('обновление 1200→500 сравнивается с предыдущим днём работы, не с сегодняшними 1200',async()=>{
  const {backend,send}=setup([historical('2026-10-20',4000)]);
  assert.match(await send('1200'),/На 515 ₽ больше/);
  const updated=await send('500');
  assert.match(updated,/Информация обновлена!/);
  assert.match(updated,/На 710 ₽ меньше/);
  assert.equal(backend.db.shifts.find(s=>s.work_date===today).cases,500);
  assert.equal(backend.db.shifts.length,2);
  const unchanged=structuredClone(backend.db.shifts);
  assert.match(await send('500'),/Данные уже актуальны![\s\S]*На 710 ₽ меньше/);
  assert.deepEqual(backend.db.shifts,unchanged);
});

test('будущие смены, текущая запись, чужие строки и пустые дни плана исключены',async()=>{
  const future=historical('2026-10-26',99999);
  const other=historical('2026-10-24',88888,{user_id:'other'});
  const {backend,send}=setup([historical('2026-10-20',4000),future,other,historical(today,4515,{cases:1200,base_pay:2415,piece_pay:2100,piece_rate:1.75})],{
    user_app_data:[{user_id:user,payload:{workdayOverrides:{'2026-10-24':true}}}],
  });
  const text=await send('500');assert.match(text,/На 710 ₽ меньше/);
  assert.deepEqual(backend.db.shifts[1],future);assert.deepEqual(backend.db.shifts[2],other);
});

test('только будущая смена: не показывать сравнение',async()=>{
  const {send}=setup([historical('2026-10-26',99999)]);
  assert.doesNotMatch(await send('1000'),/прошл[оую]/);
});

test('выбирается ближайшая фактическая смена, даже если она в выходной по графику',async()=>{
  // schedule_start 20 Oct: 22/23 Oct are rest days. Saved 23rd still counts.
  const {send}=setup([historical('2026-10-20',4000),historical('2026-10-23',5000)]);
  assert.match(await send('1000'),/На 835 ₽ меньше/);
});

test('предыдущая праздничная смена использует сохранённую выплату',async()=>{
  const {send}=setup([historical('2026-10-24',6350,{is_holiday:true,base_pay:4600,piece_pay:1750,cases:1000})]);
  assert.match(await send('1000'),/На 2 185 ₽ меньше/);
});

test('текущая праздничная смена сохраняет тариф и сравнивается с прошлой фактической',async()=>{
  const {send}=setup([historical('2026-10-24',4165),historical(today,6350,{is_holiday:true,base_pay:4600,piece_pay:1750,piece_rate:1.75,cases:1000})]);
  assert.match(await send('1000'),/На 2 185 ₽ больше/);
});

for(const pay of [0,2415]) {
  test(`нулевая выработка предыдущей смены с оплатой ${pay} считается внесённой`,async()=>{
    const {send}=setup([historical('2026-10-20',4000),historical('2026-10-24',pay,{cases:0,base_pay:pay,piece_pay:0})]);
    const text=await send('1000');
    assert.ok(text.includes(`На ${money(4165-pay).replace(/\u00a0/g,' ')} больше`));
  });
}

test('исторический legacy-тариф берётся без correctLegacyShift и текущих настроек',async()=>{
  const {backend,send}=setup([historical('2026-10-24',4427.5,{base_pay:2415,piece_pay:2012.5,cases:1000})]);
  assert.match(await send('1000'),/На 262,50 ₽ меньше/);
  assert.equal(backend.db.shifts[0].total_pay,4427.5);
});

test('копейки и двоичная погрешность не дают ложных нулей/отрицательного знака',()=>{
  const clean=s=>s.replace(/\u00a0/g,' ');
  for(const [a,b,expected] of [[4165.1,4165.09,'📈 На 0,01 ₽ больше прошлой смены!'],[4165.09,4165.1,'📉 На 0,01 ₽ меньше прошлой смены!'],[0.1+0.2,0.3,'🟰 Столько же, сколько в прошлую смену!']]) assert.equal(clean(shiftComparisonText(a,b)),expected);
  assert.equal(shiftComparisonText(0,null),'');
  assert.equal(shiftComparisonText(Infinity,1),'');
});

test('после успешного сохранения ошибка чтения сравнения не превращается в ошибку сохранения',async()=>{
  const {backend}=setup([historical('2026-10-24',4000)]);const errors=[];
  const bot=createBotHandler({env:k=>env[k],now:()=>now,logError:(...args)=>errors.push(args),fetch:(url,init)=>new URL(String(url)).searchParams.get('work_date')?.startsWith('lt.')?Promise.resolve(new Response('error',{status:500})):backend.fetch(url,init)});
  await bot(telegramRequest(messageUpdate('1000')));
  assert.equal(backend.db.shifts.find(s=>s.work_date===today).total_pay,4165);
  assert.match(backend.lastText(),/Смена сохранена!/);
  assert.doesNotMatch(backend.lastText(),/Не получилось|прошл[оую]/);
  assert.equal(errors.length,1);assert.equal(backend.sent().length,1);
});
