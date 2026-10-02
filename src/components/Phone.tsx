import { AnimatePresence, motion } from "framer-motion";
import {
  BatteryFull,
  CalendarDays,
  ChevronRight,
  Flame,
  Minus,
  Plus,
  Signal,
  Sparkles,
  Star,
  TrendingUp,
  Trophy,
  Wallet,
  Wifi,
} from "lucide-react";
import { cn } from "../utils/cn";
import { PER_CASE, fixedPart, rub } from "../lib/pay";

export type Screen = "shift" | "calendar" | "stats" | "finance";

const SCREENS: Screen[] = ["shift", "calendar", "stats", "finance"];

export function nextScreen(s: Screen): Screen {
  return SCREENS[(SCREENS.indexOf(s) + 1) % SCREENS.length];
}

/* ================= frame ================= */
export function Phone({
  screen,
  className,
  compact = false,
}: {
  screen: Screen;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative w-[min(300px,calc(100vw-48px))] select-none rounded-[46px] border border-white/15 bg-[#050506] p-[10px] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.06)_inset]",
        compact && "w-[min(260px,calc(100vw-48px))] sm:w-[300px]", 
        className
      )}
    >
      {/* side buttons */}
      <div className="absolute -left-[2px] top-28 h-10 w-[3px] rounded-l-md bg-white/20" />
      <div className="absolute -left-[2px] top-44 h-14 w-[3px] rounded-l-md bg-white/20" />
      <div className="absolute -right-[2px] top-36 h-16 w-[3px] rounded-r-md bg-white/20" />

      <div className={cn("relative h-[600px] overflow-hidden rounded-[38px] bg-[#0e1013]", compact && "h-[520px] sm:h-[600px]")}>
        {/* dynamic island */}
        <div className="absolute left-1/2 top-2.5 z-30 flex h-[26px] w-[100px] -translate-x-1/2 items-center justify-end rounded-full bg-black pr-3">
          <span className="h-2 w-2 rounded-full bg-[#1e2127] ring-1 ring-white/10" />
        </div>

        {/* status bar */}
        <div className="relative z-20 flex items-center justify-between px-6 pt-3.5 text-cream">
          <span className="font-mono text-[12px] font-semibold">19:00</span>
          <div className="flex items-center gap-1.5 text-cream/90">
            <Signal className="h-3.5 w-3.5" />
            <Wifi className="h-3.5 w-3.5" />
            <BatteryFull className="h-4 w-4" />
          </div>
        </div>

        {/* screens */}
        <div className="relative h-[calc(100%-40px)]">
          <AnimatePresence mode="wait">
            <motion.div
              key={screen}
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -18, scale: 0.98 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="h-full px-4 pb-4 pt-2"
            >
              {screen === "shift" && <ShiftScreen />}
              {screen === "calendar" && <CalendarScreen />}
              {screen === "stats" && <StatsScreen />}
              {screen === "finance" && <FinanceScreen />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* home indicator */}
        <div className="absolute bottom-1.5 left-1/2 z-30 h-1 w-28 -translate-x-1/2 rounded-full bg-white/25" />
      </div>
    </div>
  );
}

