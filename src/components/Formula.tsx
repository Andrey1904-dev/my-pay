import { ArrowRight, CalendarClock, PartyPopper, Percent } from "lucide-react";
import { SectionHead, Reveal, SpotCard } from "./ui";
import { PER_CASE, PAY, rub } from "../lib/pay";

const MATH = [
  { label: "Выход за смену", value: `${PAY.base.toLocaleString("ru-RU")} ₽`, w: "34%" },
  { label: "Доплата за обед", value: "+200 ₽", w: "4%" },
  { label: "Районный коэффициент", value: "× 1,15", w: "12%" },
  { label: "Цена чехла", value: "1,75 ₽", w: "8%", note: "7 ₽ × 25%, без коэффициента" },
];

const NUMBERS = [
  { big: "2 415 ₽", small: "чистая ставка за смену — уже с коэффициентом и обедом" },
  { big: "1,75 ₽", small: "за каждый упакованный чехол, поверх ставки" },
  { big: "4 165 ₽", small: "смена с 1 000 чехлов — типичный рабочий день" },
  { big: "23 → 8", small: "аванс 23-го, полный расчёт 8-го — приложение помнит" },
];

export function Formula() {
  return (
    <section id="math" className="relative py-16 sm:py-20 md:py-36">
      <div className="pointer-events-none absolute left-[-10%] top-1/4 h-[420px] w-[420px] rounded-full bg-flame/6 blur-[130px]" />
      <div className="mx-auto max-w-7xl px-4 sm:px-5 md:px-8">
        <SectionHead
          index="05"
          kicker="Математика"
          title={
            <>
              Прозрачная <span className="text-flame">арифметика</span> денег
            </>
          }
        />

        <div className="mt-10 grid gap-4 sm:mt-14 sm:gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          {/* math rows */}
          <Reveal>
            <SpotCard className="h-full p-5 sm:p-7 md:p-10">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fog">
                из чего складывается смена
              </p>
              <div className="mt-8 space-y-7">
                {MATH.map((m, i) => (
                  <div key={m.label}>
                    <div className="flex items-baseline justify-between gap-4">
                      <span className="text-[15px] font-bold text-cream">
                        <span className="mr-3 font-mono text-[11px] font-normal text-smoke">
                          0{i + 1}
                        </span>
                        {m.label}
                      </span>
                      <span className="font-mono text-[18px] font-bold text-flame tabular-nums">
                        {m.value}
                      </span>
                    </div>
                    <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-black/40">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-flame/60 to-flame"
                        style={{ width: m.w }}
                      />
                    </div>
                    {m.note && (
                      <p className="mt-1.5 font-mono text-[10px] text-smoke">
                        {m.note}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl border border-flame/25 bg-flame/5 p-5">
                <code className="font-mono text-[13px] leading-relaxed text-cream">
                  (1 900 + 200) × 1,15 + 1 000 × {String(PER_CASE).replace(".", ",")} ₽
                </code>
                <ArrowRight className="h-4 w-4 text-flame" />
                <span className="font-mono text-[20px] font-bold text-flame">
                  4 165 ₽
                </span>
              </div>
            </SpotCard>
          </Reveal>

          {/* holiday + payday */}
          <div className="flex flex-col gap-5">
            <Reveal delay={0.1}>
              <SpotCard className="p-5 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl bg-flame text-ink">
                    <PartyPopper className="h-5 w-5" />
                  </span>
                  <h3 className="text-[18px] font-extrabold">Праздничная смена</h3>
                </div>
                <p className="mt-4 text-[13.5px] leading-relaxed text-fog">
                  Выход удваивается: <b className="text-cream">4 600 ₽</b> фикса
                  вместо 2 415 ₽. Сделка не удваивается — зато чехлы идут
                  поверх. С 1 000 чехлов это{" "}
                  <b className="text-flame">6 350 ₽</b> за день.
                </p>
              </SpotCard>
            </Reveal>
            <Reveal delay={0.18}>
              <SpotCard className="p-5 sm:p-7">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-2xl border border-flame/30 bg-flame/10 text-flame">
                    <CalendarClock className="h-5 w-5" />
                  </span>
                  <h3 className="text-[18px] font-extrabold">Аванс и расчёт</h3>
                </div>
                <p className="mt-4 text-[13.5px] leading-relaxed text-fog">
                  <b className="text-cream">23-го</b> — выходы за 1–15 число.{" "}
                  <b className="text-cream">8-го</b> — полный заработок прошлого
                  месяца минус аванс. Ожидаемая выплата считается по внесённым
                  сменам.
                </p>
              </SpotCard>
            </Reveal>
            <Reveal delay={0.26}>
              <SpotCard className="flex h-full flex-1 items-center gap-4 p-5 sm:p-7">
                <Percent className="h-8 w-8 shrink-0 text-flame" />
                <p className="text-[13.5px] leading-relaxed text-fog">
                  Все параметры меняются в «Настройках расчёта» и
                  синхронизируются между устройствами.{" "}
                  <b className="text-cream">{rub(0)} неожиданностей</b> — только
                  честные формулы.
                </p>
              </SpotCard>
            </Reveal>
          </div>
        </div>

        {/* numbers strip */}
        <div className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-[24px] border border-line bg-line sm:mt-16 sm:rounded-[28px] lg:grid-cols-4">
          {NUMBERS.map((n, i) => (
            <Reveal key={n.big} delay={i * 0.07} className="h-full">
              <div className="group flex h-full flex-col justify-between bg-coal p-4 transition-colors duration-500 hover:bg-panel sm:p-7">
                <p className="font-mono text-[clamp(1.45rem,6.5vw,2.6rem)] sm:text-[clamp(1.9rem,3vw,2.6rem)] font-bold leading-none text-cream transition-colors duration-500 group-hover:text-flame">
                  {n.big}
                </p>
                <p className="mt-4 text-[12px] leading-relaxed text-fog">
                  {n.small}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
