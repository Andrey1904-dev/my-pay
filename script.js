const SUPABASE_URL="https://dyixwxxpjmyycgigcbtx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_NFxxL8WDGpG-ASXo2LasmQ_wskniL6r";
const supabaseClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const DEFAULTS={basePay:2150,holidayPay:4050,casePrice:7,percent:20,scheduleStart:new Date().toISOString().slice(0,10),goal:60000};
const state={settings:load("myPaySettings",DEFAULTS),shifts:load("myPayShifts",{}),calendarDate:new Date(),selectedDate:dateKey(new Date()),modalDate:null};
state.settings.holidayPay=4050;
let currentUser=null,currentProfile=null,authMode="login";

function load(k,f){try{const x=localStorage.getItem(k);return x?JSON.parse(x):{...f}}catch{return{...f}}}
function save(){localStorage.setItem("myPaySettings",JSON.stringify(state.settings));localStorage.setItem("myPayShifts",JSON.stringify(state.shifts))}
function $(id){return document.getElementById(id)}
function money(n){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Math.round((Number(n)||0)*100)/100)+" ₽"}
function integer(n){return new Intl.NumberFormat("ru-RU").format(Number(n)||0)}
function dateKey(d){d=new Date(d);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function fromKey(k){const [y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)}
function dateText(d,opt){return new Intl.DateTimeFormat("ru-RU",opt||{day:"numeric",month:"long"}).format(d)}
function piece(c){return Number(c||0)*Number(state.settings.casePrice)*Number(state.settings.percent)/100}
function monthEntries(d=state.calendarDate){const prefix=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-`;return Object.entries(state.shifts).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>({k,...v}))}
function updateHomeDashboard(){const es=monthEntries(),sum=es.reduce((a,v)=>a+Number(v.total||0),0),cases=es.reduce((a,v)=>a+Number(v.cases||0),0),avg=es.length?sum/es.length:0,goal=Number(state.settings.goal)||0,pct=goal?Math.min(100,Math.round(sum/goal*100)):0;$("homeMonthTotal").textContent=money(sum);$("homeMonthShifts").textContent=integer(es.length);$("homeMonthCases").textContent=integer(cases);$("homeAvgShift").textContent=money(avg);$("homeGoalPercent").textContent=pct+"%";$("homeGoalBar").style.width=pct+"%";let d=new Date();for(let i=0;i<366;i++){if(isWork(d)){const k=dateKey(d),s=state.shifts[k];if(!s||i===0){$("nextShiftDate").textContent=dateText(d,{weekday:"long",day:"numeric",month:"long"});$("nextShiftMeta").textContent=s?money(s.total):"Смена ещё не внесена";break}}d.setDate(d.getDate()+1)}}
function base(h){return h?Number(state.settings.holidayPay):Number(state.settings.basePay)}
function total(c,h){return base(h)+piece(c)}
function isWork(d){const start=fromKey(state.settings.scheduleStart);const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());const diff=Math.floor((t-start)/86400000);return ((diff%4)+4)%4<2}
function plural(n,a,b,c){n=Math.abs(n)%100;const x=n%10;return n>10&&n<20?c:x>1&&x<5?b:x===1?a:c}
function showToast(t){const x=$("toast");x.textContent=t;x.classList.add("show");clearTimeout(showToast.t);showToast.t=setTimeout(()=>x.classList.remove("show"),2200)}
function setStatus(t){$("authStatus").textContent=t||""}

function usernameEmail(username){
  const clean=username.trim().toLowerCase();
  const bytes=new TextEncoder().encode(clean);
  let hex="";for(const b of bytes)hex+=b.toString(16).padStart(2,"0");
  return `u.${hex}@login.my-pay.app`;
}
function validUsername(u){return /^[a-zA-Zа-яА-ЯёЁ0-9._-]{3,32}$/.test(u.trim())}

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
  const username=$("authLogin").value.trim(),password=$("authPassword").value;
  if(!validUsername(username)){setStatus("Логин: 3–32 символа. Можно буквы, цифры, точку, _ и -.");return}
  if(password.length<6){setStatus("Пароль должен быть не короче 6 символов.");return}
  $("authAction").disabled=true;$("authAction").textContent="Секунду…";
  const email=usernameEmail(username);
  try{
    if(authMode==="login"){
      const {data,error}=await supabaseClient.auth.signInWithPassword({email,password});
      if(error){
        if(error.status===0 || /fetch|network|failed to fetch/i.test(error.message||"")) throw new Error("Нет соединения с сервером.");
        throw new Error("Неверный логин или пароль.");
      }
      currentUser=data.user;await afterLogin();setStatus("");
    }else{
      const name=$("authName").value.trim(),p2=$("authPassword2").value;
      if(name.length<2)throw new Error("Напиши имя.");
      if(password!==p2)throw new Error("Пароли не совпадают.");
      const {data,error}=await supabaseClient.auth.signUp({email,password,data:{name:name.trim(),username:username.toLowerCase()}});
      if(error){
        const m=(error.message||"").toLowerCase();
        if(/already registered|already been registered|user already registered/i.test(m)) throw new Error("Этот логин уже занят.");
        if(/email provider is disabled|email signups are disabled/i.test(m)) throw new Error("Регистрация отключена в настройках Supabase. Включи Authentication → Providers → Email.");
        if(/password.*(6|characters)|weak password/i.test(m)) throw new Error("Пароль должен быть минимум 6 символов.");
        if(/fetch|network|failed to fetch/i.test(m)) throw new Error("Нет соединения с сервером.");
        throw new Error(error.message||"Не удалось создать аккаунт.");
      }
      if(!data.user)throw new Error("Не удалось создать аккаунт.");
      if(!data.session)throw new Error("В Supabase включено подтверждение email. Отключи Confirm email в Authentication → Providers → Email.");
      currentUser=data.user;
      await cloudSaveProfile(name,username);await ensureCloudDefaults();await afterLogin();showToast("Аккаунт создан. Добро пожаловать ✨");
    }
  }catch(e){setStatus(e.message||"Что-то пошло не так.")}finally{$("authAction").disabled=false;$("authAction").textContent=authMode==="signup"?"Создать аккаунт":"Войти"}
}
async function afterLogin(){showAuth(false);await cloudLoad();updateProfileUI();updateHome();renderCalendar();renderStats()}

async function cloudLoad(){
  if(!currentUser)return;
  const [a,b,c]=await Promise.all([
    supabaseClient.from("settings").select("*").eq("user_id",currentUser.id).maybeSingle(),
    supabaseClient.from("shifts").select("*").eq("user_id",currentUser.id),
    supabaseClient.from("profiles").select("*").eq("id",currentUser.id).maybeSingle()
  ]);
  if(a.error||b.error||c.error){showToast("Не удалось загрузить данные. Проверь соединение и RLS.");return}
  if(a.data)state.settings={...state.settings,basePay:Number(a.data.base_pay),holidayPay:4050,casePrice:Number(a.data.case_price),percent:Number(a.data.piece_percent),scheduleStart:a.data.schedule_start,goal:Number(a.data.monthly_goal)};
  if(Array.isArray(b.data)){state.shifts={};b.data.forEach(s=>state.shifts[s.work_date]={cases:Number(s.cases),holiday:Boolean(s.is_holiday),base:Number(s.base_pay),piece:Number(s.piece_pay),total:Number(s.total_pay)})}
  currentProfile=c.data||{id:currentUser.id,name:currentUser.user_metadata?.name||""};save()
}
async function ensureCloudDefaults(){
  if(!currentUser)return;
  await supabaseClient.from("settings").upsert({user_id:currentUser.id,base_pay:state.settings.basePay,holiday_pay:state.settings.holidayPay,case_price:state.settings.casePrice,piece_percent:state.settings.percent,schedule_start:state.settings.scheduleStart,monthly_goal:state.settings.goal},{onConflict:"user_id"});
}
async function cloudSaveProfile(name,username){
  if(!currentUser)return;
  const {data,error}=await supabaseClient.from("profiles").upsert({id:currentUser.id,name:name.trim(),username:username.trim().toLowerCase()},{onConflict:"id"}).select().single();
  if(!error)currentProfile=data
}
async function cloudSaveSettings(){
  if(!currentUser)return;
  const {error}=await supabaseClient.from("settings").upsert({user_id:currentUser.id,base_pay:state.settings.basePay,holiday_pay:state.settings.holidayPay,case_price:state.settings.casePrice,piece_percent:state.settings.percent,schedule_start:state.settings.scheduleStart,monthly_goal:state.settings.goal},{onConflict:"user_id"});
  if(error)showToast("Настройки сохранены только на устройстве")
}
async function cloudSaveShift(k,v){
  if(!currentUser)return;
  const {error}=await supabaseClient.from("shifts").upsert({user_id:currentUser.id,work_date:k,cases:v.cases,is_holiday:v.holiday,base_pay:v.base,piece_pay:v.piece,total_pay:v.total},{onConflict:"user_id,work_date"});
  if(error)showToast("Смена сохранена только на устройстве")
}
async function cloudDeleteShift(k){if(currentUser)await supabaseClient.from("shifts").delete().eq("user_id",currentUser.id).eq("work_date",k)}
function updateProfileUI(){
  const n=currentProfile?.name?.trim()||"Мой расчёт";$("profileName").textContent=n;$("profileAvatar").textContent=(n[0]||"₽").toUpperCase();
  const first=n.split(/\s+/)[0];if(currentUser&&first!=="Мой")$("greetingTitle").textContent=isWork(new Date())?`Смена, ${first}`:`Сегодня выходной, ${first}`;
}

function updateHome(){
  updateHomeDashboard();
  const c=Math.max(0,Math.floor(Number($("casesInput").value)||0)),h=$("holidayInput").checked,p=piece(c);
  $("shiftTotal").textContent=money(c?base(h)+p:0);$("homeBase").textContent=money(base(h));$("homePiece").textContent=money(p);$("perCase").textContent=money(Number(state.settings.casePrice)*Number(state.settings.percent)/100);$("perThousand").textContent=money(piece(1000));$("holidayChip").classList.toggle("hidden",!h);
  $("todayLabel").textContent=dateText(new Date(),{weekday:"long",day:"numeric",month:"long"}).toUpperCase();$("todayBadge").textContent=isWork(new Date())?"РАБОТА":"ВЫХОДНОЙ";
  if(!currentUser)$("greetingTitle").textContent=isWork(new Date())?"Моя смена":"Сегодня выходной";
}
async function saveHomeShift(){
  const c=Math.max(0,Math.floor(Number($("casesInput").value)||0)),h=$("holidayInput").checked,k=state.selectedDate||dateKey(new Date()),v={cases:c,holiday:h,base:base(h),piece:piece(c),total:total(c,h)};
  state.shifts[k]=v;save();await cloudSaveShift(k,v);renderCalendar();renderStats();showToast("Смена сохранена ✓")
}
function renderCalendar(){
  const d=state.calendarDate;$("monthTitle").textContent=dateText(d,{month:"long",year:"numeric"});const first=new Date(d.getFullYear(),d.getMonth(),1),offset=(first.getDay()+6)%7,days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),box=$("calendarDays");box.innerHTML="";
  for(let i=0;i<offset;i++){const e=document.createElement("div");e.className="day empty";box.appendChild(e)}
  const today=dateKey(new Date());
  for(let n=1;n<=days;n++){const x=new Date(d.getFullYear(),d.getMonth(),n),k=dateKey(x),b=document.createElement("button");b.className="day "+(isWork(x)?"work ":"")+(state.shifts[k]?.holiday?"holiday ":"")+(state.shifts[k]?"saved ":"")+(k===today?"today ":"")+(k===state.selectedDate?"selected":"");b.textContent=n;
    if(state.shifts[k]){const i=document.createElement("i");i.className="tiny";b.appendChild(i)}b.onclick=()=>selectCalendarDate(k);box.appendChild(b)}
}
function selectCalendarDate(k){state.selectedDate=k;const d=fromKey(k),s=state.shifts[k];$("selectedDate").textContent=dateText(d,{weekday:"long",day:"numeric",month:"long"});$("selectedStatus").textContent=s?(s.holiday?"Праздничная смена":"Сохранённая смена"):(isWork(d)?"Рабочий день":"Выходной");$("selectedMoney").textContent=s?money(s.total):"—";renderCalendar()}
function openShiftModal(k){state.modalDate=k;const s=state.shifts[k];$("modalDate").textContent=dateText(fromKey(k),{weekday:"long",day:"numeric",month:"long"});$("modalCases").value=s?.cases??"";$("modalHoliday").checked=Boolean(s?.holiday);$("modalDelete").style.display=s?"block":"none";updateModal();$("shiftModal").classList.remove("hidden")}
function updateModal(){const c=Math.max(0,Number($("modalCases").value)||0),h=$("modalHoliday").checked;$("modalTotal").textContent=money(c?total(c,h):base(h))}
async function saveModal(){const c=Math.max(0,Math.floor(Number($("modalCases").value)||0)),h=$("modalHoliday").checked,k=state.modalDate,v={cases:c,holiday:h,base:base(h),piece:piece(c),total:total(c,h)};state.shifts[k]=v;save();await cloudSaveShift(k,v);selectCalendarDate(k);renderStats();closeModal("shiftModal");showToast("Смена сохранена ✓")}
async function deleteModal(){if(!state.modalDate)return;const k=state.modalDate;delete state.shifts[k];save();await cloudDeleteShift(k);selectCalendarDate(k);renderStats();closeModal("shiftModal");showToast("Смена удалена")}
function renderStats(){
 const es=monthEntries(),sum=es.reduce((a,v)=>a+v.total,0),bs=es.reduce((a,v)=>a+v.base,0),ps=es.reduce((a,v)=>a+v.piece,0),cs=es.reduce((a,v)=>a+v.cases,0),goal=Number(state.settings.goal)||0,pct=goal?Math.min(100,Math.round(sum/goal*100)):0;
 $("statsMonth").textContent=dateText(state.calendarDate,{month:"long",year:"numeric"});$("monthTotal").textContent=money(sum);$("monthShiftsLabel").textContent=`${integer(es.length)} ${plural(es.length,"смена","смены","смен")}`;$("monthCasesLabel").textContent=`${integer(cs)} чехлов`;$("avgShift").textContent=money(es.length?sum/es.length:0);$("monthPiece").textContent=money(ps);$("monthBase").textContent=money(bs);$("avgCases").textContent=integer(es.length?Math.round(cs/es.length):0);$("goalPercent").textContent=pct+"%";$("goalBar").style.width=pct+"%";$("goalCurrent").textContent=money(sum);$("goalText").textContent=`Цель ${money(goal)}`;
 const list=$("historyList");if(!es.length)list.innerHTML='<div class="empty-history">Пока нет сохранённых смен.</div>';else{es.sort((a,b)=>b.k.localeCompare(a.k));list.innerHTML=es.map(v=>`<div class="history-item"><div class="history-left"><b>${dateText(fromKey(v.k),{day:"numeric",month:"long"})}${v.holiday?" ★":""}</b><small>${integer(v.cases)} чехлов • сделка ${money(v.piece)}</small></div><div class="history-right"><b>${money(v.total)}</b><small>${v.holiday?"Праздник":"Обычная смена"}</small></div></div>`).join("")}
}
function openSettings(){$("settingBase").value=state.settings.basePay;$("settingHoliday").value=state.settings.holidayPay;$("settingPrice").value=state.settings.casePrice;$("settingPercent").value=state.settings.percent;$("settingStart").value=state.settings.scheduleStart;$("settingGoal").value=state.settings.goal;$("settingsModal").classList.remove("hidden")}
async function saveSettings(){state.settings.basePay=Math.max(0,Number($("settingBase").value)||0);state.settings.holidayPay=4050;state.settings.casePrice=Math.max(0,Number($("settingPrice").value)||0);state.settings.percent=Math.min(100,Math.max(0,Number($("settingPercent").value)||0));state.settings.scheduleStart=$("settingStart").value||state.settings.scheduleStart;state.settings.goal=Math.max(0,Number($("settingGoal").value)||0);save();await cloudSaveSettings();updateHome();renderCalendar();renderStats();closeModal("settingsModal");showToast("Настройки обновлены ✓")}
function closeModal(id){$(id).classList.add("hidden")}
function exportData(){const blob=new Blob([JSON.stringify({settings:state.settings,shifts:state.shifts},null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`my-pay-backup-${dateKey(new Date())}.json`;a.click();URL.revokeObjectURL(url);showToast("Резервная копия скачана ✓")}
function importData(file){const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d.settings||!d.shifts)throw 0;state.settings=d.settings;state.shifts=d.shifts;save();updateHome();renderCalendar();renderStats();showToast("Данные восстановлены ✓")}catch{showToast("Не удалось прочитать файл")}};r.readAsText(file)}

document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.screen).classList.add("active");if(b.dataset.screen==="calendarScreen")renderCalendar();if(b.dataset.screen==="statsScreen")renderStats()});
$("casesInput").oninput=updateHome;$("holidayInput").onchange=updateHome;document.querySelectorAll(".step-btn").forEach(b=>b.onclick=()=>{$("casesInput").value=Math.max(0,(Number($("casesInput").value)||0)+Number(b.dataset.step));updateHome()});document.querySelectorAll(".quick-row button").forEach(b=>b.onclick=()=>{$("casesInput").value=Math.max(0,(Number($("casesInput").value)||0)+Number(b.dataset.add));updateHome()});
$("saveShiftBtn").onclick=saveHomeShift;$("settingsBtn").onclick=openSettings;$("openSettingsFromMore").onclick=openSettings;$("prevMonth").onclick=()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()-1,1);renderCalendar();renderStats()};$("nextMonth").onclick=()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()+1,1);renderCalendar();renderStats()};$("editSelectedBtn").onclick=()=>openShiftModal(state.selectedDate);
$("modalCases").oninput=updateModal;$("modalHoliday").onchange=updateModal;$("modalSave").onclick=saveModal;$("modalDelete").onclick=deleteModal;$("settingsSave").onclick=saveSettings;
$("clearMonthBtn").onclick=async()=>{const es=Object.keys(state.shifts).filter(k=>k.startsWith(`${state.calendarDate.getFullYear()}-${String(state.calendarDate.getMonth()+1).padStart(2,"0")}-`));if(!es.length){showToast("В этом месяце нечего удалять");return}if(confirm("Удалить все смены за этот месяц?")){await Promise.all(es.map(cloudDeleteShift));es.forEach(k=>delete state.shifts[k]);save();renderCalendar();renderStats();showToast("Месяц очищен")}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$("exportBtn").onclick=exportData;$("importBtn").onclick=()=>$("importFile").click();$("importFile").onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
let deferredPrompt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e});$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else showToast("Открой меню браузера → «Добавить на экран»")};
$("goLogin").onclick=()=>setAuthMode("login");$("goSignup").onclick=()=>setAuthMode("signup");$("backAuth").onclick=backAuth;$("authAction").onclick=authAction;

async function initCloudAuth(){
 const {data:{session}}=await supabaseClient.auth.getSession();
 if(session?.user){currentUser=session.user;await afterLogin()}else showAuth(true);
 supabaseClient.auth.onAuthStateChange(async(_event,session)=>{if(session?.user&&!currentUser){currentUser=session.user;await afterLogin()}else if(!session){currentUser=null;currentProfile=null;showAuth(true);backAuth()}});
}
state.selectedDate=dateKey(new Date());selectCalendarDate(state.selectedDate);updateHome();renderCalendar();renderStats();initCloudAuth();
$("logoutBtn").onclick=async()=>{await supabaseClient.auth.signOut();showToast("Вы вышли из аккаунта")};
