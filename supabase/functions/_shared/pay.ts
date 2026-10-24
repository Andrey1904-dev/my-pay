export const PAY = {
  base: 1900, // выход за смену
  lunch: 200, // доплата за обед
  district: 1.15, // районный коэффициент Екатеринбурга
  caseRate: 7, // ₽ за чехол
  casePercent: 25, // % от ставки чехла
  holidayBase: 3800, // 1900 × 2 — праздничный выход
};

/** Цена одного чехла: 7 ₽ × 25% = 1,75 ₽ (без районного коэффициента) */
export const PER_CASE = PAY.caseRate * (PAY.casePercent / 100);

/** Фиксированная часть смены с районным коэффициентом */
export function fixedPart(holiday = false) {
  return ((holiday ? PAY.holidayBase : PAY.base) + PAY.lunch) * PAY.district;
}

/** Итог смены: ставка + чехлы × цена × процент + районный коэффициент на фикс */
export function shiftTotal(cases: number, holiday = false) {
  return fixedPart(holiday) + cases * PER_CASE;
}

export function shiftBreakdown(cases: number, holiday = false) {
  const base = holiday ? PAY.holidayBase : PAY.base;
  const withLunch = base + PAY.lunch;
  const fixed = withLunch * PAY.district;
  const piece = cases * PER_CASE;
  return {
    base,
    lunch: PAY.lunch,
    districtBonus: fixed - withLunch,
    fixed,
    piece,
    total: fixed + piece,
  };
}

const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const rub = (n: number) => `${nf0.format(Math.round(n))} ₽`;
export const rubSmart = (n: number) =>
  `${(Number.isInteger(n) ? nf0 : nf2).format(n)} ₽`;
export const num = (n: number) => nf0.format(n);
