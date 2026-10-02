import { useRef, useState } from "react";
import {
  motion,
  useMotionValueEvent,
  useScroll,
} from "framer-motion";
import {
  BarChart3,
  CalendarDays,
  Package,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Phone, type Screen } from "./Phone";
import { SectionHead } from "./ui";
import { cn } from "../utils/cn";

const FEATURES: {
  icon: LucideIcon;
  screen: Screen;
  title: string;
  text: string;
  chips: string[];
}[] = [
  {
    icon: Package,
    screen: "shift",
    title: "Моя смена",
    text: "Внёс чехлы — сразу видишь итог: ставка, сделка, праздничный режим. Прогресс к цели месяца растёт на глазах.",
    chips: ["праздничная ставка", "итог смены", "цель месяца"],
  },
  {
    icon: CalendarDays,
    screen: "calendar",
    title: "Календарь 2/2",
    text: "График виден целиком: рабочие дни, выходные, внесённые смены. Окно дня — чехлы, часы, премия, комментарий, шаблоны.",
    chips: ["график 2/2", "шаблоны смен", "окно дня"],
  },
  {
    icon: BarChart3,
    screen: "stats",
    title: "Статистика",
    text: "Заработок по сменам, средняя, лучшая, серия и рекорд. Динамика месяца — графиком, а не воспоминаниями.",
    chips: ["средняя смена", "рекорд", "серия смен"],
  },
  {
    icon: Wallet,
    screen: "finance",
    title: "Финансы",
    text: "Счета, лимиты категорий, регулярные платежи, долги и копилки. Советник подскажет, сколько можно отложить.",
    chips: ["счета", "лимиты", "копилки", "советник"],
  },
];

export function Scrolly() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.55", "end 0.7"],
  });

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const idx = Math.min(
      FEATURES.length - 1,
      Math.max(0, Math.floor(v * FEATURES.length))
    );
    setActive(idx);
  });

  const current = FEATURES[active];

  return (
    <section id="features" className="relative py-16 sm:py-20 md:py-36">
      <div className="mx-auto max-w-7xl px-4 sm:px-5 md:px-8">
        <SectionHead
          index="02"
          kicker="Возможности"
          title={
            <>
              Четыре экрана — <span className="text-outline">вся жизнь</span>{" "}
              на смене
            </>
          }
        />

        <div ref={ref} className="mt-10 grid gap-8 sm:mt-16 sm:gap-10 lg:grid-cols-2 lg:gap-20">
          {/* sticky phone */}
          <div className="relative hidden lg:block">
            <div className="sticky top-24 flex h-[calc(100vh-8rem)] items-center justify-center">
              <div className="pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-flame/10 blur-[110px]" />
              <motion.div
                key={current.screen}
                initial={{ rotateY: 24, opacity: 0.4, scale: 0.96 }}
                animate={{ rotateY: 0, opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                style={{ transformPerspective: 1000 }}
              >
                <Phone screen={current.screen} />
              </motion.div>

              {/* progress dots */}
              <div className="absolute right-0 top-1/2 flex -translate-y-1/2 flex-col gap-2">
                {FEATURES.map((f, i) => (
                  <span
                    key={f.screen}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-500",
                      i === active ? "h-8 w-1.5 bg-flame" : "w-1.5 bg-line"
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* features list */}
          <div className="flex flex-col">
            {FEATURES.map((f, i) => {
              const on = i === active;
              return (
                <div
                  key={f.screen}
                  className="flex min-h-0 items-start py-10 sm:min-h-[60vh] sm:items-center lg:min-h-[80vh] lg:py-0"
                >
                  <motion.div
                    animate={{
                      opacity: on ? 1 : 0.25,
                      scale: on ? 1 : 0.97,
                    }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="relative"
                  >
                    <span
                      className={cn(
                        "pointer-events-none absolute -top-10 right-0 font-mono text-[5rem] font-bold leading-none transition-colors duration-500 sm:-top-14 sm:text-[7rem] md:text-[9rem]", 
                        on ? "text-outline-faint" : "text-transparent"
                      )}
                    >
                      0{i + 1}
                    </span>
                    <div className="flex items-center gap-4">
                      <span
                        className={cn(
                          "grid h-12 w-12 place-items-center rounded-2xl border transition-all duration-500",
                          on
                            ? "border-flame bg-flame text-ink"
                            : "border-line bg-panel text-fog"
                        )}
                      >
                        <f.icon className="h-5 w-5" />
                      </span>
                      <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-fog">
                        экран {i + 1} / 4
                      </p>
                    </div>
                    <h3 className="mt-5 text-[clamp(1.9rem,4vw,3.2rem)] font-extrabold tracking-tight">
                      {f.title}
                    </h3>
                    <p className="mt-4 max-w-md text-[15px] leading-relaxed text-fog">
                      {f.text}
                    </p>
                    <div className="mt-6 flex flex-wrap gap-2">
                      {f.chips.map((c) => (
                        <span
                          key={c}
                          className={cn(
                            "rounded-full border px-3.5 py-1.5 font-mono text-[11px] transition-colors duration-500",
                            on
                              ? "border-flame/40 bg-flame/10 text-flame"
                              : "border-line text-smoke"
                          )}
                        >
                          {c}
                        </span>
                      ))}
                    </div>
                    {/* mobile phone preview */}
                    <div className="mt-6 flex justify-center lg:hidden">
                      <Phone screen={on ? f.screen : "shift"} compact />
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
