const DEFAULTS={basePay:2150,holidayPay:4050,casePrice:7,percent:20,scheduleStart:new Date().toISOString().slice(0,10),goal:60000};
const state={settings:load("myPaySettings",DEFAULTS),shifts:load("myPayShifts",{}),calendarDate:new Date(),selectedDate:dateKey(new Date()),modalDate:null};

function load(k,f){try{const x=localStorage.getItem(k);return x?JSON.parse(x):{...f}}catch{return{...f}}}
function save(){localStorage.setItem("myPaySettings",JSON.stringify(state.settings));localStorage.setItem("myPayShifts",JSON.stringify(state.shifts))}
function $(id){return document.getElementById(id)}
function money(n){return new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(Math.round((Number(n)+Number.EPSILON)*100)/100)+" ₽"}
function integer(n){return new Intl.NumberFormat("ru-RU").format(Number(n)||0)}
function dateKey(d){d=new Date(d);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
function fromKey(k){const [y,m,d]=k.split("-").map(Number);return new Date(y,m-1,d)}
function dateText(d,opt={day:"numeric",month:"long"}){return new Intl.DateTimeFormat("ru-RU",opt).format(d)}
function piece(c){return Number(c||0)*Number(state.settings.casePrice)*Number(state.settings.percent)/100}
function base(holiday){return holiday?Number(state.settings.holidayPay):Number(state.settings.basePay)}
function total(c,holiday){return base(holiday)+piece(c)}
function isWork(d){const start=fromKey(state.settings.scheduleStart);const t=new Date(d.getFullYear(),d.getMonth(),d.getDate());const diff=Math.floor((t-start)/86400000);return ((diff%4)+4)%4<2}
function monthEntries(d){const p=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-`;return Object.entries(state.shifts).filter(([k])=>k.startsWith(p))}
function showToast(text){const t=$("toast");t.textContent=text;t.classList.add("show");clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>t.classList.remove("show"),2200)}

function updateHome(){
 const c=Math.max(0,Math.floor(Number($("casesInput").value)||0)),h=$("holidayInput").checked,b=base(h),p=piece(c);
 $("shiftTotal").textContent=money(c?b+p:0);$("homeBase").textContent=money(b);$("homePiece").textContent=money(p);
 $("perCase").textContent=money(Number(state.settings.casePrice)*Number(state.settings.percent)/100);
 $("perThousand").textContent=money(piece(1000));
 $("holidayChip").classList.toggle("hidden",!h);
 $("todayLabel").textContent=dateText(new Date(),{weekday:"long",day:"numeric",month:"long"}).toUpperCase();
 $("todayBadge").textContent=isWork(new Date())?"РАБОТА":"ВЫХОДНОЙ";
 $("greetingTitle").textContent=isWork(new Date())?"Моя смена":"Сегодня выходной";
}
function saveHomeShift(){
 const c=Math.max(0,Math.floor(Number($("casesInput").value)||0)),h=$("holidayInput").checked,k=state.selectedDate||dateKey(new Date());
 state.shifts[k]={cases:c,holiday:h,base:base(h),piece:piece(c),total:total(c,h)};
 save();renderCalendar();renderStats();showToast("Смена сохранена ✓");$("saveNote").textContent=`Сохранено: ${dateText(fromKey(k),{day:"numeric",month:"long"})}`;setTimeout(()=>$("saveNote").textContent="",2500)
}
function renderCalendar(){
 const d=state.calendarDate;$("monthTitle").textContent=dateText(d,{month:"long",year:"numeric"});
 const first=new Date(d.getFullYear(),d.getMonth(),1),offset=(first.getDay()+6)%7,days=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(),box=$("calendarDays");box.innerHTML="";
 for(let i=0;i<offset;i++){const e=document.createElement("div");e.className="day empty";box.appendChild(e)}
 const today=dateKey(new Date());
 for(let n=1;n<=days;n++){const x=new Date(d.getFullYear(),d.getMonth(),n),k=dateKey(x),b=document.createElement("button");b.className="day "+(isWork(x)?"work ":"")+(state.shifts[k]?"saved ":"")+(k===today?"today ":"")+(k===state.selectedDate?"selected":"");b.textContent=n;
 if(state.shifts[k]){const i=document.createElement("i");i.className="tiny";b.appendChild(i)}b.onclick=()=>selectCalendarDate(k);box.appendChild(b)}
}
function selectCalendarDate(k){
 state.selectedDate=k;const d=fromKey(k),s=state.shifts[k];$("selectedDate").textContent=dateText(d,{weekday:"long",day:"numeric",month:"long"});$("selectedStatus").textContent=s?(s.holiday?"Праздничная смена":"Сохранённая смена"):(isWork(d)?"Рабочий день":"Выходной");$("selectedMoney").textContent=s?money(s.total):"—";renderCalendar()
}
function openShiftModal(k){
 state.modalDate=k;const d=fromKey(k),s=state.shifts[k];$("modalDate").textContent=dateText(d,{weekday:"long",day:"numeric",month:"long"});$("modalCases").value=s?.cases??"";$("modalHoliday").checked=Boolean(s?.holiday);$("modalDelete").style.display=s?"block":"none";updateModal();$("shiftModal").classList.remove("hidden")
}
function updateModal(){const c=Math.max(0,Number($("modalCases").value)||0),h=$("modalHoliday").checked;$("modalTotal").textContent=money(c?total(c,h):base(h))}
function saveModal(){const c=Math.max(0,Math.floor(Number($("modalCases").value)||0)),h=$("modalHoliday").checked,k=state.modalDate;state.shifts[k]={cases:c,holiday:h,base:base(h),piece:piece(c),total:total(c,h)};save();selectCalendarDate(k);renderStats();closeModal("shiftModal");showToast("Смена сохранена ✓")}
function deleteModal(){if(!state.modalDate)return;delete state.shifts[state.modalDate];save();selectCalendarDate(state.modalDate);renderStats();closeModal("shiftModal");showToast("Смена удалена")}
function renderStats(){
 const es=monthEntries(state.calendarDate).map(([k,v])=>({k,...v})),sum=es.reduce((a,v)=>a+Number(v.total),0),baseSum=es.reduce((a,v)=>a+Number(v.base),0),pieceSum=es.reduce((a,v)=>a+Number(v.piece),0),cases=es.reduce((a,v)=>a+Number(v.cases),0),goal=Number(state.settings.goal)||0;
 $("statsMonth").textContent=dateText(state.calendarDate,{month:"long",year:"numeric"});$("monthTotal").textContent=money(sum);$("monthShiftsLabel").textContent=`${integer(es.length)} ${plural(es.length,"смена","смены","смен")}`;$("monthCasesLabel").textContent=`${integer(cases)} чехлов`;$("avgShift").textContent=money(es.length?sum/es.length:0);$("monthPiece").textContent=money(pieceSum);$("monthBase").textContent=money(baseSum);$("avgCases").textContent=integer(es.length?Math.round(cases/es.length):0);
 const pct=goal?Math.min(100,Math.round(sum/goal*100)):0;$("goalPercent").textContent=pct+"%";$("goalBar").style.width=pct+"%";$("goalCurrent").textContent=money(sum);$("goalText").textContent=`Цель ${money(goal)}`;
 const list=$("historyList");if(!es.length){list.innerHTML='<div class="empty-history">Пока нет сохранённых смен.</div>'}else{es.sort((a,b)=>b.k.localeCompare(a.k));list.innerHTML=es.map(v=>`<div class="history-item"><div class="history-left"><b>${dateText(fromKey(v.k),{day:"numeric",month:"long"})}${v.holiday?" ★":""}</b><small>${integer(v.cases)} чехлов • сделка ${money(v.piece)}</small></div><div class="history-right"><b>${money(v.total)}</b><small>${v.holiday?"Праздник":"Обычная смена"}</small></div></div>`).join("")}
}
function openSettings(){ $("settingBase").value=state.settings.basePay;$("settingHoliday").value=state.settings.holidayPay;$("settingPrice").value=state.settings.casePrice;$("settingPercent").value=state.settings.percent;$("settingStart").value=state.settings.scheduleStart;$("settingGoal").value=state.settings.goal;$("settingsModal").classList.remove("hidden")}
function saveSettings(){state.settings.basePay=Math.max(0,Number($("settingBase").value)||0);state.settings.holidayPay=Math.max(0,Number($("settingHoliday").value)||0);state.settings.casePrice=Math.max(0,Number($("settingPrice").value)||0);state.settings.percent=Math.min(100,Math.max(0,Number($("settingPercent").value)||0));state.settings.scheduleStart=$("settingStart").value||state.settings.scheduleStart;state.settings.goal=Math.max(0,Number($("settingGoal").value)||0);save();updateHome();renderCalendar();renderStats();closeModal("settingsModal");showToast("Настройки обновлены ✓")}
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
$("settingsSave").onclick=saveSettings;$("clearMonthBtn").onclick=()=>{const es=monthEntries(state.calendarDate);if(!es.length){showToast("В этом месяце нечего удалять");return}if(confirm("Удалить все смены за этот месяц?")){es.forEach(([k])=>delete state.shifts[k]);save();renderCalendar();renderStats();showToast("Месяц очищен")}};
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$("exportBtn").onclick=exportData;$("importBtn").onclick=()=>$("importFile").click();$("importFile").onchange=e=>e.target.files[0]&&importData(e.target.files[0]);

let deferredPrompt=null;window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e});
$("installBtn").onclick=async()=>{if(deferredPrompt){deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null}else showToast("Открой меню браузера → «Добавить на экран»")};

state.selectedDate=dateKey(new Date());selectCalendarDate(state.selectedDate);updateHome();renderCalendar();renderStats();
