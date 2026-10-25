// Personal greeting only: salary calculations and stored shifts are never changed here.
import { $, dateKey, dateText, fromKey, plural, workNow } from './utils.js';
import { state } from './state.js';
import { isWork } from './pay.js';
import { currentProfile, currentUser, greetingPending } from './cloud.js';

export function cleanDisplayName(value) {
  if (typeof value !== 'string') return '';
  const name = value.replace(/\s+/gu, ' ').trim().slice(0, 80);
  return /^[^\s@]+@[^\s@]+$/.test(name) ? '' : name;
}

export function greetingName() {
  const meta = currentUser?.user_metadata || {};
  return [state.extra.displayName, currentProfile?.name, meta.display_name, meta.full_name, meta.name,
    [meta.given_name || meta.first_name, meta.family_name || meta.last_name].filter(Boolean).join(' ')]
    .map(cleanDisplayName).find(Boolean) || '';
}

export function greetingWorkDay(day) {
  const key = dateKey(day), override = state.extra.workdayOverrides[key];
  if (typeof override === 'boolean') return override;
  return !!state.shifts[key] || isWork(day);
}

export function consecutiveWorkdays(day = workNow()) {
  let count = 0;
  const cursor = fromKey(dateKey(day));
  while (greetingWorkDay(cursor)) {
    count++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

const ordinals = ['', 'первая', 'вторая', 'третья', 'четвёртая', 'пятая', 'шестая', 'седьмая', 'восьмая', 'девятая', 'десятая', 'одиннадцатая', 'двенадцатая', 'тринадцатая', 'четырнадцатая', 'пятнадцатая', 'шестнадцатая', 'семнадцатая', 'восемнадцатая', 'девятнадцатая'];
const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
const cardinalUnits = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять', 'десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
function cardinal(n, feminine = false) {
  const rest = n % 100;
  const unit = rest < 20 ? rest : rest % 10;
  return [hundreds[Math.floor(n / 100)], rest >= 20 ? tens[Math.floor(rest / 10)] : '',
    feminine && unit === 1 ? 'одна' : feminine && unit === 2 ? 'две' : cardinalUnits[unit]].filter(Boolean).join(' ');
}
function compoundPrefix(n) {
  const units = ['', 'одно', 'двух', 'трёх', 'четырёх', 'пяти', 'шести', 'семи', 'восьми', 'девяти', 'десяти', 'одиннадцати', 'двенадцати', 'тринадцати', 'четырнадцати', 'пятнадцати', 'шестнадцати', 'семнадцати', 'восемнадцати', 'девятнадцати'];
  const ts = ['', '', 'двадцати', 'тридцати', 'сорока', 'пятидесяти', 'шестидесяти', 'семидесяти', 'восьмидесяти', 'девяноста'];
  const hs = ['', 'сто', 'двухсот', 'трёхсот', 'четырёхсот', 'пятисот', 'шестисот', 'семисот', 'восьмисот', 'девятисот'];
  const rest = n % 100;
  return hs[Math.floor(n / 100)] + (rest < 20 ? units[rest] : ts[Math.floor(rest / 10)] + units[rest % 10]);
}
export function ordinalFeminine(n) {
  if (n < 20) return ordinals[n];
  for (const [scale, names, ending] of [[1e9, ['миллиард', 'миллиарда', 'миллиардов'], 'миллиардная'], [1e6, ['миллион', 'миллиона', 'миллионов'], 'миллионная'], [1000, ['тысяча', 'тысячи', 'тысяч'], 'тысячная']]) {
    if (n < scale) continue;
    const q = Math.floor(n / scale), rest = n % scale;
    return rest ? `${cardinal(q, scale === 1000)} ${plural(q, ...names)} ${ordinalFeminine(rest)}` : `${q === 1 ? '' : compoundPrefix(q)}${ending}`;
  }
  if (n % 100 === 0) return ['', 'сотая', 'двухсотая', 'трёхсотая', 'четырёхсотая', 'пятисотая', 'шестисотая', 'семисотая', 'восьмисотая', 'девятисотая'][n / 100];
  if (n >= 100) return `${hundreds[Math.floor(n / 100)]} ${ordinalFeminine(n % 100)}`;
  return n % 10 ? `${tens[Math.floor(n / 10)]} ${ordinals[n % 10]}` : ['', '', 'двадцатая', 'тридцатая', 'сороковая', 'пятидесятая', 'шестидесятая', 'семидесятая', 'восьмидесятая', 'девяностая'][n / 10];
}

export function greetingMessage(day = workNow()) {
  const count = consecutiveWorkdays(day);
  return count ? `Это твоя ${ordinalFeminine(count)} смена ${count === 1 ? '😭' : count === 2 ? '🥺' : '💀'}` : 'Сегодня отдыхаешь, заслуженный отдых 😴';
}

export function renderGreeting(day = workNow()) {
  const text = (id, value) => { const node = $(id); if (node.textContent !== value) node.textContent = value; };
  text('todayLabel', 'Сегодня, ' + dateText(day, { day: 'numeric', month: 'long' }));
  text('greetingTitle', greetingPending ? 'Привет ❤️' : `${greetingName() || 'Привет'} ❤️`);
  text('greetingMessage', greetingPending ? '' : greetingMessage(day));
  $('greetingMessage').setAttribute('aria-busy', String(greetingPending));
}

export function bindGreetingClock() {
  let timer;
  const refresh = () => {
    clearTimeout(timer);
    renderGreeting();
    const now = workNow();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(refresh, midnight - now + 50);
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('pageshow', refresh);
  window.addEventListener('focus', refresh);
  refresh();
}
