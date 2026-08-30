
const SUPABASE_URL = "https://dyixwxxpjmyycgigcbtx.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_NFxxL8WDGpG-ASXo2LasmQ_wskniL6r";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
let currentUser = null;
let currentProfile = null;
let syncReady = false;

async function cloudLoad() {
  if (!currentUser) return;
  const [{data: settings}, {data: shifts}, {data: profile}] = await Promise.all([
    supabaseClient.from("settings").select("*").eq("user_id", currentUser.id).maybeSingle(),
    supabaseClient.from("shifts").select("*").eq("user_id", currentUser.id),
    supabaseClient.from("profiles").select("*").eq("id", currentUser.id).maybeSingle()
  ]);
  if (settings) state.settings={...state.settings,basePay:Number(settings.base_pay),holidayPay:Number(settings.holiday_pay),casePrice:Number(settings.case_price),percent:Number(settings.piece_percent),scheduleStart:settings.schedule_start,goal:Number(settings.monthly_goal)};
  if (Array.isArray(shifts)) {
    state.shifts={};
    shifts.forEach(s=>state.shifts[s.work_date]={cases:Number(s.cases),holiday:Boolean(s.is_holiday),base:Number(s.base_pay),piece:Number(s.piece_pay),total:Number(s.total_pay)});
  }
  currentProfile=profile||{id:currentUser.id,name:""};
  save(); syncReady=true; updateProfileUI(); updateHome(); renderCalendar(); renderStats();
}

