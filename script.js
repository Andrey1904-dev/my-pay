/// v14: stale-cache protection; keep the current service worker and refresh app assets safely.
(async()=>{
  // Remove caches from older releases, but do not unregister the active worker on every launch.
  try{
    if("caches" in window){
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith("my-pay-v")&&k!=="my-pay-v14").map(k=>caches.delete(k)));
    }
  }catch(e){console.warn("Cache cleanup:",e);}
})();;
const SUPABASE_URL="https://dyixwxxpjmyycgigcbtx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_NFxxL8WDGpG-ASXo2LasmQ_wskniL6r";
const db=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const DEFAULTS={basePay:2150,holidayPay:4050,casePrice:7,percent:20,scheduleStart:new Date().toISOString().slice(0,10),goal:60000};
const EXTRA_DEFAULTS={expenses:[],goals:[],templates:[{id:"default",name:"Обычная",cases:0,hours:11,bonus:0,holiday:false}],shiftMeta:{},theme:"system",undo:null,celebratedGoals:[]};
const state={settings:load("myPaySettings",DEFAULTS),shifts:load("myPayShifts",{}),extra:load("myPayExtra",EXTRA_DEFAULTS),calendarDate:new Date(),selectedDate:dateKey(new Date()),modalDate:null};
state.extra={...EXTRA_DEFAULTS,...(state.extra||{})};
state.settings.holidayPay=4050;
let currentUser=null,currentProfile=null,authMode="login";