/* ================= shared bits ================= */
function Head({ kicker, title }: { kicker: string; title: string }) {
  return (
    <div className="mb-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-smoke">
        {kicker}
      </p>
      <h3 className="text-[19px] font-extrabold tracking-tight text-cream">
        {title}
      </h3>
    </div>
  );
}

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/5 bg-[#171a1f] p-3.5",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ================= SHIFT ================= */
function ShiftScreen() {
  const cases = 1000;
  const total = fixedPart(true) + cases * PER_CASE;
  return (
    <div className="flex h-full flex-col gap-2.5">
      <Head kicker="Сегодня, 23 февраля" title="Моя смена" />

      <Card className="relative overflow-hidden border-flame/20 bg-gradient-to-br from-[#23262d] to-[#14161a]">
        <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-flame/15 blur-2xl" />
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fog">
            Итого за смену
          </span>
          <span className="flex items-center gap-1 rounded-full bg-flame/15 px-2 py-0.5 text-[9px] font-bold text-flame">
            <Star className="h-2.5 w-2.5" /> ПРАЗДНИК
          </span>
        </div>
        <p className="mt-1 text-[34px] font-extrabold leading-none tracking-tight text-cream">
          {rub(total)}
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-xl bg-black/25 p-2">
            <p className="text-smoke">Фикс × 2 + обед</p>
            <p className="mt-0.5 font-mono font-bold text-cream">4 600 ₽</p>
          </div>
          <div className="rounded-xl bg-black/25 p-2">
            <p className="text-smoke">Сделка</p>
            <p className="mt-0.5 font-mono font-bold text-flame">1 750 ₽</p>
          </div>
        </div>
      </Card>

      <Card>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fog">
          Упаковано за сегодня
        </p>
        <div className="mt-2 flex items-center justify-between">
          <p className="font-mono text-[26px] font-bold leading-none text-cream">
            {cases}
            <span className="ml-1.5 text-[11px] font-medium text-smoke">чехлов</span>
          </p>
          <div className="flex gap-1.5">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-white/5 text-cream">
              <Minus className="h-3.5 w-3.5" />
            </span>
            <span className="grid h-8 w-8 place-items-center rounded-full bg-flame font-bold text-ink">
              <Plus className="h-4 w-4" />
            </span>
          </div>
        </div>
        <div className="mt-2 flex gap-1.5">
          {["+100", "+500", "+1000"].map((c) => (
            <span
              key={c}
              className="rounded-full bg-white/5 px-2.5 py-1 font-mono text-[9px] font-semibold text-fog"
            >
              {c}
            </span>
          ))}
        </div>
      </Card>

      <Card className="mt-auto">
        <div className="flex items-center justify-between text-[10px]">
          <span className="font-semibold text-fog">Цель месяца</span>
          <span className="font-mono font-bold text-flame">68%</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/40">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: "68%" }}
            transition={{ duration: 1, delay: 0.3, ease: "easeOut" }}
            className="h-full rounded-full bg-gradient-to-r from-flame to-flame-soft"
          />
        </div>
        <div className="mt-2 flex justify-between font-mono text-[9px] text-smoke">
          <span>41 180 ₽</span>
          <span>цель 60 000 ₽</span>
        </div>
      </Card>
    </div>
  );
}

/* ================= CALENDAR ================= */
function CalendarScreen() {
  const worked = [1, 2, 5, 6, 9, 10, 13, 14];
  const scheduled = [3, 4, 7, 8, 11, 12, 15, 16, 19, 20, 23, 24, 27, 28];
  const today = 14;
  return (
    <div className="flex h-full flex-col gap-2.5">
      <Head kicker="График 2/2" title="Календарь" />
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold text-cream">Февраль</p>
          <p className="font-mono text-[9px] text-smoke">2/2 · 14 смен</p>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {["П", "В", "С", "Ч", "П", "С", "В"].map((d, i) => (
            <span
              key={i}
              className="text-center font-mono text-[8px] uppercase text-smoke"
            >
              {d}
            </span>
          ))}
          {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => {
            const isWorked = worked.includes(d);
            const isSched = scheduled.includes(d);
            return (
              <motion.span
                key={d}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.02 * d, duration: 0.25 }}
                className={cn(
                  "grid aspect-square place-items-center rounded-md font-mono text-[9px] font-semibold",
                  isWorked
                    ? d === today
                      ? "bg-flame text-ink ring-2 ring-flame/40 ring-offset-1 ring-offset-[#171a1f]"
                      : "bg-flame/90 text-ink"
                    : isSched
                      ? "bg-white/8 text-fog"
                      : "text-smoke/60"
                )}
              >
                {d}
              </motion.span>
            );
          })}
        </div>
        <div className="mt-2.5 flex gap-3 border-t border-white/5 pt-2 font-mono text-[8px] text-smoke">
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-[3px] bg-flame" /> внесена
          </span>
          <span className="flex items-center gap-1">
            <i className="h-2 w-2 rounded-[3px] bg-white/15" /> по графику
          </span>
        </div>
      </Card>

      <Card className="mt-auto border-flame/25 bg-gradient-to-br from-[#23262d] to-[#14161a]">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-fog">
              Выбранный день
            </p>
            <p className="text-[13px] font-extrabold text-cream">
              23 февраля — праздник
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-flame" />
        </div>
        <div className="mt-2 flex items-center gap-2 font-mono text-[10px]">
          <span className="rounded-md bg-black/30 px-1.5 py-0.5 text-cream">
            1 000 чехлов
          </span>
          <span className="rounded-md bg-flame/15 px-1.5 py-0.5 font-bold text-flame">
            6 350 ₽
          </span>
        </div>
      </Card>
    </div>
  );
}

