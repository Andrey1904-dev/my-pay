// Run against npm run preview. Playwright is an optional QA tool, not a runtime dependency.
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
const output='screenshots/greeting';fs.mkdirSync(output,{recursive:true});
const browsers=[];
(async()=>{
 const results=[];
 for(const [engineName,engine] of Object.entries({chromium,webkit})){
  const browser=await engine.launch();browsers.push(browser);
  for(const width of [320,375,390,430]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce',timezoneId:'America/Los_Angeles'});
   await context.route(/supabase\.co|cdn.jsdelivr.net/,r=>r.abort());
   await context.addInitScript(()=>{
    const NativeDate=Date;window.__testNow='2026-10-26T07:00:00Z';
    window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__testNow]));}static now(){return new NativeDate(window.__testNow).getTime();}};
    if(!localStorage.getItem('myPaySettings'))localStorage.setItem('myPaySettings',JSON.stringify({scheduleStart:'2026-10-26'}));
   });
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   // Baseline production is read-only, isolated and never authenticated.
   await page.goto('https://andrey1904-dev.github.io/my-pay/');await page.waitForFunction(()=>!!window.MyPay);await page.evaluate(()=>document.fonts.ready);
   const baseline={hero:(await page.locator('#homeScreen .hero-card').boundingBox()).y,cases:(await page.locator('.cases-card').boundingBox()).y};
   await page.goto('http://localhost:4173/');await page.waitForFunction(()=>MyPay.version==='1.14');await page.evaluate(()=>document.fonts.ready);
   await page.evaluate(()=>{MyPay.state.extra.displayName='Андрей';MyPay.renderAll();});
   assert.equal(await page.locator('#greetingTitle').innerText(),'Андрей ❤️');
   assert.equal(await page.locator('#greetingMessage').innerText(),'Это твоя первая смена 😭');
   const current={hero:(await page.locator('#homeScreen .hero-card').boundingBox()).y,cases:(await page.locator('.cases-card').boundingBox()).y};
   assert.ok(Math.abs(current.hero-baseline.hero)<0.25, 'earnings card moved');
   assert.ok(Math.abs(current.cases-baseline.cases)<0.25, 'counter card moved');
   results.push({engine:engineName,width,baseline,current});
   for(const theme of ['dark','light']){
    await page.evaluate(t=>{MyPay.state.extra.theme=t;MyPay.applyTheme();},theme);
    for(const [scenario,name,start,overrides] of [
     ['first','Андрей','2026-10-26',{}],['second','Андрей','2026-10-25',{}],
     ['third','Андрей','2026-10-25',{'2026-10-24':true}],
     ['fourth','Андрей','2026-10-25',{'2026-10-24':true,'2026-10-23':true,'2026-10-22':false}],
     ['rest','','2026-10-24',{}],['long','Александра-Мария '+'Оченьдлиннаяфамилия'.repeat(3),'2026-10-26',{}]
    ]){
     await page.evaluate(({name,start,overrides})=>{MyPay.state.extra.displayName=name;MyPay.state.settings.scheduleStart=start;MyPay.state.extra.workdayOverrides=overrides;MyPay.renderAll();},{name,start,overrides});
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
     assert.equal(overflow,false,`${engineName}/${width}/${theme}/${scenario} overflow`);
     const box=await page.locator('#greetingTitle').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width);
     if((engineName==='webkit' && width===390 && theme==='dark') || (engineName==='chromium' && ((width===390 && theme==='light' && scenario==='first') || (width===320 && theme==='dark' && scenario==='long'))))await page.screenshot({path:`${output}/${engineName}-${width}-${theme}-${scenario}.png`,fullPage:true});
    }
   }
   await page.evaluate(()=>{MyPay.state.extra.displayName='';MyPay.state.extra.workdayOverrides={};MyPay.state.settings.scheduleStart='2026-10-26';MyPay.renderAll();MyPay.openSettings();});
   await page.locator('#settingDisplayName').fill('Ирина');await page.locator('#settingsSave').click();
   assert.equal(await page.locator('#greetingTitle').innerText(),'Ирина ❤️');
   await page.reload();await page.waitForFunction(()=>window.MyPay?.state.extra.displayName==='Ирина');
   assert.equal(await page.locator('#greetingTitle').innerText(),'Ирина ❤️');
   await page.locator('[data-screen="calendarScreen"]').click();
   await page.locator('#calendarWorkday').selectOption('off');
   await page.locator('[data-screen="homeScreen"]').click();
   assert.equal(await page.locator('#greetingMessage').innerText(),'Сегодня отдыхаешь, заслуженный отдых 😴');
   await page.locator('[data-screen="calendarScreen"]').click();await page.locator('#calendarWorkday').selectOption('auto');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.locator('[data-screen="homeScreen"]').click();
   await page.evaluate(()=>{window.__testNow='2026-10-26T19:00:00Z';window.dispatchEvent(new Event('pageshow'));});
   assert.equal(await page.locator('#greetingMessage').innerText(),'Это твоя вторая смена 🥺');
   assert.match(await page.locator('#todayLabel').innerText(),/27 октября/i);
   assert.deepEqual(errors,[]);await context.close();
  }
  await browser.close();
 }
 fs.writeFileSync(`${output}/browser-results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{for(const b of browsers)await b.close();});