function load(k,f){try{const x=localStorage.getItem(k);return x?JSON.parse(x):{...f}}catch{return{...f}}}
function save(){localStorage.setItem("myPaySettings",JSON.stringify(state.settings));localStorage.setItem("myPayShifts",JSON.stringify(state.shifts));localStorage.setItem("myPayExtra",JSON.stringify(state.extra))}
function $(id){return document.getElementById(id)}
function money(n){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Math.round((Number(n)||0)*100)/100)+" ₽"}
function integer(n){return new Intl.NumberFormat("ru-RU").format(Number(n)||0)}
function dateKey(d){d=new Date(d);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function fromKey(k){const [y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)}
function dateText(d,opt){return new Intl.DateTimeFormat("ru-RU",opt||{day:"numeric",month:"long"}).format(d)}
function piece(c){return Number(c||0)*Number(state.settings.casePrice)*Number(state.settings.percent)/100}
function monthEntries(d=state.calendarDate){const prefix=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-`;return Object.entries(state.shifts).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>({k,...v}))}
function updateHomeDashboard(){
  const es=monthEntries(new Date()),sum=es.reduce((a,v)=>a+Number(v.total||0),0),cases=es.reduce((a,v)=>a+Number(v.cases||0),0),avg=es.length?sum/es.length:0,goal=Number(state.settings.goal)||0,pct=goal?Math.min(100,Math.round(sum/goal*100)):0;
  $("homeMonthTotal").textContent=money(sum);$("homeMonthShifts").textContent=integer(es.length);$("homeMonthCases").textContent=integer(cases);$("homeAvgShift").textContent=money(avg);$("homeGoalPercent").textContent=pct+"%";$("homeGoalBar").style.width=pct+"%";
  updateNextShiftCard();
}
function updateNextShiftCard(){
  const now=new Date(), minutes=now.getHours()*60+now.getMinutes(), start=8*60, end=19*60;
  if(isWork(now) && minutes>=start && minutes<end){
    const left=end-minutes, h=Math.floor(left/60), m=left%60;
    $("nextShiftCard").classList.add("current-shift");
    $("nextShiftCard").querySelector("span").textContent="СМЕНА ИДЁТ";
    $("nextShiftDate").textContent=`До конца смены ${h} ч ${String(m).padStart(2,"0")} мин`;
    $("nextShiftMeta").textContent="Рабочее время до 19:00";
    return;
  }
  $("nextShiftCard").classList.remove("current-shift");
  let d=new Date(now);
  if(isWork(d) && minutes<start){
    $("nextShiftCard").querySelector("span").textContent="БЛИЖАЙШАЯ СМЕНА";
    $("nextShiftDate").textContent="Сегодня";
    $("nextShiftMeta").textContent="Начало в 08:00";
    return;
  }
  d.setDate(d.getDate()+1);
  for(let i=0;i<366;i++){
    if(isWork(d)){
      $("nextShiftCard").querySelector("span").textContent="БЛИЖАЙШАЯ СМЕНА";
      $("nextShiftDate").textContent=dateText(d,{weekday:"long",day:"numeric",month:"long"});
      $("nextShiftMeta").textContent="Начало в 08:00";
      return;
    }
    d.setDate(d.getDate()+1);
  }
}
function base(h){return h?Number(state.settings.holidayPay):Number(state.settings.basePay)}
function total(c,h){return base(h)+piece(c)}
function isWork(d){const start=fromKey(state.settings.scheduleStart);const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());const diff=Math.floor((t-start)/86400000);return ((diff%4)+4)%4<2}
function plural(n,a,b,c){n=Math.abs(n)%100;const x=n%10;return n>10&&n<20?c:x>1&&x<5?b:x===1?a:c}
function showToast(t){const x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>x.classList.remove("show"),2200)}
function setStatus(t){$("authStatus").textContent=t||""}

function showAuth(show){$("authModal").classList.toggle("hidden",!show)}
function setAuthMode(mode){
  authMode=mode;
  const signup=mode==="signup";
  $("authWelcome").classList.add("hidden");$("authForm").classList.remove("hidden");
  $("signupNameWrap").classList.toggle("hidden",!signup);$("confirmPasswordWrap").classList.toggle("hidden",!signup);
  $("authOverline").textContent=signup?"РЕГИСТРАЦИЯ":"ВХОД";
  $("authTitle").textContent=signup?"Создай свой аккаунт ✨":"С возвращением ✨";
  $("authSubtitle").textContent=signup?"Придумай логин и пароль. Больше ничего не понадобится.":"Введи логин и пароль, чтобы открыть приложение.";
  $("authAction").textContent=signup?"Создать аккаунт":"Войти";
  $("authSwitch").innerHTML=signup?'Уже есть аккаунт? <button id="switchAuth">Войти</button>':'Нет аккаунта? <button id="switchAuth">Зарегистрироваться</button>';
  $("switchAuth").onclick=()=>setAuthMode(signup?"login":"signup");
  setStatus("");
}
function backAuth(){$("authForm").classList.add("hidden");$("authWelcome").classList.remove("hidden");setStatus("")}

async function authAction(){
  const email=$('authEmail').value.trim().toLowerCase(),password=$('authPassword').value;
  if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setStatus('Укажи корректный email.');return}
  if(password.length<6){setStatus('Пароль должен быть минимум 6 символов.');return}
  $('authAction').disabled=true;$('authAction').textContent='Секунду…';
  try{
    if(authMode==='login'){
      const {data,error}=await db.auth.signInWithPassword({email,password});
      if(error){
        const m=(error.message||'').toLowerCase();
        if(error.status===0 || /fetch|network|failed to fetch/i.test(m)) throw new Error('Нет соединения с сервером.');
        if(/email not confirmed/i.test(m)) throw new Error('Подтверждение email включено. Отключи Confirm email в настройках Supabase.');
        throw new Error('Неверный email или пароль.');
      }
      currentUser=data.user;await afterLogin();setStatus('');
    }else{
      const name=$('authName').value.trim(),p2=$('authPassword2').value;
      if(name.length<2)throw new Error('Напиши имя.');
      if(password!==p2)throw new Error('Пароли не совпадают.');
      const {data,error}=await db.auth.signUp({email,password,options:{data:{name:name.trim()}}});
      if(error){
        const m=(error.message||'').toLowerCase();
        if(/already registered|already been registered|user already registered/i.test(m)) throw new Error('Этот email уже зарегистрирован.');
        if(/email provider is disabled|email signups are disabled/i.test(m)) throw new Error('Регистрация отключена. Включи Authentication → Providers → Email.');
        if(/invalid.*email|email.*invalid/i.test(m)) throw new Error('Укажи корректный email.');
        if(/password.*(6|characters)|weak password/i.test(m)) throw new Error('Пароль должен быть минимум 6 символов.');
        if(/fetch|network|failed to fetch/i.test(m)) throw new Error('Нет соединения с сервером.');
        throw new Error(error.message||'Не удалось создать аккаунт.');
      }
      if(!data.user)throw new Error('Не удалось создать аккаунт.');
      if(!data.session){ setStatus('Аккаунт создан. Проверь почту и подтверди email, затем войди.'); return; }
      currentUser=data.user;
      const profileResult=await cloudSaveProfile(name);
      if(!profileResult)throw new Error('Аккаунт создан, но не удалось сохранить профиль. Проверь SQL-схему и RLS.');
      const settingsResult=await ensureCloudDefaults();
      if(!settingsResult)throw new Error('Аккаунт создан, но не удалось сохранить настройки. Проверь SQL-схему и RLS.');
      await afterLogin();showToast('Аккаунт создан. Добро пожаловать ✨');
    }
  }catch(e){setStatus(e.message||'Что-то пошло не так.')}finally{$('authAction').disabled=false;$('authAction').textContent=authMode==='signup'?'Создать аккаунт':'Войти'}
}
let cloudRefreshTimer=null;
function startCloudRefresh(){
  if(cloudRefreshTimer)clearInterval(cloudRefreshTimer);
  cloudRefreshTimer=setInterval(async()=>{
    if(!currentUser||document.hidden||document.querySelector(".modal:not(.hidden)"))return;
    await cloudLoad();
  },15000);
}
async function afterLogin(){const synced=await cloudLoad();if(!synced){if(!navigator.onLine){showAuth(false);updateProfileUI();updateHome();renderCalendar();renderStats();renderFinance();showToast("Офлайн-режим: данные сохраняются на устройстве");return true}showAuth(true);setStatus("Не удалось синхронизировать данные. Проверь интернет и попробуй войти снова.");return false}showAuth(false);updateProfileUI();updateHome();renderCalendar();renderStats();renderFinance();flushCloudQueue();startCloudRefresh();return true}

async function cloudLoad(){
  if(!currentUser)return false;
  const {data:sd,error:se}=await db.from("settings").select("*").eq("user_id",currentUser.id).maybeSingle();
  if(se){console.error("cloudLoad settings:",se);return false;}
  const {data:rows,error:re}=await db.from("shifts").select("*").eq("user_id",currentUser.id).order("work_date",{ascending:true});
  if(re){console.error("cloudLoad shifts:",re);return false;}
  if(sd) state.settings={basePay:Number(sd.base_pay)||0,holidayPay:Number(sd.holiday_pay)||4050,casePrice:Number(sd.case_price)||0,percent:Number(sd.piece_percent)||0,scheduleStart:sd.schedule_start||state.settings.scheduleStart,goal:Number(sd.monthly_goal)||0};
  else await ensureCloudDefaults();

  const {data:profile,error:pe}=await db.from("profiles").select("id,name").eq("id",currentUser.id).maybeSingle();
  if(pe){console.error("cloudLoad profile:",pe);return false;}
  currentProfile=profile||null;

  // Cloud is the source of truth for an authenticated account. An empty cloud result
  // must clear old device data so one account can never see another account's shifts.
  const cs={};
  if(Array.isArray(rows)) for(const x of rows){
    const key=String(x.work_date).slice(0,10);
    cs[key]={cases:Number(x.cases)||0,holiday:!!x.is_holiday,base:Number(x.base_pay)||0,piece:Number(x.piece_pay)||0,total:Number(x.total_pay)||0};
  }
  state.shifts=cs;
  syncHomeInputsFromCloud();
  await cloudLoadExtra();
  save();updateHome();renderCalendar();renderStats();if(typeof renderInsights==="function")renderInsights();if(typeof renderFinance==="function")renderFinance();
  return true;
}
async function ensureCloudDefaults(){
  if(!currentUser)return false;
  const {error}=await db.from('settings').upsert({user_id:currentUser.id,base_pay:state.settings.basePay,holiday_pay:4050,case_price:state.settings.casePrice,piece_percent:state.settings.percent,schedule_start:state.settings.scheduleStart,monthly_goal:state.settings.goal},{onConflict:'user_id'});
  return !error;
}
async function cloudSaveProfile(name){
  if(!currentUser)return false;
  const {data,error}=await db.from('profiles').upsert({id:currentUser.id,name:name.trim()},{onConflict:'id'}).select().single();
  if(!error)currentProfile=data;
  return !error;
}
async function cloudSaveSettings(){
  if(!currentUser) return false;
  const s=state.settings||{};
  const payload={user_id:currentUser.id,base_pay:Number(s.basePay)||0,holiday_pay:Number(s.holidayPay)||4050,case_price:Number(s.casePrice)||0,piece_percent:Number(s.percent)||0,schedule_start:s.scheduleStart||new Date().toISOString().slice(0,10),monthly_goal:Number(s.goal)||0};
  const {error}=await db.from("settings").upsert(payload,{onConflict:"user_id"});
  if(error){console.error("cloudSaveSettings:",error);return false;}
  return true;
}
async function cloudSaveShift(date,shift){
  if(!currentUser||!date||!shift)return false;
  const payload={user_id:currentUser.id,work_date:date,cases:Number(shift.cases)||0,is_holiday:!!shift.holiday,base_pay:Number(shift.base)||0,piece_pay:Number(shift.piece)||0,total_pay:Number(shift.total)||0};
  const {error}=await db.from("shifts").upsert(payload,{onConflict:"user_id,work_date"});
  if(error){console.error("cloudSaveShift:",date,error);if(!navigator.onLine||/fetch|network/i.test(error.message||"")){queueCloudOp({type:"saveShift",date,shift});return true}return false;}
  removeQueuedShift(date,"saveShift");return true;
}
async function cloudDeleteShift(k){
  if(!currentUser)return false;
  const {error}=await db.from("shifts").delete().eq("user_id",currentUser.id).eq("work_date",k);
  if(error){if(!navigator.onLine||/fetch|network/i.test(error.message||"")){queueCloudOp({type:"deleteShift",date:k});return true}showToast("Не удалось удалить смену из облака.");return false}
  removeQueuedShift(k,"deleteShift");return true;
}

function updateProfileUI(){
  const n=currentProfile?.name?.trim()||"Мой расчёт";$("profileName").textContent=n;$("profileAvatar").textContent=(n[0]||"₽").toUpperCase();
  const first=n.split(/\s+/)[0];$("greetingTitle").textContent="Моя смена";
}

function syncHomeInputsFromCloud(){
  const todayShift=state.shifts[dateKey(new Date())];
  $("casesInput").value=todayShift?String(todayShift.cases||0):"0";
  $("holidayInput").checked=Boolean(todayShift?.holiday);
}
function updateHome(){
  updateHomeDashboard();
  const todayKey=dateKey(new Date());
  const cloudToday=state.shifts[todayKey];
  const c=Math.max(0,Math.floor(Number(cloudToday?cloudToday.cases:$("casesInput").value)||0));
  const h=cloudToday?Boolean(cloudToday.holiday):$("holidayInput").checked;
  if(cloudToday){$("casesInput").value=String(c);$("holidayInput").checked=h;}
  const p=piece(c);
  $("shiftTotal").textContent=money(c?base(h)+p:0);$("homeBase").textContent=money(base(h));$("homePiece").textContent=money(p);$("perCase").textContent=money(Number(state.settings.casePrice)*Number(state.settings.percent)/100);$("perThousand").textContent=money(piece(1000));$("holidayChip").classList.toggle("hidden",!h);
  $("todayLabel").textContent=dateText(new Date(),{weekday:"long",day:"numeric",month:"long"}).toUpperCase();$("todayBadge").textContent=isWork(new Date())?"РАБОТА":"ВЫХОДНОЙ";
  $("greetingTitle").textContent="Моя смена";
}
async function saveHomeShift(){
  const c=Math.max(0,Math.floor(Number($("casesInput").value)||0)),h=$("holidayInput").checked,k=state.selectedDate||dateKey(new Date()),v={cases:c,holiday:h,base:base(h),piece:piece(c),total:total(c,h)},previous=state.shifts[k];
  state.shifts[k]=v;
  if(currentUser){if(!await cloudSaveShift(k,v)){if(previous)state.shifts[k]=previous;else delete state.shifts[k];save();return}}else save();
  renderCalendar();renderStats();renderInsights();renderFinance();updateHomeDashboard();showToast("Смена сохранена ✓")
}
function renderCalendar(){
  const d=state.calendarDate;$("monthTitle").textContent=dateText(d,{month:"long",year:"numeric"});const first=new Date(d.getFullYear(),d.getMonth(),1),offset=(first.getDay()+6)%7,days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),box=$("calendarDays");box.innerHTML="";
  for(let i=0;i<offset;i++){const e=document.createElement("div");e.className="day empty";box.appendChild(e)}
  const today=dateKey(new Date());
  for(let n=1;n<=days;n++){const x=new Date(d.getFullYear(),d.getMonth(),n),k=dateKey(x),b=document.createElement("button");b.className="day "+(isWork(x)?"work ":"")+(state.shifts[k]?.holiday?"holiday ":"")+(state.shifts[k]?"saved ":"")+(k===today?"today ":"")+(k===state.selectedDate?"selected":"");b.textContent=n;
    if(state.shifts[k]){const i=document.createElement("i");i.className="tiny";b.appendChild(i)}b.onclick=()=>selectCalendarDate(k);box.appendChild(b)}
}
function selectCalendarDate(k){state.selectedDate=k;const d=fromKey(k),s=state.shifts[k];$("selectedDate").textContent=dateText(d,{weekday:"long",day:"numeric",month:"long"});$("selectedStatus").textContent=s?(s.holiday?"Праздничная смена":"Сохранённая смена"):(isWork(d)?"Рабочий день":"Выходной");$("selectedMoney").textContent=s?money(s.total):"—";renderCalendar()}
function openShiftModal(k){state.modalDate=k;const s=state.shifts[k],m=state.extra.shiftMeta?.[k]||{};$("modalDate").textContent=dateText(fromKey(k),{weekday:"long",day:"numeric",month:"long"});$("modalCases").value=s?.cases??"";$("modalHoliday").checked=Boolean(s?.holiday);$("modalHours").value=m.hours??11;$("modalBonus").value=m.bonus??0;$("modalNote").value=m.note??"";$("modalDelete").style.display=s?"block":"none";renderModalTemplates();updateModal();$("shiftModal").classList.remove("hidden")}
function updateModal(){const c=Math.max(0,Number($("modalCases").value)||0),h=$("modalHoliday").checked,bonus=Math.max(0,Number($("modalBonus").value)||0),hours=Math.max(0,Number($("modalHours").value)||0),sum=(c?total(c,h):base(h))+bonus;$("modalTotal").textContent=money(sum);$("modalHourly").textContent=hours?`≈ ${money(sum/hours)} за час`:"Укажи часы, чтобы увидеть доход в час"}
async function saveModal(){const c=Math.max(0,Math.floor(Number($("modalCases").value)||0)),h=$("modalHoliday").checked,k=state.modalDate,bonus=Math.max(0,Number($("modalBonus").value)||0),hours=Math.max(0,Number($("modalHours").value)||0),note=$("modalNote").value.trim(),v={cases:c,holiday:h,base:base(h),piece:piece(c),total:total(c,h)+bonus},previous=state.shifts[k];state.shifts[k]=v;state.extra.shiftMeta[k]={hours,bonus,note};save();await cloudSaveExtra();if(currentUser){if(!await cloudSaveShift(k,v)){if(previous)state.shifts[k]=previous;else delete state.shifts[k];save();return}}selectCalendarDate(k);renderStats();renderFinance();closeModal("shiftModal");showToast("Смена сохранена ✓")}
async function deleteModal(){if(!state.modalDate)return;const k=state.modalDate,previous=state.shifts[k],meta=state.extra.shiftMeta?.[k]||null;state.extra.undo={date:k,shift:previous,meta};delete state.shifts[k];if(state.extra.shiftMeta)delete state.extra.shiftMeta[k];save();if(currentUser){if(!await cloudDeleteShift(k)){if(previous)state.shifts[k]=previous;save();return}}await cloudSaveExtra();selectCalendarDate(k);renderStats();renderFinance();refreshUndoUI();closeModal("shiftModal");showToast("Смена удалена • можно вернуть в «Ещё»")}

function monthForecast(){
  const now=new Date(), es=monthEntries(now), workedDays=es.length;
  if(!workedDays)return null;
  const sum=es.reduce((a,v)=>a+Number(v.total||0),0);
  const daysInMonth=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
  const day=Math.max(1,now.getDate());
  return Math.round(sum/day*daysInMonth);
}
function analyticsForMonth(d=state.calendarDate){
  const es=monthEntries(d).sort((a,b)=>a.k.localeCompare(b.k));
  const sum=es.reduce((a,v)=>a+Number(v.total||0),0);
  const goal=Number(state.settings.goal)||0;
  const best=es.reduce((a,v)=>!a||Number(v.total)>Number(a.total)?v:a,null);
  const remaining=Math.max(0,goal-sum);
  const avg=es.length?sum/es.length:0;
  const shiftsNeeded=remaining>0&&avg>0?Math.ceil(remaining/avg):0;
  let streak=0,bestStreak=0,prev=null;
  es.forEach(v=>{
    const d=fromKey(v.k);
    if(prev){
      const delta=Math.round((d-prev)/86400000);
      if(delta<=4)streak++; else streak=1;
    }else streak=1;
    bestStreak=Math.max(bestStreak,streak); prev=d;
  });
  return {es,sum,goal,best,remaining,avg,shiftsNeeded,bestStreak};
}
function renderInsights(){
  const a=analyticsForMonth();
  if(!a.es.length){
    $("smartGoalTitle").textContent="Внеси первую смену";
    $("smartGoalMeta").textContent=a.goal?`Цель ${money(a.goal)} — начнём считать темп`:"Установи цель в настройках";
    $("recordShift").textContent="0 ₽";$("shiftStreak").textContent="0";$("recordCases").textContent="0";$("bestDay").textContent="—";
    $("bestShiftBadge").textContent="Нет данных";$("earningsChart").innerHTML='<div class="chart-empty">Здесь появится график после первой смены</div>';
    return;
  }
  const forecast=monthForecast();
  if(a.remaining<=0){
    $("smartGoalTitle").textContent="Цель выполнена 🎉";
    $("smartGoalMeta").textContent=`${money(a.sum)} из ${money(a.goal)}`;
  }else if(a.avg>0){
    $("smartGoalTitle").textContent=`Ещё ${money(a.remaining)}`;
    $("smartGoalMeta").textContent=`≈ ${a.shiftsNeeded} ${plural(a.shiftsNeeded,"смена","смены","смен")} до цели • прогноз ${money(forecast||0)}`;
  }else{
    $("smartGoalTitle").textContent=`Цель ${money(a.goal)}`;
    $("smartGoalMeta").textContent=`Заработано ${money(a.sum)}`;
  }
  $("recordShift").textContent=money(a.best?.total||0);
  $("shiftStreak").textContent=`${a.bestStreak}`;
  $("recordCases").textContent=integer(a.es.reduce((s,v)=>s+Number(v.cases||0),0));
  $("bestDay").textContent=a.best?dateText(fromKey(a.best.k),{day:"numeric",month:"short"}):"—";
  $("bestShiftBadge").textContent=a.best?`🏆 ${money(a.best.total)}`:"—";
  const max=Math.max(...a.es.map(v=>Number(v.total)||0),1);
  $("earningsChart").innerHTML=a.es.slice(-12).map(v=>{
    const h=Math.max(7,Math.round((Number(v.total||0)/max)*92));
    const day=fromKey(v.k).getDate();
    return `<div class="bar-col"><div class="bar-value">${money(v.total).replace(" ₽","")}</div><div class="bar" style="height:${h}px" title="${dateText(fromKey(v.k),{day:"numeric",month:"long"})}: ${money(v.total)}"></div><small>${day}</small></div>`;
  }).join("");
}
async function deleteHistoryShift(k){
  const s=state.shifts[k];
  if(!s)return;
  const d=dateText(fromKey(k),{day:"numeric",month:"long"});
  if(!confirm(`Удалить смену за ${d}?`))return;
  state.extra.undo={date:k,shift:s,meta:state.extra.shiftMeta?.[k]||null};
  delete state.shifts[k];if(state.extra.shiftMeta)delete state.extra.shiftMeta[k];save();refreshUndoUI();
  if(currentUser){
    if(!await cloudDeleteShift(k)){
      state.shifts[k]=s;
      save();
      return;
    }
  }
  await cloudSaveExtra();
  renderCalendar();
  renderStats();
  renderFinance();
  updateHome();
  showToast("Смена удалена ✓");
}
async function enableNotifications(){
  if(!("Notification" in window)){
    showToast("Этот браузер не поддерживает уведомления");
    return;
  }
  if(!window.isSecureContext){
    showToast("Для уведомлений нужен HTTPS");
    return;
  }
  const permission=await Notification.requestPermission();
  if(permission==="granted"){
    $("notificationTipText").textContent="Уведомления включены. Напоминания будут работать после установки приложения на экран «Домой».";
    $("enableNotificationsBtn").textContent="Уведомления включены ✓";
    $("enableNotificationsBtn").disabled=true;
    scheduleShiftReminder();
    refreshNotificationUI();
  }else{
    $("notificationTipText").textContent="Уведомления запрещены. Их можно разрешить в настройках сайта.";
    showToast("Уведомления не разрешены");
  }
}
function scheduleShiftReminder(){
  // Web Push on iPhone needs a server-side push subscription. This local fallback
  // only reminds while the app is open; the PWA/service worker is prepared for Push API.
  if(!("Notification" in window) || Notification.permission!=="granted")return;
  const now=new Date();
  for(let i=1;i<=7;i++){
    const d=new Date(now); d.setDate(now.getDate()+i); d.setHours(9,0,0,0);
    if(isWork(d)){
      const key="myPayReminder_"+dateKey(d);
      if(!localStorage.getItem(key) && d-now>0){
        const ms=d-now;
        setTimeout(()=>{
          if(Notification.permission==="granted"){
            try{new Notification("CASE.PLACE SALARY",{body:`Сегодня рабочая смена — ${dateText(d,{day:"numeric",month:"long"})}.`});}
            catch{}
          }
          localStorage.setItem(key,"1");
        },Math.min(ms,2147483647));
      }
      break;
    }
  }
}
function renderStats(){
 const es=monthEntries(),sum=es.reduce((a,v)=>a+v.total,0),bs=es.reduce((a,v)=>a+v.base,0),ps=es.reduce((a,v)=>a+v.piece,0),cs=es.reduce((a,v)=>a+v.cases,0),goal=Number(state.settings.goal)||0,pct=goal?Math.min(100,Math.round(sum/goal*100)):0;
 $("statsMonth").textContent=dateText(state.calendarDate,{month:"long",year:"numeric"});$("monthTotal").textContent=money(sum);$("monthShiftsLabel").textContent=`${integer(es.length)} ${plural(es.length,"смена","смены","смен")}`;$("monthCasesLabel").textContent=`${integer(cs)} чехлов`;$("avgShift").textContent=money(es.length?sum/es.length:0);$("monthPiece").textContent=money(ps);$("monthBase").textContent=money(bs);$("avgCases").textContent=integer(es.length?Math.round(cs/es.length):0);$("goalPercent").textContent=pct+"%";$("goalBar").style.width=pct+"%";$("goalCurrent").textContent=money(sum);$("goalText").textContent=`Цель ${money(goal)}`;
 const list=$("historyList");if(!es.length)list.innerHTML='<div class="empty-history">Пока нет сохранённых смен.</div>';else{es.sort((a,b)=>b.k.localeCompare(a.k));list.innerHTML=es.map(v=>`<div class="history-item"><div class="history-left"><b>${dateText(fromKey(v.k),{day:"numeric",month:"long"})}${v.holiday?" ★":""}</b><small>${integer(v.cases)} чехлов • сделка ${money(v.piece)}</small></div><div class="history-right"><b>${money(v.total)}</b><small>${v.holiday?"Праздник":"Обычная смена"}</small></div><button class="history-delete" data-delete-shift="${v.k}" aria-label="Удалить смену">×</button></div>`).join("");list.querySelectorAll("[data-delete-shift]").forEach(b=>b.onclick=()=>deleteHistoryShift(b.dataset.deleteShift))}
 const forecast=monthForecast();
 if(forecast && state.calendarDate.getMonth()===new Date().getMonth() && state.calendarDate.getFullYear()===new Date().getFullYear()){
   $("goalText").textContent=`Цель ${money(goal)} • прогноз ${money(forecast)}`;
 }
}
function openSettings(){$("settingBase").value=state.settings.basePay;$("settingHoliday").value=state.settings.holidayPay;$("settingPrice").value=state.settings.casePrice;$("settingPercent").value=state.settings.percent;$("settingStart").value=state.settings.scheduleStart;$("settingGoal").value=state.settings.goal;$("settingsModal").classList.remove("hidden")}
async function saveSettings(){
  state.settings.basePay=Math.max(0,Number($("settingBase").value)||0);state.settings.holidayPay=4050;state.settings.casePrice=Math.max(0,Number($("settingPrice").value)||0);state.settings.percent=Math.min(100,Math.max(0,Number($("settingPercent").value)||0));state.settings.scheduleStart=$("settingStart").value||state.settings.scheduleStart;state.settings.goal=Math.max(0,Number($("settingGoal").value)||0);save();
  const ok=await cloudSaveSettings();updateHome();renderCalendar();renderStats();
  if(ok){closeModal("settingsModal");showToast("Настройки обновлены ✓");}else showToast("Настройки сохранены на устройстве, но не в облако.");
}
function closeModal(id){$(id).classList.add("hidden")}
function exportData(){const blob=new Blob([JSON.stringify({version:13,settings:state.settings,shifts:state.shifts,extra:state.extra},null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`my-pay-backup-${dateKey(new Date())}.json`;a.click();URL.revokeObjectURL(url);showToast("Резервная копия скачана ✓")}
function importData(file){
  const r=new FileReader();
  r.onload=async()=>{
    try{
      const d=JSON.parse(r.result);
      if(!d.settings||!d.shifts||typeof d.shifts!=="object")throw new Error("invalid backup");
      const importedSettings=d.settings||{};
      state.settings={
        basePay:Math.max(0,Number(importedSettings.basePay)||0),
        holidayPay:4050,
        casePrice:Math.max(0,Number(importedSettings.casePrice)||0),
        percent:Math.min(100,Math.max(0,Number(importedSettings.percent)||0)),
        scheduleStart:/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(importedSettings.scheduleStart)?importedSettings.scheduleStart:state.settings.scheduleStart,
        goal:Math.max(0,Number(importedSettings.goal)||0)
      };
      const importedShifts={};
      for(const [date,raw] of Object.entries(d.shifts)){
        if(!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)||!raw||typeof raw!=="object")continue;
        const cases=Math.max(0,Math.floor(Number(raw.cases)||0));
        const holiday=!!raw.holiday;
        importedShifts[date]={cases,holiday,base:base(holiday),piece:piece(cases),total:total(cases,holiday)};
      }
      state.shifts=importedShifts;
      if(d.extra&&typeof d.extra==="object")state.extra={...EXTRA_DEFAULTS,...d.extra};
      save();applyTheme();updateHome();renderCalendar();renderStats();renderFinance();if(typeof renderInsights==="function")renderInsights();
      if(!currentUser){showToast("Данные восстановлены ✓");return;}
      if(!await cloudSaveSettings()){showToast("Данные восстановлены на устройстве, но настройки не синхронизированы.");return;}
      const entries=Object.entries(state.shifts);
      for(const [date,shift] of entries) if(!await cloudSaveShift(date,shift)){showToast("Данные восстановлены, но часть смен не синхронизирована.");return;}
      const {data:verify,error}=await db.from("shifts").select("work_date").eq("user_id",currentUser.id);
      if(error||!verify||verify.length<entries.length){console.error("sync verify",error,verify);showToast("Данные восстановлены, но облачная проверка не прошла.");return;}
      showToast("Данные восстановлены и синхронизированы ✓");
    }catch(err){console.error("importData:",err);showToast("Не удалось прочитать файл");}
  };
  r.readAsText(file);
}

document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.querySelectorAll(".modal:not(.hidden)").forEach(m=>closeModal(m.id))});

document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
document.addEventListener("keydown",e=>{if(e.key==="Escape")document.querySelectorAll(".modal:not(.hidden)").forEach(m=>closeModal(m.id))});

document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.screen).classList.add("active");if(b.dataset.screen==="calendarScreen")renderCalendar();if(b.dataset.screen==="statsScreen")renderStats();if(b.dataset.screen==="financeScreen")renderFinance()});
$("casesInput").oninput=updateHome;$("holidayInput").onchange=updateHome;document.querySelectorAll(".step-btn").forEach(b=>b.onclick=()=>{$("casesInput").value=Math.max(0,(Number($("casesInput").value)||0)+Number(b.dataset.step));updateHome()});document.querySelectorAll(".quick-row button").forEach(b=>b.onclick=()=>{$("casesInput").value=Math.max(0,(Number($("casesInput").value)||0)+Number(b.dataset.add));updateHome()});
$("saveShiftBtn").onclick=saveHomeShift;$("settingsBtn").onclick=openSettings;$("openSettingsFromMore").onclick=openSettings;$("prevMonth").onclick=()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()-1,1);renderCalendar();renderStats()};$("nextMonth").onclick=()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()+1,1);renderCalendar();renderStats()};$("editSelectedBtn").onclick=()=>openShiftModal(state.selectedDate);
$("modalCases").oninput=updateModal;$("modalHoliday").onchange=updateModal;$("modalHours").oninput=updateModal;$("modalBonus").oninput=updateModal;$("modalSave").onclick=saveModal;$("modalDelete").onclick=deleteModal;$("settingsSave").onclick=saveSettings;
$("clearMonthBtn").onclick=async()=>{const es=Object.keys(state.shifts).filter(k=>k.startsWith(`${state.calendarDate.getFullYear()}-${String(state.calendarDate.getMonth()+1).padStart(2,"0")}-`));if(!es.length){showToast("В этом месяце нечего удалять");return}if(confirm("Удалить все смены за этот месяц?")){
  const results=await Promise.all(es.map(async k=>[k,await cloudDeleteShift(k)]));
  const failed=results.filter(([,ok])=>!ok).map(([k])=>k);
  results.filter(([,ok])=>ok).forEach(([k])=>{delete state.shifts[k];if(state.extra.shiftMeta)delete state.extra.shiftMeta[k]});
  save();await cloudSaveExtra();renderCalendar();renderStats();renderInsights();renderFinance();updateHomeDashboard();
  showToast(failed.length?`Удалено не всё: ${failed.length} смен не удалось удалить.`:"Месяц очищен");
}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$("exportBtn").onclick=exportData;$("importBtn").onclick=()=>$("importFile").click();$("importFile").onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
let deferredPrompt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e});$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else showToast("Открой меню браузера → «Добавить на экран»")};
$("goLogin").onclick=()=>setAuthMode("login");$("goSignup").onclick=()=>setAuthMode("signup");$("backAuth").onclick=backAuth;$("authAction").onclick=authAction;
$("authPassword").setAttribute("autocomplete","current-password");

async function initCloudAuth(){
 const {data:{session}}=await db.auth.getSession();
 if(session?.user){currentUser=session.user;await afterLogin()}else showAuth(true);
 db.auth.onAuthStateChange(async(_event,session)=>{if(session?.user&&!currentUser){currentUser=session.user;await afterLogin()}else if(!session){currentUser=null;currentProfile=null;showAuth(true);backAuth()}});
}
state.selectedDate=dateKey(new Date());applyTheme();selectCalendarDate(state.selectedDate);syncHomeInputsFromCloud();updateHome();renderCalendar();renderStats();renderInsights();renderFinance();refreshUndoUI();initCloudAuth();
$("logoutBtn").onclick=async()=>{
  await db.auth.signOut();
  currentUser=null;currentProfile=null;
  state.shifts={};
  state.settings={...DEFAULTS,holidayPay:4050,scheduleStart:new Date().toISOString().slice(0,10)};
  const keepTheme=state.extra.theme||"system";state.extra={...EXTRA_DEFAULTS,theme:keepTheme};
  save();updateHome();renderCalendar();renderStats();renderInsights();renderFinance();
  showToast("Вы вышли из аккаунта");
};
$("enableNotificationsBtn").onclick=enableNotifications;
if("Notification" in window && Notification.permission==="granted"){ $("notificationTipText").textContent="Уведомления включены. Для фоновых push-уведомлений нужен серверный push."; $("enableNotificationsBtn").textContent="Уведомления включены ✓"; $("enableNotificationsBtn").disabled=true; scheduleShiftReminder(); }


$("enableNotificationsMenu").onclick=enableNotifications;
function refreshNotificationUI(){
  const ok="Notification" in window && Notification.permission==="granted";
  $("notificationMenuStatus").textContent=ok?"Включены ✓":"Напоминания о сменах";
}
refreshNotificationUI();


// ===== v13 ULTRA FEATURES =====
const CLOUD_EXTRA_TABLE="user_app_data";
function uid(prefix="id"){return prefix+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,7)}
function monthPrefix(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-`}
function currentMonthExpenses(d=state.calendarDate){const p=monthPrefix(d);return (state.extra.expenses||[]).filter(x=>String(x.date||"").startsWith(p))}
function loadQueue(){try{const q=JSON.parse(localStorage.getItem("myPayCloudQueue")||"[]");return Array.isArray(q)?q:[]}catch{return []}}
function queueCloudOp(op){const q=loadQueue();const next=q.filter(x=>!(x.type===op.type&&x.date===op.date));next.push({...op,queuedAt:Date.now()});localStorage.setItem("myPayCloudQueue",JSON.stringify(next));showToast("Офлайн: сохраню в облако при подключении")}
function removeQueuedShift(date,type){const q=loadQueue().filter(x=>!(x.type===type&&x.date===date));localStorage.setItem("myPayCloudQueue",JSON.stringify(q))}
async function flushCloudQueue(){if(!navigator.onLine||!currentUser)return;const q=loadQueue();if(!q.length)return;const left=[];for(const op of q){try{if(op.type==="saveShift"){const payload={user_id:currentUser.id,work_date:op.date,cases:Number(op.shift.cases)||0,is_holiday:!!op.shift.holiday,base_pay:Number(op.shift.base)||0,piece_pay:Number(op.shift.piece)||0,total_pay:Number(op.shift.total)||0};const {error}=await db.from("shifts").upsert(payload,{onConflict:"user_id,work_date"});if(error)throw error}else if(op.type==="deleteShift"){const {error}=await db.from("shifts").delete().eq("user_id",currentUser.id).eq("work_date",op.date);if(error)throw error}}catch{left.push(op)}}localStorage.setItem("myPayCloudQueue",JSON.stringify(left));if(!left.length)showToast("Офлайн-изменения синхронизированы ✓")}
window.addEventListener("online",()=>{flushCloudQueue();cloudSaveExtra()});

async function cloudLoadExtra(){
  if(!currentUser)return false;
  try{
    const {data,error}=await db.from(CLOUD_EXTRA_TABLE).select("payload").eq("user_id",currentUser.id).maybeSingle();
    if(error){console.info("Доп. облачные функции пока локальные:",error.message);return false}
    if(data?.payload&&typeof data.payload==="object")state.extra={...EXTRA_DEFAULTS,...data.payload};
    else state.extra={...EXTRA_DEFAULTS,theme:state.extra.theme||"system"};
    return true;
  }catch{return false}
}
async function cloudSaveExtra(){
  save();if(!currentUser||!navigator.onLine)return false;
  try{const {error}=await db.from(CLOUD_EXTRA_TABLE).upsert({user_id:currentUser.id,payload:state.extra,updated_at:new Date().toISOString()},{onConflict:"user_id"});if(error){console.info("Доп. данные сохранены локально:",error.message);return false}return true}catch{return false}
}

function applyTheme(){let t=state.extra.theme||"system";const dark=t==="dark"||(t==="system"&&window.matchMedia?.("(prefers-color-scheme: dark)").matches);document.body.classList.toggle("dark",dark);if($("themeStatus"))$("themeStatus").textContent=t==="system"?"Системная":t==="dark"?"Тёмная":"Светлая"}
function cycleTheme(){const order=["system","light","dark"],i=order.indexOf(state.extra.theme||"system");state.extra.theme=order[(i+1)%order.length];save();applyTheme();cloudSaveExtra();showToast(`Тема: ${$("themeStatus").textContent}`)}
window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if((state.extra.theme||"system")==="system")applyTheme()});