/* ================= STATS ================= */
function StatsScreen() {
  const bars = [58, 72, 44, 88, 64, 96, 52, 78];
  const max = Math.max(...bars);
  return (
    <div className="flex h-full flex-col gap-2.5">
      <Head kicker="Твоя статистика" title="Результат" />

      <Card className="relative overflow-hidden bg-gradient-to-br from-[#23262d] to-[#14161a]">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fog">
          Заработано за месяц
        </p>
        <p className="mt-1 font-mono text-[30px] font-bold leading-none text-cream">
          62 480 ₽
        </p>
        <div className="mt-2 flex gap-2 font-mono text-[9px] text-smoke">
          <span className="rounded-md bg-black/25 px-1.5 py-0.5">14 смен</span>
          <span className="rounded-md bg-black/25 px-1.5 py-0.5">14 340 чехлов</span>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-fog">
            Динамика по сменам
          </p>
          <span className="flex items-center gap-1 rounded-full bg-flame/15 px-2 py-0.5 text-[8px] font-bold text-flame">
            <TrendingUp className="h-2.5 w-2.5" /> РЕКОРД 96
          </span>
        </div>
        <div className="mt-3 flex h-20 items-end gap-1.5">
          {bars.map((b, i) => (
            <motion.div
              key={i}
              initial={{ height: "6%" }}
              animate={{ height: `${b}%` }}
              transition={{ delay: 0.15 + i * 0.06, duration: 0.5, ease: "easeOut" }}
              className={cn(
                "flex-1 rounded-t-md",
                b === max
                  ? "bg-gradient-to-t from-flame to-flame-soft"
                  : "bg-white/10"
              )}
            />
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-2.5">
        {[
          { icon: Trophy, label: "Рекорд", value: "6 350 ₽" },
          { icon: Flame, label: "Серия", value: "7 смен" },
          { icon: Wallet, label: "Средняя", value: "4 463 ₽" },
          { icon: Sparkles, label: "Сделка", value: "25 095 ₽" },
        ].map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 + i * 0.07 }}
          >
            <Card className="p-3">
              <s.icon className="h-3.5 w-3.5 text-flame" />
              <p className="mt-1.5 font-mono text-[13px] font-bold text-cream">
                {s.value}
              </p>
              <p className="text-[9px] text-smoke">{s.label}</p>
            </Card>
          </motion.div>
        ))}
      </div>

      <Card className="mt-auto flex items-center gap-2.5 border-flame/20">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-flame/15">
          <CalendarDays className="h-4 w-4 text-flame" />
        </span>
        <p className="text-[10px] leading-snug text-fog">
          До цели месяца <b className="text-cream">18 520 ₽</b> — примерно{" "}
          <b className="text-flame">4 смены</b>
        </p>
      </Card>
    </div>
  );
}

/* ================= FINANCE ================= */
function FinanceScreen() {
  return (
    <div className="flex h-full flex-col gap-2.5">
      <Head kicker="Деньги под контролем" title="Финансы" />

      <Card className="relative overflow-hidden bg-gradient-to-br from-[#23262d] to-[#14161a]">
        <div className="absolute -left-6 -top-6 h-24 w-24 rounded-full bg-flame/10 blur-2xl" />
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fog">
          Свободно в этом месяце
        </p>
        <p className="mt-1 font-mono text-[30px] font-bold leading-none text-cream">
          12 480 ₽
        </p>
        <div className="mt-2 flex items-center gap-2 font-mono text-[9px] text-smoke">
          <span className="rounded-md bg-black/25 px-1.5 py-0.5 text-flame">
            ≈ 413 ₽ / день
          </span>
          <span className="rounded-md bg-black/25 px-1.5 py-0.5">остаётся 31%</span>
        </div>
      </Card>

      <div>
        <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-smoke">
          Счета
        </p>
        <div className="flex gap-1.5">
          {[
            { n: "Карта", v: "24 300" },
            { n: "Наличные", v: "3 200" },
            { n: "Вклад", v: "80 000" },
          ].map((a) => (
            <div
              key={a.n}
              className="flex-1 rounded-xl border border-white/5 bg-[#171a1f] p-2"
            >
              <p className="text-[8px] text-smoke">{a.n}</p>
              <p className="mt-0.5 font-mono text-[11px] font-bold text-cream">
                {a.v} ₽
              </p>
            </div>
          ))}
        </div>
      </div>

      <Card>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fog">
          Лимиты категорий
        </p>
        {[
          { n: "Еда", p: 72, v: "7 200 / 10 000 ₽" },
          { n: "Транспорт", p: 34, v: "1 360 / 4 000 ₽" },
          { n: "Развлечения", p: 55, v: "2 750 / 5 000 ₽" },
        ].map((c, i) => (
          <div key={c.n} className="mt-2">
            <div className="flex justify-between text-[9px]">
              <span className="font-semibold text-cream/90">{c.n}</span>
              <span className="font-mono text-smoke">{c.v}</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/40">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${c.p}%` }}
                transition={{ delay: 0.25 + i * 0.12, duration: 0.6 }}
                className={cn(
                  "h-full rounded-full",
                  c.p > 70 ? "bg-flame" : "bg-flame/60"
                )}
              />
            </div>
          </div>
        ))}
      </Card>

      <Card className="mt-auto border-flame/20">
        <div className="flex items-start gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-flame/15">
            <Sparkles className="h-3.5 w-3.5 text-flame" />
          </span>
          <div>
            <p className="text-[10px] font-bold text-cream">Советник</p>
            <p className="mt-0.5 text-[9px] leading-snug text-fog">
              Лимит «Еда» почти выбран. Можно отложить{" "}
              <b className="text-flame">5 000 ₽</b> на копилку «iPhone».
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
