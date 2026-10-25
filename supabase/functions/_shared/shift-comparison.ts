import { money, round2 } from "./mypay.ts";

/** Compare saved money at the same kopeck precision used by the pay model. */
export function shiftComparisonText(current: number, previous: number | null): string {
  if (previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return "";
  const currentKopecks = Math.round(round2(current) * 100);
  const previousKopecks = Math.round(round2(previous) * 100);
  const difference = currentKopecks - previousKopecks;
  if (![currentKopecks, previousKopecks, difference].every(Number.isSafeInteger)) return "";
  if (difference === 0) return "🟰 Столько же, сколько в прошлую смену!";
  return `${difference > 0 ? "📈" : "📉"} На ${money(Math.abs(difference) / 100)} ${difference > 0 ? "больше" : "меньше"} прошлой смены!`;
}
