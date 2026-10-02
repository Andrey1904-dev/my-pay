import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { Bot as BotIcon, CheckCheck, Send, Slash } from "lucide-react";
import { SectionHead, Reveal } from "./ui";
import { cn } from "../utils/cn";

type Msg =
  | { from: "user"; text: string }
  | { from: "bot"; title: string; lines: string[]; actions?: string[] };

const SCRIPT: Msg[] = [
  { from: "user", text: "упаковал 1200 чехлов" },
  {
    from: "bot",
    title: "Смена принята · 14 февраля",
    lines: [
      "Чехлы: 1 200 · сделка 2 100 ₽",
      "Заработок: 4 515 ₽",
      "Темп: к 19:00 ≈ 4 515 ₽",
    ],
    actions: ["+500", "+1000", "/month"],
  },
  { from: "user", text: "350 обед" },
  {
    from: "bot",
    title: "Расход записан",
    lines: [
      "350 ₽ → Еда · карта",
      "Осталось лимита: 2 150 ₽",
      "Свободно в месяце: 9 640 ₽",
    ],
    actions: ["/spent", "Отменить"],
  },
];

const PERKS = [
  { k: "чехлы 350 · вчера 900 · +500", v: "одной строкой" },
  { k: "350 обед · -1200 продукты", v: "расход с категорией" },
  { k: "/forecast · /calendar · /month", v: "прогноз и итоги" },
  { k: "напоминание в 19:00", v: "«сколько чехлов?»" },
];

export function Bot() {
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInView(sectionRef, { margin: "120px" });
  const reduceMotion = useReducedMotion();
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) {
      setVisible(SCRIPT.length);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const step = (i: number) => {
      if (cancelled) return;
      if (i > SCRIPT.length) {
        timer = setTimeout(() => {
          if (cancelled) return;
          setVisible(0);
          step(0);
        }, 3600);
        return;
      }
      // typing indicator before each bot message
      const isBot = SCRIPT[i]?.from === "bot";
      if (isBot) {
        setVisible(i + 100); // typing marker
        timer = setTimeout(() => {
          if (cancelled) return;
          setVisible(i + 1);
          step(i + 1);
        }, 1100);
      } else {
        setVisible(i + 1);
        timer = setTimeout(() => step(i + 1), i === 0 ? 900 : 1500);
      }
    };
    timer = setTimeout(() => step(0), 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inView, reduceMotion]);

  const typing = visible >= 100;
  const shown = typing ? visible - 100 : visible;

  return (
    <section ref={sectionRef} id="telegram" className="relative py-16 sm:py-20 md:py-36">
      <div className="pointer-events-none absolute right-[-10%] top-1/3 h-[420px] w-[420px] rounded-full bg-flame/7 blur-[130px]" />
      <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:gap-14 sm:px-5 md:px-8 lg:grid-cols-[1fr_1fr]">
        {/* text */}
        <div>
          <SectionHead
            index="03"
            kicker="Telegram-бот"
            title={
              <>
                Чат, который <span className="text-flame">знает</span> твою
                смену
              </>
            }
          />
          <Reveal delay={0.1}>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-fog">
              Бот — второй интерфейс к тем же данным. Внёс чехлы из чата — они
              уже на сайте и в iPhone. Каждый ответ — карточка с кнопками,
              которые редактируют сообщение, а не засоряют чат.
            </p>
          </Reveal>
          <div className="mt-8 space-y-3">
            {PERKS.map((p, i) => (
              <Reveal key={p.k} delay={0.12 + i * 0.06}>
                <div className="flex flex-col items-start gap-2 rounded-2xl border border-line bg-coal px-4 py-3.5 transition-colors duration-300 hover:border-flame/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4">
                  <code className="w-full break-words font-mono text-[12px] text-cream sm:w-auto sm:text-[13px]">{p.k}</code>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-flame sm:shrink-0 sm:text-[10px] sm:tracking-[0.18em]">
                    {p.v}
                  </span>
                </div>
              </Reveal>
            ))}
          </div>
        </div>

        {/* chat */}
        <Reveal delay={0.2}>
          <div className="relative mx-auto w-full max-w-md">
            <div className="pointer-events-none absolute -inset-6 rounded-[40px] bg-flame/8 blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-line bg-[#0e1013] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)]">
              {/* header */}
              <div className="flex items-center gap-3 border-b border-white/5 bg-[#14161a] px-5 py-4">
                <span className="relative grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-flame to-flame-soft text-ink">
                  <BotIcon className="h-5 w-5" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#14161a] bg-[#31c48d]" />
                </span>
                <div className="leading-tight">
                  <p className="text-[14px] font-bold text-cream">
                    CASE.PLACE SALARY
                  </p>
                  <p className="font-mono text-[10px] text-[#31c48d]">
                    {typing ? "печатает…" : "бот · онлайн"}
                  </p>
                </div>
                <Slash className="ml-auto h-4 w-4 text-smoke" />
              </div>

              {/* messages */}
              <div className="flex min-h-[440px] flex-col justify-end gap-3 p-4">
                <AnimatePresence>
                  {SCRIPT.slice(0, shown).map((m, i) =>
                    m.from === "user" ? (
                      <motion.div
                        key={`u-${i}`}
                        initial={{ opacity: 0, y: 16, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                        className="ml-auto max-w-[80%]"
                      >
                        <div className="rounded-2xl rounded-br-md bg-flame px-4 py-2.5 text-[13px] font-semibold text-ink">
                          {m.text}
                        </div>
                        <p className="mt-1 flex items-center justify-end gap-1 pr-1 font-mono text-[9px] text-smoke">
                          18:4{i} <CheckCheck className="h-3 w-3 text-flame" />
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`b-${i}`}
                        initial={{ opacity: 0, y: 16, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.35, ease: "easeOut" }}
                        className="mr-auto max-w-[88%]"
                      >
                        <div className="rounded-2xl rounded-bl-md border border-white/8 bg-[#1a1d22] p-3.5">
                          <p className="text-[12px] font-bold text-flame">
                            {m.title}
                          </p>
                          {m.lines.map((l) => (
                            <p
                              key={l}
                              className="mt-1 font-mono text-[11px] text-fog"
                            >
                              {l}
                            </p>
                          ))}
                          {m.actions && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/5 pt-2.5">
                              {m.actions.map((a) => (
                                <span
                                  key={a}
                                  className="rounded-lg bg-white/5 px-2.5 py-1 font-mono text-[10px] font-semibold text-cream/90"
                                >
                                  {a}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )
                  )}
                  {typing && (
                    <motion.div
                      key="typing"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="mr-auto rounded-2xl rounded-bl-md border border-white/8 bg-[#1a1d22] px-4 py-3"
                    >
                      <div className="flex gap-1">
                        {[0, 1, 2].map((d) => (
                          <span
                            key={d}
                            className="typing-dot h-1.5 w-1.5 rounded-full bg-fog"
                            style={{ animationDelay: `${d * 0.18}s` }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* input */}
              <div className="flex items-center gap-2 border-t border-white/5 bg-[#14161a] px-4 py-3">
                <div className="flex flex-1 items-center gap-2 rounded-full bg-black/30 px-4 py-2.5">
                  <span className="text-[13px] text-smoke">
                    напиши «чехлы 500»…
                  </span>
                </div>
                <span
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-full transition-colors duration-300",
                    shown > 0 ? "bg-flame text-ink" : "bg-white/8 text-smoke"
                  )}
                >
                  <Send className="h-4 w-4" />
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