function financeNumbers(){const d=new Date(),es=monthEntries(d),income=es.reduce((a,v)=>a+Number(v.total||0),0),expenses=currentMonthExpenses(d).reduce((a,v)=>a+Number(v.amount||0),0),free=income-expenses,forecast=monthForecast()||income,goal=Number(state.settings.goal)||0,days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),today=new Date(),remainingDays=Math.max(1,days-today.getDate()),daily=Math.max(0,free)/remainingDays,rate=income?Math.round(Math.max(0,free)/income*100):0;return{income,expenses,free,forecast,goal,remainingDays,daily,rate}}
function renderFinance(){if(!$("financeIncome"))return;const n=financeNumbers();$("financeIncome").textContent=money(n.income);$("financeExpenses").textContent=money(n.expenses);$("freeBalance").textContent=money(n.free);$("financeForecast").textContent=money(n.forecast);$("financeGoalLeft").textContent=money(Math.max(0,n.goal-n.income));$("dailyBudget").textContent=n.free>0?`≈ ${money(n.daily)} в день до конца месяца`:"Расходы уже выше свободного дохода";$("savingsRate").textContent=Math.max(0,n.rate)+"%";renderGoals();renderExpenses();renderTemplates();checkGoalCelebration()}
function renderGoals(){const box=$("goalsList");if(!box)return;const goals=state.extra.goals||[];if(!goals.length){box.innerHTML='<div class="empty-history">Целей пока нет. Добавь первую — приложение посчитает прогресс.</div>';return}box.innerHTML=goals.map(g=>{const amount=Math.max(1,Number(g.amount)||1),saved=Math.max(0,Number(g.saved)||0),pct=Math.min(100,Math.round(saved/amount*100));return `<div class="goal-item" data-goal="${g.id}"><div class="goal-top"><b>${escapeHtml(g.name)}</b><span>${money(saved)} / ${money(amount)}</span></div><div class="goal-track"><i style="width:${pct}%"></i></div><div class="goal-meta"><span>${pct}%</span><span>осталось ${money(Math.max(0,amount-saved))}</span></div><div class="goal-actions"><button class="tiny-btn" data-goal-add="${g.id}">＋ пополнить</button><button class="tiny-btn danger" data-goal-del="${g.id}">Удалить</button></div></div>`}).join("");box.querySelectorAll("[data-goal-add]").forEach(b=>b.onclick=()=>topUpGoal(b.dataset.goalAdd));box.querySelectorAll("[data-goal-del]").forEach(b=>b.onclick=()=>deleteGoal(b.dataset.goalDel))}
function escapeHtml(v){return String(v??"").replace(/[&<>\"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function openGoalModal(){$("goalName").value="";$("goalAmount").value="";$("goalSaved").value="0";$("goalModal").classList.remove("hidden")}
async function saveGoal(){const name=$("goalName").value.trim(),amount=Math.max(0,Number($("goalAmount").value)||0),saved=Math.max(0,Number($("goalSaved").value)||0);if(!name||!amount){showToast("Укажи название и сумму цели");return}state.extra.goals.push({id:uid("goal"),name,amount,saved});save();await cloudSaveExtra();closeModal("goalModal");renderFinance();showToast("Цель добавлена 🎯")}
async function topUpGoal(id){const g=state.extra.goals.find(x=>x.id===id);if(!g)return;const v=prompt(`Сколько добавить к цели «${g.name}»?`,"1000");if(v===null)return;g.saved=Math.max(0,Number(g.saved)||0)+Math.max(0,Number(String(v).replace(",","."))||0);save();await cloudSaveExtra();renderFinance()}
async function deleteGoal(id){state.extra.goals=state.extra.goals.filter(x=>x.id!==id);save();await cloudSaveExtra();renderFinance()}
function checkGoalCelebration(){state.extra.celebratedGoals=Array.isArray(state.extra.celebratedGoals)?state.extra.celebratedGoals:[];for(const g of state.extra.goals||[]){if(Number(g.saved)>=Number(g.amount)&&!state.extra.celebratedGoals.includes(g.id)){state.extra.celebratedGoals.push(g.id);save();cloudSaveExtra();confetti();showToast(`Цель «${g.name}» выполнена! 🎉`);break}}}
function confetti(){const box=$("confettiLayer");if(!box)return;const colors=["#6b5be7","#50b889","#f4b942","#e95d75","#5d9cec"];for(let i=0;i<60;i++){const el=document.createElement("i");el.className="confetti-piece";el.style.left=Math.random()*100+"vw";el.style.color=colors[i%colors.length];el.style.setProperty("--x",(Math.random()*180-90)+"px");el.style.animationDelay=Math.random()*.5+"s";box.appendChild(el);setTimeout(()=>el.remove(),2600)}}

function openExpenseModal(){$("expenseAmount").value="";$("expenseDate").value=dateKey(new Date());$("expenseNote").value="";$("expenseModal").classList.remove("hidden")}
async function saveExpense(){const amount=Math.max(0,Number($("expenseAmount").value)||0),category=$("expenseCategory").value,date=$("expenseDate").value||dateKey(new Date()),note=$("expenseNote").value.trim();if(!amount){showToast("Укажи сумму расхода");return}state.extra.expenses.push({id:uid("exp"),amount,category,date,note});save();await cloudSaveExtra();closeModal("expenseModal");renderFinance();showToast("Расход добавлен")}
async function deleteExpense(id){state.extra.expenses=state.extra.expenses.filter(x=>x.id!==id);save();await cloudSaveExtra();renderFinance()}
function renderExpenses(){const list=$("expenseList"),bars=$("expenseBars");if(!list||!bars)return;const es=currentMonthExpenses(new Date()).sort((a,b)=>String(b.date).localeCompare(String(a.date)));if(!es.length){bars.innerHTML="";list.innerHTML='<div class="empty-history">Расходов за этот месяц пока нет.</div>';return}const cats={};es.forEach(x=>cats[x.category]=(cats[x.category]||0)+Number(x.amount||0));const max=Math.max(...Object.values(cats),1);bars.innerHTML=Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,v])=>`<div class="expense-bar-row"><div class="expense-bar-head"><span>${escapeHtml(c)}</span><b>${money(v)}</b></div><div class="expense-track"><i style="width:${Math.round(v/max*100)}%"></i></div></div>`).join("");list.innerHTML=es.slice(0,12).map(x=>`<div class="expense-row"><div><b>${escapeHtml(x.category)}</b><small>${dateText(fromKey(x.date),{day:"numeric",month:"short"})}${x.note?" • "+escapeHtml(x.note):""}</small></div><strong>−${money(x.amount)}</strong><button class="expense-delete" data-exp-del="${x.id}">×</button></div>`).join("");list.querySelectorAll("[data-exp-del]").forEach(b=>b.onclick=()=>deleteExpense(b.dataset.expDel))}