async function ensureCloudDefaults() {
  if (!currentUser) return;
  await supabaseClient.from("settings").upsert({
    user_id:currentUser.id,base_pay:Number(state.settings.basePay),holiday_pay:Number(state.settings.holidayPay),
    case_price:Number(state.settings.casePrice),piece_percent:Number(state.settings.percent),
    schedule_start:state.settings.scheduleStart,monthly_goal:Number(state.settings.goal)
  },{onConflict:"user_id"});
}
async function cloudSaveSettings() {
  if (!currentUser) return;
  const {error}=await supabaseClient.from("settings").upsert({
    user_id:currentUser.id,base_pay:Number(state.settings.basePay),holiday_pay:Number(state.settings.holidayPay),
    case_price:Number(state.settings.casePrice),piece_percent:Number(state.settings.percent),
    schedule_start:state.settings.scheduleStart,monthly_goal:Number(state.settings.goal)
  },{onConflict:"user_id"});
  if(error) showToast("Не удалось сохранить настройки");
}
async function cloudSaveShift(k,value) {
  if (!currentUser) return;
  const {error}=await supabaseClient.from("shifts").upsert({
    user_id:currentUser.id,work_date:k,cases:Number(value.cases),is_holiday:Boolean(value.holiday),
    base_pay:Number(value.base),piece_pay:Number(value.piece),total_pay:Number(value.total)
  },{onConflict:"user_id,work_date"});
  if(error) showToast("Смена сохранена только на устройстве");
}
async function cloudDeleteShift(k) {
  if (!currentUser) return;
  await supabaseClient.from("shifts").delete().eq("user_id",currentUser.id).eq("work_date",k);
}
async function cloudSaveProfile(name) {
  if(!currentUser)return;
  const {data,error}=await supabaseClient.from("profiles").upsert({id:currentUser.id,name:name.trim()},{onConflict:"id"}).select().single();
  if(!error) currentProfile=data;
}
function updateProfileUI(){
  const name=currentProfile?.name?.trim()||"Мой расчёт";
  $("profileName").textContent=name;
  $("profileEmail").textContent=currentUser?.email||"Облачная синхронизация";
  $("profileAvatar").textContent=(name[0]||"₽").toUpperCase();
  const first=name.split(/\s+/)[0];
  if(currentUser && first!=="Мой") $("greetingTitle").textContent=isWork(new Date())?`Смена, ${first}`:`Сегодня выходной, ${first}`;
}
let authMode="login";
function showAuth(show){$("authModal").classList.toggle("hidden",!show)}
function setAuthMode(mode){
  authMode=mode;
  const login=mode==="login";
  $("tabLogin").classList.toggle("active",login);$("tabSignup").classList.toggle("active",!login);
  $("signupNameWrap").classList.toggle("hidden",login);$("confirmPasswordWrap").classList.toggle("hidden",login);$("termsWrap").classList.toggle("hidden",login);
  $("forgotBtn").classList.toggle("hidden",!login);
  $("authAction").textContent=login?"Войти":"Создать аккаунт";
  $("authOverline").textContent=login?"ЛИЧНЫЙ КАБИНЕТ":"НОВЫЙ АККАУНТ";
  $("authTitle").textContent=login?"Твоя зарплата. Всегда с тобой.":"Создай свой личный кабинет";
  $("authSubtitle").textContent=login?"Войди, чтобы открыть смены, календарь и статистику.":"Две минуты сейчас, и больше не придётся бояться потерять данные при смене телефона.";
  $("authStatus").textContent="";
}
async function authAction(){
  const email=$("authEmail").value.trim(),password=$("authPassword").value;
  if(!email||!/^\S+@\S+\.\S+$/.test(email)){ $("authStatus").textContent="Проверь email.";return }
  if(password.length<6){$("authStatus").textContent="Пароль должен быть не короче 6 символов.";return}
  $("authAction").disabled=true;$("authAction").textContent="Секунду…";
  if(authMode==="login"){
    const {error}=await supabaseClient.auth.signInWithPassword({email,password});
    if(error)$("authStatus").textContent="Не получилось войти. Проверь email и пароль.";
  }else{
    const name=$("authName").value.trim(),p2=$("authPassword2").value;
    if(name.length<2){$("authStatus").textContent="Напиши имя, чтобы приложение могло обращаться к тебе.";$("authAction").disabled=false;$("authAction").textContent="Создать аккаунт";return}
    if(password!==p2){$("authStatus").textContent="Пароли не совпадают.";$("authAction").disabled=false;$("authAction").textContent="Создать аккаунт";return}
    if(!$("authTerms").checked){$("authStatus").textContent="Нужно подтвердить согласие с хранением данных.";$("authAction").disabled=false;$("authAction").textContent="Создать аккаунт";return}
    const {data,error}=await supabaseClient.auth.signUp({email,password,data:{name}});
    if(error)$("authStatus").textContent="Не удалось создать аккаунт. Возможно, этот email уже зарегистрирован.";
    else if(data.session){currentUser=data.user;await cloudSaveProfile(name);await ensureCloudDefaults();await cloudLoad();showAuth(false);showToast("Добро пожаловать ✨")}
    else $("authStatus").textContent="Аккаунт создан. Проверь почту и перейди по ссылке подтверждения.";
  }
  $("authAction").disabled=false;$("authAction").textContent=authMode==="login"?"Войти":"Создать аккаунт";
}
async function forgotPassword(){
  const email=$("authEmail").value.trim();
  if(!email){$("authStatus").textContent="Сначала введи email.";return}
  const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
  $("authStatus").textContent=error?"Не удалось отправить письмо. Проверь email.":"Письмо для восстановления отправлено.";
}
function closeModal(id){$(id).classList.add("hidden")}
function plural(n,a,b,c){n=Math.abs(n)%100;const x=n%10;return n>10&&n<20?c:x>1&&x<5?b:x===1?a:c}
function exportData(){const blob=new Blob([JSON.stringify({settings:state.settings,shifts:state.shifts},null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`my-pay-backup-${dateKey(new Date())}.json`;a.click();URL.revokeObjectURL(url);showToast("Резервная копия скачана ✓")}
function importData(file){const r=new FileReader();r.onload=()=>{try{const d=JSON.parse(r.result);if(!d.settings||!d.shifts)throw 0;state.settings=d.settings;state.shifts=d.shifts;save();updateHome();renderCalendar();renderStats();showToast("Данные восстановлены ✓")}catch{showToast("Не удалось прочитать файл")}};r.readAsText(file)}

document.querySelectorAll(".nav-item").forEach(b=>b.onclick=()=>{document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".screen").forEach(x=>x.classList.remove("active"));b.classList.add("active");$(b.dataset.screen).classList.add("active");if(b.dataset.screen==="calendarScreen")renderCalendar();if(b.dataset.screen==="statsScreen")renderStats()});
$("casesInput").oninput=updateHome;$("holidayInput").onchange=updateHome;
document.querySelectorAll(".step-btn").forEach(b=>b.onclick=()=>{$("casesInput").value=Math.max(0,(Number($("casesInput").value)||0)+Number(b.dataset.step));updateHome()});
document.querySelectorAll(".quick-row button").forEach(b=>b.onclick=()=>{$("casesInput").value=Math.max(0,(Number($("casesInput").value)||0)+Number(b.dataset.add));updateHome()});
$("saveShiftBtn").onclick=saveHomeShift;$("settingsBtn").onclick=openSettings;$("openSettingsFromMore").onclick=openSettings;
$("prevMonth").onclick=()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()-1,1);renderCalendar();renderStats()};
$("nextMonth").onclick=()=>{state.calendarDate=new Date(state.calendarDate.getFullYear(),state.calendarDate.getMonth()+1,1);renderCalendar();renderStats()};
$("editSelectedBtn").onclick=()=>openShiftModal(state.selectedDate);
$("modalCases").oninput=updateModal;$("modalHoliday").onchange=updateModal;$("modalSave").onclick=saveModal;$("modalDelete").onclick=deleteModal;
$("settingsSave").onclick=saveSettings;$("clearMonthBtn").onclick=()=>{const es=monthEntries(state.calendarDate);if(!es.length){showToast("В этом месяце нечего удалять");return}if(confirm("Удалить все смены за этот месяц?")){Promise.all(es.map(([k])=>cloudDeleteShift(k)));es.forEach(([k])=>delete state.shifts[k]);save();renderCalendar();renderStats();showToast("Месяц очищен")}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$("exportBtn").onclick=exportData;$("importBtn").onclick=()=>$("importFile").click();$("importFile").onchange=e=>e.target.files[0]&&importData(e.target.files[0]);

let deferredPrompt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e});
$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else showToast("Открой меню браузера → «Добавить на экран»")};

state.selectedDate=dateKey(new Date());selectCalendarDate(state.selectedDate);updateHome();renderCalendar();renderStats();

async function initCloudAuth(){
  $("tabLogin").onclick=()=>setAuthMode("login");$("tabSignup").onclick=()=>setAuthMode("signup");
  $("authAction").onclick=authAction;$("forgotBtn").onclick=forgotPassword;
  const {data:{session}}=await supabaseClient.auth.getSession();
  if(session?.user){currentUser=session.user;showAuth(false);await cloudLoad();if(!currentProfile?.name&&session.user.user_metadata?.name){await cloudSaveProfile(session.user.user_metadata.name);updateProfileUI()}}
  else showAuth(true);
  supabaseClient.auth.onAuthStateChange(async(_event,session)=>{
    currentUser=session?.user||null;
    if(currentUser){showAuth(false);await cloudLoad();}
    else{currentProfile=null;showAuth(true);setAuthMode("login")}
  });
}
initCloudAuth();

$("logoutBtn").onclick=async()=>{await supabaseClient.auth.signOut();currentUser=null;showToast("Вы вышли из аккаунта")};
