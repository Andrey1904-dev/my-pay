const assert=require('node:assert/strict');
const fs=require('node:fs');
fs.mkdirSync('screenshots',{recursive:true});
const browsers=[];
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
 for (const [name, engine] of Object.entries({chromium,webkit})) {
  const browser=await engine.launch({headless:true});browsers.push(browser);
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'Asia/Yekaterinburg'});
  await context.route(/supabase\.co|cdn.jsdelivr.net/,r=>r.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://localhost:4173/');await page.waitForFunction(()=>!!window.MyPay);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`screenshots/${name}-today.png`,fullPage:true});
  console.log(name,'loaded',errors);
  for (const width of [320,375,390,393,430,768,1024,1440]) {
   await page.setViewportSize({width,height:900});
   for (const screen of ['homeScreen','calendarScreen','statsScreen','moreScreen']) {
    await page.evaluate(id=>window.MyPay.showScreen(id),screen);
    const size=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,view:innerWidth}));
    assert.ok(size.doc<=size.view,`${name} ${width} ${screen}: overflow`);
   }
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.MyPay.showScreen('homeScreen'));
  for(let i=0;i<20;i++) await page.locator('[data-add="100"]').click();
  assert.equal(await page.locator('#casesInput').inputValue(),'2000');
  console.log(name,'burst',await page.locator('#casesInput').inputValue(),await page.locator('#shiftTotal').innerText());
  await page.reload();await page.waitForFunction(()=>!!window.MyPay);
  assert.equal(await page.locator('#casesInput').inputValue(),'2000');
  await page.locator('#casesInput').fill('1000');await page.locator('#casesInput').blur();
  console.log(name,'reload',await page.locator('#casesInput').inputValue());
  await page.evaluate(()=>{document.querySelector('#holidayInput').checked=true;document.querySelector('#holidayInput').dispatchEvent(new Event('change'));});
  await page.screenshot({path:`screenshots/${name}-holiday.png`,fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:`screenshots/${name}-desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});
  for(const screen of ['calendarScreen','statsScreen','moreScreen']) {await page.evaluate(id=>window.MyPay.showScreen(id),screen);await page.screenshot({path:`screenshots/${name}-${screen}.png`,fullPage:true});}
  await page.goBack();console.log(name,'back',await page.locator('.screen.active').getAttribute('id'));
  await page.evaluate(()=>{MyPay.state.extra.theme='light';MyPay.applyTheme();MyPay.showScreen('homeScreen');});
  await page.screenshot({path:`screenshots/${name}-light.png`,fullPage:true});
  await page.evaluate(()=>MyPay.state.extra.theme='dark');
  await page.evaluate(()=>MyPay.applyTheme());
  await page.goto('http://localhost:4173/app.html?legacy=1#calendarScreen');await page.waitForFunction(()=>!!window.MyPay);
  console.log(name,'legacy',page.url(),await page.locator('.screen.active').getAttribute('id'));
  if(name==='chromium') {
   await page.evaluate(()=>navigator.serviceWorker.ready);await page.reload();await context.setOffline(true);await page.reload();await page.waitForFunction(()=>!!window.MyPay);
   console.log(name,'offline',await page.locator('#casesInput').inputValue());
  }
  assert.deepEqual(errors,[]);console.log(name,'errors',errors);
  await context.close();
  // Use the same isolated backend/SDK as unit tests. No real account or server calls.
  const auth=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await auth.route(/supabase\.co|cdn.jsdelivr.net/,r=>r.abort());
  const fake=fs.readFileSync('tests/helpers/fake-backend.mjs','utf8').replaceAll('export function','function')+'\n'+fs.readFileSync('tests/helpers/fake-supabase.mjs','utf8').replace(/import .*;\n/,'').replaceAll('export function','function');
  await auth.addInitScript({content:fake+';window.testBackend=createFakeSupabase();window.supabase={createClient:()=>testBackend.sdk};'});
  const signed=await auth.newPage();await signed.goto('http://localhost:4173/');
  await signed.waitForFunction(()=>window.MyPay?.currentUser && window.testBackend.control.listener);
  await signed.evaluate(()=>testBackend.control.failWrites=true);
  for(let i=0;i<20;i++)await signed.locator('[data-add="100"]').click();
  assert.equal(await signed.evaluate(()=>MyPay.loadQueue().filter(x=>x.type==='saveShift').length),1);
  await signed.evaluate(()=>{testBackend.control.failWrites=false;window.dispatchEvent(new Event('online'));});
  await signed.waitForFunction(()=>MyPay.loadQueue().length===0 && testBackend.db.shifts?.[0]?.cases===2000);
  assert.equal(await signed.evaluate(()=>testBackend.db.shifts.length),1);
  console.log(name,'mock authenticated offline/reconnect sync: 2000 cases, one row, queue empty');
  const today=await signed.evaluate(()=>MyPay.dateKey(MyPay.workNow()));
  await signed.evaluate(date=>MyPay.openShiftModal(date),today);
  await signed.locator('#modalCases').fill('1200');await signed.locator('#modalBonus').fill('200');
  await signed.locator('#modalSave').click();
  await signed.waitForFunction(date=>MyPay.state.shifts[date]?.total===4715,today);
  await signed.evaluate(date=>MyPay.deleteShift(date,{confirmFirst:false}),today);
  assert.equal(await signed.evaluate(date=>!!MyPay.state.shifts[date],today),false);
  await signed.evaluate(()=>MyPay.undoLastDelete());
  assert.equal(await signed.evaluate(date=>MyPay.state.shifts[date].total,today),4715);
  await signed.evaluate(()=>MyPay.showScreen('moreScreen'));
  for(const id of ['exportBtn','exportCsvBtn']) {
    const download=signed.waitForEvent('download');await signed.locator('#'+id).click();
    const file=await download;assert.equal(await file.failure(),null);
    const content=fs.readFileSync(await file.path(),'utf8');assert.ok(content.includes('4715'));
  }
  const backup=await signed.evaluate(()=>MyPay.buildBackup());
  backup.shifts['2025-01-02']={cases:100,holiday:false,base:3000,piece:200,total:3300};
  await signed.locator('#importFile').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await signed.waitForFunction(()=>MyPay.state.shifts['2025-01-02']?.total===3300 && MyPay.loadQueue().length===0);
  console.log(name,'edit, delete/undo, JSON/CSV download, JSON import preserving history: passed');
  await auth.close();await browser.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const browser of browsers)await browser.close();});
