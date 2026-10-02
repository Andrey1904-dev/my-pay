import { useRef, type MouseEvent } from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  useScroll,
} from "framer-motion";
import { ArrowDown, ArrowUpRight, CalendarRange, Coins, Package } from "lucide-react";
import { Phone } from "./Phone";
import { Marquee, RotatingBadge, scrollToId, APP_URL } from "./ui";

const EASE = [0.22, 1, 0.36, 1] as const;

function Chip({
  icon: Icon,
  title,
  sub,
  className,
  delay,
}: {
  icon: typeof Coins;
  title: string;
  sub: string;
  className?: string;
  delay: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.7, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ delay: 1.4, duration: 0.7, ease: EASE }}
      className={`absolute z-20 ${className ?? ""}`}
    >
      <div
        className="animate-floaty glass flex items-center gap-2.5 rounded-2xl border border-white/10 px-3.5 py-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]"
        style={{ animationDelay: delay }}
      >
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-flame/15 text-flame">
          <Icon className="h-4 w-4" />
        </span>
        <span className="leading-tight">
          <span className="block font-mono text-[13px] font-bold text-cream">
            {title}
          </span>
          <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-fog">
            {sub}
          </span>
        </span>
      </div>
    </motion.div>
  );
}

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const rX = useSpring(useTransform(my, [0, 1], [10, -10]), { stiffness: 120, damping: 18 });
  const rY = useSpring(useTransform(mx, [0, 1], [-12, 12]), { stiffness: 120, damping: 18 });

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const phoneY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const textY = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const fade = useTransform(scrollYProgress, [0, 0.7], [1, 0]);

  const onMove = (e: MouseEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width);
    my.set((e.clientY - r.top) / r.height);
  };

  return (
    <section
      id="top"
      ref={ref}
      onMouseMove={onMove}
      className="bg-grid relative overflow-hidden pt-[calc(7rem_+_env(safe-area-inset-top))] md:pt-[calc(8rem_+_env(safe-area-inset-top))]"
    >
      {/* glow */}
      <div className="pointer-events-none absolute -top-40 right-[-10%] h-[560px] w-[560px] rounded-full bg-flame/15 blur-[140px]" />
      <div className="pointer-events-none absolute bottom-0 left-[-15%] h-[420px] w-[420px] rounded-full bg-flame/8 blur-[120px]" />

      <motion.div
        style={{ opacity: fade }}
        className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 pb-12 sm:gap-14 sm:px-5 sm:pb-16 md:px-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-4"
      >
        {/* ------- left: type ------- */}
        <motion.div style={{ y: textY }} className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25, duration: 0.7, ease: EASE }}
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-mono text-[9px] uppercase tracking-[0.2em] text-fog sm:gap-3 sm:text-[11px] sm:tracking-[0.35em]"
          >
            <span className="h-2 w-2 animate-pulse-dot rounded-full bg-flame" />
            Екатеринбург · смены 2/2 · упаковка чехлов
          </motion.div>

          <h1 className="mt-6 font-extrabold uppercase leading-[0.88] tracking-tight">
            {[
              { text: "Смена", cls: "text-cream" },
              { text: "считается", cls: "text-outline" },
              { text: "сама", cls: "text-flame" },
            ].map((w, i) => (
              <span key={w.text} className="block overflow-hidden pb-[0.06em]">
                <motion.span
                  className={`block text-[clamp(2.8rem,12vw,8.6rem)] sm:text-[clamp(3.4rem,11vw,8.6rem)] ${w.cls}`}
                  initial={{ y: "112%" }}
                  animate={{ y: 0 }}
                  transition={{ delay: 0.35 + i * 0.12, duration: 0.9, ease: EASE }}
                >
                  {w.text}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.85, duration: 0.7, ease: EASE }}
            className="mt-6 max-w-md text-[15px] leading-relaxed text-fog"
          >
            Внёс чехлы — получил итог смены, месяц и прогресс к цели.
            Календарь 2/2, статистика, финансы и Telegram-бот. Работает офлайн,
            синхронизируется, когда появится сеть.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1, duration: 0.7, ease: EASE }}
            className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:gap-4"
          >
            <button
              onClick={() => scrollToId("calc")}
              className="group relative flex min-h-12 w-full items-center justify-center overflow-hidden rounded-full bg-flame px-5 py-3 text-[14px] font-extrabold text-ink transition-transform duration-300 hover:scale-[1.03] active:scale-95 sm:w-auto sm:px-7 sm:py-4"
            >
              <span className="relative z-10 flex items-center gap-2">
                Рассчитать смену
                <ArrowDown className="h-4 w-4 transition-transform duration-300 group-hover:translate-y-0.5" />
              </span>
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </button>
            <a
              href={APP_URL}
              className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-[14px] font-bold text-cream transition-colors duration-300 hover:border-flame/60 hover:text-flame sm:w-auto sm:px-7 sm:py-4"
            >
              Открыть приложение
              <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.3, duration: 0.8 }}
            className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-[9px] uppercase tracking-[0.12em] text-smoke sm:mt-10 sm:justify-start sm:gap-6 sm:text-[10px] sm:tracking-[0.2em]"
          >
            <span>PWA · офлайн</span>
            <span className="hidden h-3 w-px bg-line sm:block" />
            <span>iOS · SwiftUI</span>
            <span className="hidden h-3 w-px bg-line sm:block" />
            <span>Telegram-бот</span>
          </motion.div>
        </motion.div>

        {/* ------- right: phone ------- */}
        <motion.div
          style={{ y: phoneY, perspective: 1200 }}
          className="relative z-10 mx-auto w-[min(300px,calc(100vw-48px))] lg:mx-0 lg:justify-self-end"
        >
          <motion.div
            initial={{ opacity: 0, y: 80, rotate: 4 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: 0.6, duration: 1.1, ease: EASE }}
            style={{ rotateX: rX, rotateY: rY, transformStyle: "preserve-3d" }}
            className="relative"
          >
            <Phone screen="shift" />
            {/* halo */}
            <div className="pointer-events-none absolute -inset-10 -z-10 rounded-[64px] bg-flame/10 blur-3xl" />
          </motion.div>

          <Chip
            icon={Coins}
            title="2 415 ₽"
            sub="ставка за смену"
            className="hidden -left-8 top-16 sm:block lg:-left-20"
            delay="0s"
          />
          <Chip
            icon={Package}
            title="1 000 × 1,75 ₽"
            sub="сделка за смену"
            className="hidden -right-4 bottom-40 sm:block lg:-right-16"
            delay="1.2s"
          />
          <Chip
            icon={CalendarRange}
            title="график 2/2"
            sub="календарь смен"
            className="hidden -left-2 bottom-10 sm:block lg:-left-14"
            delay="2.1s"
          />
        </motion.div>
      </motion.div>

      {/* badge + marquee */}
      <div className="relative z-10 border-t border-white/5">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 md:px-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-smoke">
            v1.01 · веб + iphone + telegram
          </p>
          <RotatingBadge className="hidden md:block" />
        </div>
        <Marquee
          items={["Чехлы", "Смены", "Деньги", "Цели", "Календарь", "Финансы"]}
          className="border-t border-white/5 py-4"
          duration={30}
        />
      </div>
    </section>
  );
}