function openTemplateModal(){$("templateName").value="";$("templateCases").value="";$("templateHours").value="11";$("templateBonus").value="0";$("templateHoliday").checked=false;$("templateModal").classList.remove("hidden")}
async function saveTemplate(){const name=$("templateName").value.trim(),cases=Math.max(0,Math.floor(Number($("templateCases").value)||0)),hours=Math.max(0,Number($("templateHours").value)||0),bonus=Math.max(0,Number($("templateBonus").value)||0),holiday=$("templateHoliday").checked;if(!name){showToast("Укажи название шаблона");return}state.extra.templates.push({id:uid("tpl"),name,cases,hours,bonus,holiday});save();await cloudSaveExtra();closeModal("templateModal");renderFinance();showToast("Шаблон сохранён")}
function renderTemplates(){const box=$("templatesList");if(!box)return;const t=state.extra.templates||[];box.innerHTML=t.map(x=>`<button class="template-chip" data-tpl-use="${x.id}">${escapeHtml(x.name)}<small>${integer(x.cases)} шт • ${x.hours||0} ч${x.bonus?" • +"+money(x.bonus):""}</small></button>`).join("");box.querySelectorAll("[data-tpl-use]").forEach(b=>b.onclick=()=>useTemplateToday(b.dataset.tplUse))}
function renderModalTemplates(){const box=$("modalTemplatePills");if(!box)return;box.innerHTML=(state.extra.templates||[]).map(x=>`<button type="button" class="template-chip" data-modal-tpl="${x.id}">${escapeHtml(x.name)}</button>`).join("");box.querySelectorAll("[data-modal-tpl]").forEach(b=>b.onclick=()=>applyTemplateToModal(b.dataset.modalTpl))}
function applyTemplateToModal(id){const t=state.extra.templates.find(x=>x.id===id);if(!t)return;$("modalCases").value=t.cases||0;$("modalHours").value=t.hours||11;$("modalBonus").value=t.bonus||0;$("modalHoliday").checked=!!t.holiday;updateModal()}
function useTemplateToday(id){const k=dateKey(new Date());state.selectedDate=k;openShiftModal(k);applyTemplateToModal(id)}

