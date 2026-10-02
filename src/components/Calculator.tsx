import { useEffect, useState } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";
import { Plus, Sparkles, Star } from "lucide-react";
import { SectionHead, Reveal, Toggle } from "./ui";
import { PER_CASE, PAY, shiftBreakdown, rub } from "../lib/pay";
import { cn } from "../utils/cn";

const MAX_CASES = 3000;

export function Calculator() {
  const [cases, setCases] = useState(1000);
  const [holiday, setHoliday] = useState(false);
  const b = shiftBreakdown(cases, holiday);

  const mv = useMotionValue(b.total);
  const spring = useSpring(mv, { stiffness: 90, damping: 20 });
  const display = useTransform(spring, (v) => rub(v));
  useEffect(() => {
    mv.set(b.total);
  }, [b.total, mv]);

  const fill = (cases / MAX_CASES) * 100;

  const rows = [
    {
      label: holiday ? "Праздничный выход" : "Выход за смену",
      value: b.base,
      note: holiday ? "ставка × 2" : "ставка",
    },
    { label: "Доплата за обед", value: b.lunch, note: "фикс" },
    {
      label: "Районный коэффициент",
      value: b.districtBonus,
      note: "× 1,15 · Екатеринбург",
    },
    {
      label: "Сделка за чехлы",
      value: b.piece,
      note: `${cases} × ${PER_CASE.toLocaleString("ru-RU")} ₽ · без коэффициента`,
      flame: true,
    },
  ];
  const maxRow = Math.max(...rows.map((r) => r.value), 1);

  return (
    <section id="calc" className="relative py-16 sm:py-20 md:py-36">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2 rounded-full bg-flame/6 blur-[140px]" />
      <div className="mx-auto max-w-7xl px-4 sm:px-5 md:px-8">
        <SectionHead
          index="01"
          kicker="Калькулятор"
          title={
            <>
              Сколько принесёт <span className="text-outline-flame">смена</span>
            </>
          }
        />
        <Reveal delay={0.1}>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-fog">
            Двигай ползунок — цифры считаются по реальной модели оплаты
            CASE.PLACE. Без округлений «на пальцах»: районный коэффициент
            только на фикс, сделка — чистыми.
          </p>
        </Reveal>

        <div className="mt-8 grid gap-4 sm:mt-12 sm:gap-5 lg:grid-cols-[1fr_1fr]">
          {/* ---- controls ---- */}
          <Reveal delay={0.15}>
            <div className="flex h-full flex-col rounded-[28px] border border-line bg-coal p-5 sm:p-6 md:p-8">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fog">
                    Чехлов за смену
                  </p>
                  <p className="mt-1 font-mono text-[44px] font-bold leading-none text-cream tabular-nums md:text-[56px]">
                    {cases}
                  </p>
                </div>
                <Toggle
                  on={holiday}
                  onChange={setHoliday}
                />
              </div>
              <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-fog">
                <Star className={cn("h-3 w-3", holiday ? "text-flame" : "text-smoke")} />
                {holiday ? "праздничная смена" : "обычная смена"}
              </p>

              <input
                type="range"
                min={0}
                max={MAX_CASES}
                step={25}
                value={cases}
                onChange={(e) => setCases(Number(e.target.value))}
                className="pay-range mt-8"
                style={{ ["--fill" as string]: `${fill}%` }}
                aria-label="Чехлов за смену"
              />
              <div className="flex justify-between font-mono text-[10px] text-smoke">
                <span>0</span>
                <span>1 500</span>
                <span>3 000</span>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {[500, 1000, 1500, 2000].map((v) => (
                  <button
                    key={v}
                    onClick={() => setCases(v)}
                    className={cn(
                      "flex min-h-11 items-center gap-1 rounded-full border px-3 py-2 font-mono text-[12px] font-semibold transition-all duration-300 sm:px-4", 
                      cases === v
                        ? "border-flame bg-flame text-ink"
                        : "border-line text-fog hover:border-flame/50 hover:text-cream"
                    )}
                  >
                    <Plus className="h-3 w-3" />
                    {v.toLocaleString("ru-RU")}
                  </button>
                ))}
              </div>

              <div className="mt-auto pt-8">
                <div className="flex items-center gap-3 rounded-2xl border border-flame/20 bg-flame/5 p-4">
                  <Sparkles className="h-5 w-5 shrink-0 text-flame" />
                  <p className="text-[13px] leading-snug text-fog">
                    20 таких смен в месяце ≈{" "}
                    <b className="text-cream">{rub(b.total * 20)}</b>. Праздник
                    добавляет <b className="text-flame">+{rub(PAY.base * PAY.district * 2 - PAY.district * PAY.base)}</b>{" "}
                    к фиксу.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>

          {/* ---- result ---- */}
          <Reveal delay={0.25}>
            <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-line bg-gradient-to-br from-[#23262d] via-coal to-ink p-5 sm:p-6 md:p-8">
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-flame/15 blur-3xl" />
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fog">
                Итого за смену
              </p>
              <motion.p className="mt-2 font-mono text-[clamp(3rem,8vw,5.4rem)] font-bold leading-none tracking-tight text-cream tabular-nums">
                {display}
              </motion.p>
              <p className="mt-3 h-5 font-mono text-[12px] text-flame">
                {cases >= 2500
                  ? "мощная смена · так держать"
                  : cases === 0
                    ? "чистая ставка без сделки"
                    : `${cases} чехлов превращаются в деньги`}
              </p>

              <div className="mt-8 space-y-4">
                {rows.map((r, i) => (
                  <div key={r.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 text-[13px] font-semibold text-cream/90">
                        {r.label}
                        <span className="mt-0.5 block font-mono text-[10px] font-normal text-smoke sm:ml-2 sm:mt-0 sm:inline">
                          {r.note}
                        </span>
                      </span>
                      <span
                        className={cn(
                          "shrink-0 whitespace-nowrap font-mono text-[14px] font-bold tabular-nums",
                          r.flame ? "text-flame" : "text-cream"
                        )}
                      >
                        +{rub(r.value)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/40">
                      <motion.div
                        className={cn(
                          "h-full rounded-full",
                          r.flame
                            ? "bg-gradient-to-r from-flame to-flame-soft"
                            : "bg-fog/50"
                        )}
                        animate={{ width: `${(r.value / maxRow) * 100}%` }}
                        transition={{ type: "spring", stiffness: 80, damping: 20 }}
                        style={{ transitionDelay: `${i * 40}ms` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-auto flex flex-col items-start gap-2 border-t border-white/8 pt-4 font-mono text-[10px] text-smoke sm:flex-row sm:items-center sm:justify-between sm:pt-5 sm:text-[11px]">
                <span>итог = ставка + чехлы × цена × процент</span>
                <span className="text-flame">без сюрпризов</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
