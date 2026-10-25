import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadApp, tick } from './helpers/load-app.mjs';
import { createFakeSupabase } from './helpers/fake-supabase.mjs';
const now = '2026-10-26T07:00:00Z'; // Monday, 12:00 in Yekaterinburg.
const day = '2026-10-26';
function open(opts = {}) { return loadApp({ now, settings: { scheduleStart: day }, ...opts }); }
async function until(predicate) {
  for (let i=0; i<200; i++) { if (predicate()) return; await tick(5); }
  throw new Error('Expected state did not arrive');
}
const shift = { cases: 0, holiday: false, base: 2415, piece: 0, total: 2415 };
for (const [name, start, overrides, text] of [
  ['first scheduled day without an earnings entry', day, {}, 'Это твоя первая смена 😭'],
  ['second consecutive scheduled day', '2026-10-25', {}, 'Это твоя вторая смена 🥺'],
  ['third consecutive day', '2026-10-25', { '2026-10-24': true }, 'Это твоя третья смена 💀'],
  ['fourth consecutive day', '2026-10-25', { '2026-10-24': true, '2026-10-23': true, '2026-10-22': false }, 'Это твоя четвёртая смена 💀'],
  ['day off', '2026-10-24', {}, 'Сегодня отдыхаешь, заслуженный отдых 😴'],
]) {
  test(name, () => {
    const app=open({settings:{scheduleStart:start},extra:{workdayOverrides:overrides}});
    try { assert.equal(app.text('greetingMessage'),text); } finally {app.close();}
  });
}
test('2/2 cycle resets after days off and respects month/year boundaries', () => {
  const app=open({settings:{scheduleStart:'2026-12-31'}});
  try {
    const dates=['2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04','2027-01-05'];
    assert.deepEqual(dates.map(k=>app.MyPay.consecutiveWorkdays(app.MyPay.fromKey(k))),[1,2,0,0,1,2]);
  } finally {app.close();}
});
test('ordinals are words, including compound tens/hundreds/thousands', () => {
  const app=open();
  try {
    for (const [n, word] of [[5,'пятая'],[11,'одиннадцатая'],[20,'двадцатая'],[21,'двадцать первая'],[40,'сороковая'],[99,'девяносто девятая'],[100,'сотая'],[104,'сто четвёртая'],[200,'двухсотая'],[1000,'тысячная'],[2000,'двухтысячная'],[2021,'две тысячи двадцать первая']]) assert.equal(app.MyPay.ordinalFeminine(n),word);
    const overrides={}; const cursor=app.MyPay.fromKey(day);
    for(let i=0;i<21;i++){overrides[app.MyPay.dateKey(cursor)]=true;cursor.setDate(cursor.getDate()-1);}
    overrides[app.MyPay.dateKey(cursor)]=false;
    app.MyPay.state.extra.workdayOverrides=overrides;app.MyPay.renderAll();
    assert.equal(app.text('greetingMessage'),'Это твоя двадцать первая смена 💀');
  } finally {app.close();}
});
test('saved zero-case shifts count; off-day deletion removes only that factual day; undo restores it', async () => {
  const app=open({settings:{scheduleStart:'2026-10-24'},shifts:{[day]:shift}});
  try {
    assert.equal(app.text('greetingMessage'),'Это твоя третья смена 💀');
    await app.MyPay.deleteShift(day,{confirmFirst:false});
    assert.equal(app.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');
    await app.MyPay.undoLastDelete();assert.equal(app.text('greetingMessage'),'Это твоя третья смена 💀');
    app.MyPay.state.settings.scheduleStart=day;
    await app.MyPay.deleteShift(day,{confirmFirst:false});
    assert.equal(app.text('greetingMessage'),'Это твоя первая смена 😭','deleting earnings does not cancel a scheduled day');
  } finally {app.close();}
});
test('manual calendar overrides break/extend a run without changing earnings and survive reload', () => {
  const app=open({shifts:{[day]:shift}});
  try {
    const original=JSON.stringify(app.MyPay.state.shifts);
    app.MyPay.selectCalendarDate(day);app.input('calendarWorkday','off');
    assert.equal(app.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');
    assert.equal(JSON.stringify(app.MyPay.state.shifts),original);
    const reload=open({extra:JSON.parse(app.window.localStorage.myPayExtra),shifts:{[day]:shift}});
    try {assert.equal(reload.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');} finally {reload.close();}
    app.input('calendarWorkday','auto');assert.equal(app.text('greetingMessage'),'Это твоя первая смена 😭');
    app.MyPay.selectCalendarDate('2026-10-25');app.input('calendarWorkday','work');
    assert.equal(app.text('greetingMessage'),'Это твоя вторая смена 🥺');
    app.MyPay.selectCalendarDate('2026-10-25');app.input('calendarWorkday','off');
    assert.equal(app.text('greetingMessage'),'Это твоя первая смена 😭');
  } finally {app.close();}
});
test('adding/editing a manual shift refreshes greeting independent of case count', async () => {
  const app=open({settings:{scheduleStart:'2026-10-24'}});
  try {
    app.MyPay.openShiftModal(day);app.input('modalCases',0);await app.MyPay.saveModal();
    assert.equal(app.text('greetingMessage'),'Это твоя третья смена 💀');
    app.MyPay.openShiftModal(day);app.input('modalCases',900);await app.MyPay.saveModal();
    assert.equal(app.text('greetingMessage'),'Это твоя третья смена 💀');
  } finally {app.close();}
});
test('missing name, whitespace and email-like metadata use neutral greeting', async () => {
  const backend=createFakeSupabase();backend.user.user_metadata={name:'person@example.test'};
  const app=open({supabase:backend.sdk});
  try {await until(()=>backend.control.listener);assert.equal(app.text('greetingTitle'),'Привет ❤️');assert.equal(app.text('profileName'),'Мой расчёт');} finally {app.close();}
});
test('long name is plain text and changing name in settings updates immediately and persists locally', async () => {
  const app=open();
  try {
    const name='Александра-Мария <b>Оченьдлиннаяфамилия</b>';
    app.MyPay.openSettings();app.input('settingDisplayName',name);await app.MyPay.saveSettings();
    assert.equal(app.text('greetingTitle'),name+' ❤️');assert.equal(app.$('greetingTitle').querySelector('b'),null);
    assert.equal(JSON.parse(app.window.localStorage.myPayExtra).displayName,name);
    app.MyPay.openSettings();app.input('settingDisplayName','  Андрей   Сергеевич  ');await app.MyPay.saveSettings();
    assert.equal(app.text('greetingTitle'),'Андрей Сергеевич ❤️');
  } finally {app.close();}
});
test('profile has priority over auth metadata, explicit local display name has priority over both', async () => {
  const backend=createFakeSupabase({tables:{profiles:[{id:'user-a',name:'Профиль'}],user_app_data:[{user_id:'user-a',payload:{displayName:'Явное имя'}}]}});
  backend.user.user_metadata={full_name:'Метаданные'};
  const app=open({supabase:backend.sdk});
  try {
    await until(()=>backend.control.listener);assert.equal(app.text('greetingTitle'),'Явное имя ❤️');
    app.MyPay.openSettings();app.input('settingDisplayName','');await app.MyPay.saveSettings();assert.equal(app.text('greetingTitle'),'Профиль ❤️');
  } finally {app.close();}
});
test('metadata fallback uses available person name without falling back to email', async () => {
  const backend=createFakeSupabase();backend.user.user_metadata={given_name:'Ирина',family_name:'Петрова'};
  const app=open({supabase:backend.sdk});
  try {await until(()=>backend.control.listener);assert.equal(app.text('greetingTitle'),'Ирина Петрова ❤️');} finally {app.close();}
});
test('cloud restore does not flash cached wrong name or ordinal while loading', async () => {
  const backend=createFakeSupabase({tables:{settings:[{user_id:'user-a',schedule_start:'2026-10-25'}],user_app_data:[{user_id:'user-a',payload:{displayName:'Из облака',workdayOverrides:{'2026-10-24':true}}}]}});
  let release;const gate=new Promise(resolve=>release=resolve);backend.control.beforeRequest=()=>gate;
  const app=open({supabase:backend.sdk,extra:{displayName:'Устаревшее имя'}});
  try {
    await tick();assert.equal(app.text('greetingTitle'),'Привет ❤️');assert.equal(app.text('greetingMessage'),'');
    release();await until(()=>backend.control.listener);
    assert.equal(app.text('greetingTitle'),'Из облака ❤️');assert.equal(app.text('greetingMessage'),'Это твоя третья смена 💀');
    backend.db.user_app_data[0].payload.displayName='Обновлённое имя';
    backend.db.user_app_data[0].payload.workdayOverrides[day]=false;
    app.window.dispatchEvent(new app.window.Event('online'));
    await until(()=>app.text('greetingTitle')==='Обновлённое имя ❤️');
    assert.equal(app.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');
  } finally {release();app.close();}
});
test('name and overrides use durable extra queue and restore after reconnect', async () => {
  const backend=createFakeSupabase();const app=open({supabase:backend.sdk});
  try {
    await until(()=>backend.control.listener);backend.control.failWrites=true;
    app.MyPay.openSettings();app.input('settingDisplayName','Без сети');await app.MyPay.saveSettings();
    app.MyPay.selectCalendarDate(day);app.input('calendarWorkday','off');await tick();
    assert.equal(app.text('greetingTitle'),'Без сети ❤️');assert.equal(app.MyPay.loadQueue().find(x=>x.type==='saveExtra').extra.workdayOverrides[day],false);
    const storage=Object.fromEntries(Object.keys(app.window.localStorage).map(k=>[k,app.window.localStorage.getItem(k)]));
    backend.control.failWrites=false;const restored=open({supabase:backend.sdk,storage});
    try {
      await until(()=>restored.MyPay.loadQueue().length===0 && restored.text('greetingTitle')==='Без сети ❤️');
      assert.equal(restored.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');
      assert.equal(backend.db.user_app_data[0].payload.displayName,'Без сети');
    } finally {restored.close();}
  } finally {app.close();}
});
test('Yekaterinburg midnight updates even with an unsaved draft; foreground refresh handles suspended timers', () => {
  const app=open({now:'2026-10-26T18:59:59Z'});
  try {
    assert.equal(app.text('greetingMessage'),'Это твоя первая смена 😭');
    app.$('casesInput').value='123';app.$('casesInput').dispatchEvent(new app.window.Event('input'));
    let midnightCallback, delay;const original=app.window.setTimeout;
    app.window.setTimeout=(fn,ms)=>{midnightCallback=fn;delay=ms;return 0;};
    app.window.dispatchEvent(new app.window.Event('pageshow'));
    assert.ok(delay>=1000 && delay<=1100);
    app.window.__testNow='2026-10-26T19:00:00Z';midnightCallback();
    assert.equal(app.text('greetingMessage'),'Это твоя вторая смена 🥺');assert.match(app.text('todayLabel'),/27 октября/);
    assert.equal(app.MyPay.homeDirty,true);assert.equal(app.$('casesInput').value,'123');
    app.window.__testNow='2026-10-27T19:01:00Z';app.document.dispatchEvent(new app.window.Event('visibilitychange'));
    assert.equal(app.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');
    app.window.setTimeout=original;
  } finally {app.close();}
});
test('JSON restore updates greeting and preserves name/override fields', async () => {
  const app=open();
  try {
    const backup=app.MyPay.buildBackup();backup.extra.displayName='Из копии';backup.extra.workdayOverrides={[day]:false};
    await app.MyPay.restoreBackup(app.MyPay.parseBackup(JSON.stringify(backup)));
    assert.equal(app.text('greetingTitle'),'Из копии ❤️');assert.equal(app.text('greetingMessage'),'Сегодня отдыхаешь, заслуженный отдых 😴');
  } finally {app.close();}
});