function exportCsv(){const rows=[["Дата","Чехлы","Праздник","Ставка","Сделка","Премия","Итого","Часы","Доход/час","Комментарий"]];Object.entries(state.shifts).sort().forEach(([k,v])=>{const m=state.extra.shiftMeta?.[k]||{},h=Number(m.hours)||0;rows.push([k,v.cases,v.holiday?"Да":"Нет",v.base,v.piece,Number(m.bonus)||0,v.total,h,h?Number(v.total)/h:"",m.note||""])});const csv="\uFEFF"+rows.map(r=>r.map(v=>'"'+String(v??"").replace(/"/g,'""')+'"').join(";")).join("\n");const blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`my-pay-${dateKey(new Date())}.csv`;a.click();URL.revokeObjectURL(url);showToast("CSV скачан ✓")}
function refreshUndoUI(){const u=state.extra.undo,b=$("undoDeleteBtn");if(!b)return;b.classList.toggle("hidden",!u);if(u)$("undoDeleteMeta").textContent=dateText(fromKey(u.date),{day:"numeric",month:"long"})}
async function undoLastDelete(){const u=state.extra.undo;if(!u?.shift)return;state.shifts[u.date]=u.shift;if(u.meta)state.extra.shiftMeta[u.date]=u.meta;state.extra.undo=null;save();await cloudSaveShift(u.date,u.shift);await cloudSaveExtra();refreshUndoUI();renderCalendar();renderStats();renderFinance();updateHome();showToast("Смена восстановлена ✓")}

$("addExpenseBtn").onclick=openExpenseModal;$("addExpenseTop").onclick=openExpenseModal;$("expenseSave").onclick=saveExpense;$("addGoalBtn").onclick=openGoalModal;$("goalSave").onclick=saveGoal;$("addTemplateBtn").onclick=openTemplateModal;$("templateSave").onclick=saveTemplate;$("exportCsvBtn").onclick=exportCsv;$("themeBtn").onclick=cycleTheme;$("undoDeleteBtn").onclick=undoLastDelete;
flushCloudQueue();

// ===== Telegram bot integration =====
async function openTelegramModal(){
  if(!currentUser){showToast("Сначала войди в аккаунт");return;}
  $("telegramCode").textContent="—"; $("telegramModal").classList.remove("hidden");
}
async function generateTelegramCode(){
  if(!currentUser){showToast("Сначала войди в аккаунт");return;}
  $("telegramGenerateBtn").disabled=true; $("telegramGenerateBtn").textContent="Генерирую…";
  try{
    const {data,error}=await db.rpc("create_telegram_link_code");
    if(error) throw error;
    $("telegramCode").textContent=data||"—";
    showToast("Код готов ✓");
  }catch(e){console.error(e);showToast("Сначала выполни TELEGRAM_SUPABASE.sql");}
  finally{$("telegramGenerateBtn").disabled=false;$("telegramGenerateBtn").textContent="Получить код";}
}
$("telegramBotBtn")?.addEventListener("click",openTelegramModal);
$("telegramGenerateBtn")?.addEventListener("click",generateTelegramCode);
$("telegramHelpBtn")?.addEventListener("click",()=>showToast("Инструкция: telegram_bot_setup.md"));

// Обновляем таймер текущей смены без перезагрузки страницы.
setInterval(()=>{if(typeof updateNextShiftCard==='function')updateNextShiftCard();},60000);
