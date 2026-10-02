import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
} from "react";
import {
  motion,
  useMotionValue,
  useSpring,
  useInView,
  useScroll,
  AnimatePresence,
} from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { cn } from "../utils/cn";

export const APP_URL = `${import.meta.env.BASE_URL}app.html`;
export const REPO_URL = "https://github.com/Andrey1904-dev/my-pay";

/* ================= scroll helper ================= */
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: HTMLElement, o?: object) => void } }).__lenis;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const headerHeight = document.querySelector("header")?.getBoundingClientRect().height ?? 72;
  const offset = headerHeight + 8;
  if (lenis && !reduceMotion) lenis.scrollTo(el, { offset: -offset, duration: 1.2 });
  else {
    const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset);
    window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
  }
}

/* ================= custom cursor ================= */
export function Cursor() {
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const rx = useSpring(x, { stiffness: 350, damping: 32, mass: 0.6 });
  const ry = useSpring(y, { stiffness: 350, damping: 32, mass: 0.6 });
  const [hot, setHot] = useState(false);
  const [fine, setFine] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)");
    setFine(mq.matches);
    if (!mq.matches) return;
    const move = (e: PointerEvent) => {
      x.set(e.clientX);
      y.set(e.clientY);
      const t = e.target as HTMLElement | null;
      setHot(!!t?.closest("a,button,input,[data-hot]"));
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [x, y]);

  if (!fine) return null;
  return (
    <>
      <motion.div
        className="pointer-events-none fixed left-0 top-0 z-[200] h-2 w-2 rounded-full bg-flame"
        style={{ x, y, translateX: "-50%", translateY: "-50%" }}
      />
      <motion.div
        className="pointer-events-none fixed left-0 top-0 z-[200] rounded-full border border-flame/70"
        style={{ x: rx, y: ry, translateX: "-50%", translateY: "-50%" }}
        animate={{
          width: hot ? 52 : 32,
          height: hot ? 52 : 32,
          opacity: hot ? 0.9 : 0.45,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
      />
    </>
  );
}

/* ================= preloader ================= */
export function Preloader({ onDone }: { onDone: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const dur = 1500;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setN(Math.round(eased * 100));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setTimeout(onDone, 350);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-ink"
      exit={{ y: "-100%", transition: { duration: 0.7, ease: [0.76, 0, 0.24, 1] } }}
    >
      <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-fog">
        CASE.PLACE SALARY
      </p>
      <div className="mt-4 flex items-baseline gap-2 font-mono">
        <motion.span
          key={n}
          className="text-[18vw] font-bold leading-none text-cream tabular-nums md:text-[9rem]"
        >
          {n}
        </motion.span>
        <span className="text-2xl text-flame">%</span>
      </div>
      <div className="mt-6 h-px w-48 overflow-hidden bg-line">
        <div
          className="h-full bg-flame transition-[width] duration-100"
          style={{ width: `${n}%` }}
        />
      </div>
      <p className="mt-4 font-mono text-[11px] text-smoke">смена загружается…</p>
    </motion.div>
  );
}

/* ================= nav ================= */
const NAV_LINKS = [
  { id: "calc", label: "Калькулятор" },
  { id: "features", label: "Возможности" },
  { id: "telegram", label: "Telegram" },
  { id: "math", label: "Математика" },
];

export function Nav({ visible }: { visible: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 26 });
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={visible ? { y: 0, opacity: 1 } : {}}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
      className={cn(
        "fixed inset-x-0 top-0 z-[120] pt-[env(safe-area-inset-top)] transition-all duration-500",
        scrolled ? "glass border-b border-white/5" : "bg-transparent"
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-5 md:px-8">
        <button
          onClick={() => scrollToId("top")}
          className="group flex items-center gap-3"
          aria-label="Наверх"
        >
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-flame font-mono text-sm font-bold text-ink transition-transform duration-300 group-hover:rotate-[-8deg]">
            ₽
          </span>
          <span className="text-left leading-none">
            <span className="block text-[13px] font-extrabold tracking-wide">
              CASE.PLACE
            </span>
            <span className="block font-mono text-[10px] uppercase tracking-[0.3em] text-fog">
              salary
            </span>
          </span>
        </button>

        <nav className="hidden items-center gap-7 md:flex">
          {NAV_LINKS.map((l) => (
            <button
              key={l.id}
              onClick={() => scrollToId(l.id)}
              className="group relative font-mono text-[11px] uppercase tracking-[0.2em] text-fog transition-colors hover:text-cream"
            >
              {l.label}
              <span className="absolute -bottom-1 left-0 h-px w-0 bg-flame transition-all duration-300 group-hover:w-full" />
            </button>
          ))}
        </nav>

        <a
          href={APP_URL}
          className="group flex min-h-11 items-center gap-1.5 rounded-full bg-cream px-3 py-2 text-[11px] font-bold text-ink transition-all duration-300 hover:bg-flame hover:text-ink sm:gap-2 sm:px-4 sm:text-[12px]"
        >
          <span className="sm:hidden">В приложение</span>
          <span className="hidden sm:inline">Открыть приложение</span>
          <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </a>
      </div>
      <motion.div
        className="h-[2px] origin-left bg-gradient-to-r from-flame to-flame-soft"
        style={{ scaleX: progress }}
      />
    </motion.header>
  );
}

/* ================= marquee ================= */
export function Marquee({
  items,
  className,
  outline = false,
  duration = 32,
}: {
  items: string[];
  className?: string;
  outline?: boolean;
  duration?: number;
}) {
  const row = (
    <>
      {items.map((it, i) => (
        <span key={i} className="flex shrink-0 items-center gap-6 pr-6">
          <span
            className={cn(
              "whitespace-nowrap text-[clamp(2.4rem,6vw,5rem)] font-extrabold uppercase leading-none tracking-tight",
              outline ? "text-outline-faint" : "text-cream"
            )}
          >
            {it}
          </span>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-flame" />
        </span>
      ))}
    </>
  );
  return (
    <div className={cn("mask-fade-x overflow-hidden", className)}>
      <div
        className="animate-marquee flex w-max"
        style={{ ["--marquee-dur" as string]: `${duration}s` }}
      >
        <div className="flex">{row}</div>
        <div className="flex" aria-hidden>
          {row}
        </div>
      </div>
    </div>
  );
}

/* ================= section head ================= */
export function SectionHead({
  index,
  kicker,
  title,
  className,
  align = "left",
}: {
  index: string;
  kicker: string;
  title: ReactNode;
  className?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={cn(
        "relative",
        align === "center" && "text-center",
        className
      )}
    >
      <Reveal>
        <div
          className={cn(
            "flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.35em] text-flame",
            align === "center" && "justify-center"
          )}
        >
          <span>{index}</span>
          <span className="h-px w-10 bg-flame/50" />
          <span className="text-fog">{kicker}</span>
        </div>
      </Reveal>
      <WordReveal>
        <h2 className="mt-5 text-[clamp(2.2rem,5.5vw,4.6rem)] font-extrabold leading-[1.02] tracking-tight">
          {title}
        </h2>
      </WordReveal>
    </div>
  );
}

/* ================= reveal ================= */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 28,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

/* ================= word-by-word reveal ================= */
export function WordReveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const words = extractWords(children);
  let k = 0;
  return (
    <div ref={ref}>
      {words.map((w, i) =>
        typeof w === "string" ? (
          <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
            <motion.span
              className="inline-block"
              initial={{ y: "110%" }}
              animate={inView ? { y: 0 } : {}}
              transition={{
                duration: 0.7,
                delay: 0.05 * k++,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {w}&nbsp;
            </motion.span>
          </span>
        ) : (
          <span key={i} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
            <motion.span
              className="inline-block"
              initial={{ y: "110%" }}
              animate={inView ? { y: 0 } : {}}
              transition={{
                duration: 0.7,
                delay: 0.05 * k++,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              {w}
            </motion.span>
          </span>
        )
      )}
    </div>
  );
}

function extractWords(node: ReactNode): ReactNode[] {
  if (typeof node === "string") return node.split(/\s+/).filter(Boolean);
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(extractWords);
  if (typeof node === "object" && node && "props" in (node as never)) {
    const el = node as { props: { children?: ReactNode } };
    if (el.props.children !== undefined) return [node];
  }
  return node ? [node] : [];
}

/* ================= rotating badge ================= */
export function RotatingBadge({ className }: { className?: string }) {
  return (
    <div className={cn("relative h-32 w-32", className)}>
      <svg viewBox="0 0 100 100" className="animate-spin-slow h-full w-full">
        <defs>
          <path id="circ" d="M 50,50 m -38,0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0" />
        </defs>
        <text className="fill-fog font-mono text-[8.2px] uppercase tracking-[0.22em]">
          <textPath href="#circ">
            смена засчитана · чехлы упакованы · деньги учтены ·
          </textPath>
        </text>
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-flame font-mono text-lg font-bold text-ink">
          ₽
        </span>
      </div>
    </div>
  );
}

/* ================= spotlight card ================= */
export function SpotCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      className={cn(
        "spot-card rounded-3xl border border-line bg-coal transition-colors duration-300 hover:border-flame/40",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ================= magnetic wrapper ================= */
export function Magnetic({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 180, damping: 16 });
  const sy = useSpring(y, { stiffness: 180, damping: 16 });
  return (
    <motion.div
      ref={ref}
      style={{ x: sx, y: sy }}
      onMouseMove={(e) => {
        const r = ref.current?.getBoundingClientRect();
        if (!r) return;
        x.set((e.clientX - (r.left + r.width / 2)) * 0.25);
        y.set((e.clientY - (r.top + r.height / 2)) * 0.25);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
      className={cn("inline-block", className)}
    >
      {children}
    </motion.div>
  );
}

/* ================= pill toggle ================= */
export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="group flex min-h-11 min-w-11 items-center justify-center gap-3"
      aria-label={label ?? "Праздничная смена"}
      aria-pressed={on}
    >
      <span
        className={cn(
          "relative h-7 w-12 rounded-full border transition-colors duration-300",
          on ? "border-flame bg-flame/20" : "border-line bg-panel"
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full transition-all duration-300",
            on ? "left-[26px] bg-flame" : "left-[3px] bg-fog group-hover:bg-cream"
          )}
        />
      </span>
      {label && (
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-fog">
          {label}
        </span>
      )}
    </button>
  );
}

export { AnimatePresence, motion };
