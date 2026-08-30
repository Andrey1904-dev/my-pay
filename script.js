const DEFAULTS = {
  basePay: 2150,
  casePrice: 7,
  percent: 20,
  scheduleStart: new Date().toISOString().slice(0, 10)
};

const state = {
  settings: load("salarySettings", DEFAULTS),
  shifts: load("salaryShifts", {}),
  calendarDate: new Date(),
  selectedDate: null
};

const $ = id => document.getElementById(id);

function load(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch { return fallback; }
}
function persist() {
  localStorage.setItem("salarySettings", JSON.stringify(state.settings));
  localStorage.setItem("salaryShifts", JSON.stringify(state.shifts));
}
function money(n) {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Math.round((n + Number.EPSILON) * 100) / 100) + " ₽";
}
function num(n) {
  return new Intl.NumberFormat("ru-RU").format(n);
}
function dateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function parseKey(key) {
  const [y,m,d] = key.split("-").map(Number);
  return new Date(y, m-1, d);
}
function formatDate(date, options={day:"numeric", month:"long", year:"numeric"}) {
  return new Intl.DateTimeFormat("ru-RU", options).format(date);
}
function calcPiece(cases) {
  return cases * Number(state.settings.casePrice) * (Number(state.settings.percent) / 100);
}
function calcTotal(cases) {
  return Number(state.settings.basePay) + calcPiece(cases);
}
function isWorkDay(date) {
  const start = parseKey(state.settings.scheduleStart);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diff = Math.floor((target - start) / 86400000);
  if (diff < 0) return ((diff % 4) + 4) % 4 < 2;
  return diff % 4 < 2;
}
function monthShiftEntries(date) {
  const prefix = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-`;
  return Object.entries(state.shifts).filter(([key]) => key.startsWith(prefix));
}

function updateHome() {
  const cases = Math.max(0, Number($("casesInput").value) || 0);
  const piece = calcPiece(cases);
  $("basePay").textContent = money(Number(state.settings.basePay));
  $("piecePay").textContent = money(piece);
  $("shiftTotal").textContent = money(cases > 0 ? calcTotal(cases) : 0);
  $("pricePerCaseText").textContent = money(Number(state.settings.casePrice));
  $("percentText").textContent = `${state.settings.percent}%`;
  const exampleCases = 1000;
  $("formulaExample").textContent =
    `${num(exampleCases)} × ${money(Number(state.settings.casePrice))} × ${state.settings.percent}% = ${money(calcPiece(exampleCases))}`;
  $("shiftHint").textContent = cases > 0
    ? `Сделка ${money(piece)} + ставка ${money(Number(state.settings.basePay))}`
    : "Введи количество чехлов ниже";
}

function saveCurrentShift() {
  const cases = Math.max(0, Math.floor(Number($("casesInput").value) || 0));
  const key = state.selectedDate || dateKey(new Date());
  state.shifts[key] = {
    cases,
    base: Number(state.settings.basePay),
    piece: calcPiece(cases),
    total: calcTotal(cases),
    savedAt: new Date().toISOString()
  };
  persist();
  $("savedMessage").textContent = `Смена за ${formatDate(parseKey(key), {day:"numeric", month:"long"})} сохранена`;
  renderCalendar();
  renderStats();
  setTimeout(() => $("savedMessage").textContent = "", 2500);
}

function renderCalendar() {
  const date = state.calendarDate;
  $("monthTitle").textContent = formatDate(date, {month:"long", year:"numeric"});
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  let offset = first.getDay() - 1;
  if (offset < 0) offset = 6;
  const totalDays = new Date(date.getFullYear(), date.getMonth()+1, 0).getDate();
  const container = $("calendarDays");
  container.innerHTML = "";

  for (let i=0; i<offset; i++) {
    const empty = document.createElement("div");
    empty.className = "day empty";
    container.appendChild(empty);
  }

  const todayKey = dateKey(new Date());
  for (let day=1; day<=totalDays; day++) {
    const d = new Date(date.getFullYear(), date.getMonth(), day);
    const key = dateKey(d);
    const btn = document.createElement("button");
    btn.className = "day " + (isWorkDay(d) ? "work" : "");
    if (state.shifts[key]) btn.className += " saved";
    if (key === todayKey) btn.className += " today";
    if (key === state.selectedDate) btn.className += " selected";
    btn.textContent = day;
    if (state.shifts[key]) {
      const dot = document.createElement("i");
      dot.className = "case-dot";
      btn.appendChild(dot);
    }
    btn.addEventListener("click", () => selectDate(key));
    container.appendChild(btn);
  }
}
function selectDate(key) {
  state.selectedDate = key;
  const d = parseKey(key);
  const shift = state.shifts[key];
  $("selectedDate").textContent = formatDate(d, {weekday:"long", day:"numeric", month:"long"});
  $("selectedDayValue").textContent = shift ? `${num(shift.cases)} чехлов · ${money(shift.total)}` : (isWorkDay(d) ? "Рабочий день" : "Выходной");
  const sameMonth = d.getMonth() === state.calendarDate.getMonth() && d.getFullYear() === state.calendarDate.getFullYear();
  if (!sameMonth) state.calendarDate = new Date(d.getFullYear(), d.getMonth(), 1);
  if (shift) $("casesInput").value = shift.cases;
  else $("casesInput").value = "";
  updateHome();
  renderCalendar();
}
function renderStats() {
  const date = state.calendarDate;
  $("statsMonth").textContent = formatDate(date, {month:"long", year:"numeric"});
  const entries = monthShiftEntries(date).map(([,v]) => v);
  const total = entries.reduce((s,v)=>s+Number(v.total||0),0);
  const base = entries.reduce((s,v)=>s+Number(v.base||0),0);
  const piece = entries.reduce((s,v)=>s+Number(v.piece||0),0);
  const cases = entries.reduce((s,v)=>s+Number(v.cases||0),0);
  $("monthTotal").textContent = money(total);
  $("monthTotal2").textContent = money(total);
  $("monthBase").textContent = money(base);
  $("monthPiece").textContent = money(piece);
  $("monthShifts").textContent = num(entries.length);
  $("monthCases").textContent = num(cases);

  const list = $("shiftHistory");
  const sorted = monthShiftEntries(date).sort(([a],[b]) => b.localeCompare(a));
  if (!sorted.length) {
    list.innerHTML = '<div class="history-empty">Пока нет сохранённых смен.</div>';
  } else {
    list.innerHTML = sorted.map(([key,v]) => `
      <div class="history-item">
        <div>
          <div class="history-date">${formatDate(parseKey(key), {day:"numeric", month:"long"})}</div>
          <div class="history-cases">${num(v.cases)} чехлов · сделка ${money(v.piece)}</div>
        </div>
        <div class="history-pay">${money(v.total)}</div>
      </div>`).join("");
  }
}
function openSettings() {
  $("baseInput").value = state.settings.basePay;
  $("casePriceInput").value = state.settings.casePrice;
  $("percentInput").value = state.settings.percent;
  $("scheduleStartInput").value = state.settings.scheduleStart;
  $("settingsModal").classList.remove("hidden");
}
function closeSettings() { $("settingsModal").classList.add("hidden"); }
function saveSettings() {
  state.settings.basePay = Math.max(0, Number($("baseInput").value) || 0);
  state.settings.casePrice = Math.max(0, Number($("casePriceInput").value) || 0);
  state.settings.percent = Math.min(100, Math.max(0, Number($("percentInput").value) || 0));
  state.settings.scheduleStart = $("scheduleStartInput").value || DEFAULTS.scheduleStart;
  persist();
  updateHome();
  renderCalendar();
  renderStats();
  closeSettings();
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "calendarPanel") renderCalendar();
    if (btn.dataset.tab === "statsPanel") renderStats();
  });
});
$("casesInput").addEventListener("input", updateHome);
document.querySelectorAll(".round-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const step = Number(btn.dataset.step);
    const current = Number($("casesInput").value) || 0;
    $("casesInput").value = Math.max(0, current + step);
    updateHome();
  });
});
$("saveShiftBtn").addEventListener("click", saveCurrentShift);
$("settingsBtn").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("saveSettingsBtn").addEventListener("click", saveSettings);
$("prevMonth").addEventListener("click", () => {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth()-1, 1);
  renderCalendar(); renderStats();
});
$("nextMonth").addEventListener("click", () => {
  state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth()+1, 1);
  renderCalendar(); renderStats();
});
$("clearMonthBtn").addEventListener("click", () => {
  const month = formatDate(state.calendarDate, {month:"long", year:"numeric"});
  if (!confirm(`Удалить все сохранённые смены за ${month}?`)) return;
  monthShiftEntries(state.calendarDate).forEach(([key]) => delete state.shifts[key]);
  persist(); renderCalendar(); renderStats();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeSettings();
});

state.selectedDate = dateKey(new Date());
selectDate(state.selectedDate);
