import {
  Apple,
  CloudUpload,
  FileDown,
  MoonStar,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { SectionHead, Reveal, SpotCard } from "./ui";
import { cn } from "../utils/cn";

type Feature = {
  icon: LucideIcon;
  title: string;
  text: string;
  tag: string;
  span?: string;
  visual?: React.ReactNode;
};

function ThemeVisual() {
  return (
    <div className="mt-5 flex gap-2">
      <div className="flex-1 rounded-xl border border-white/10 bg-[#eeeeea] p-2.5">
        <div className="h-1.5 w-2/3 rounded-full bg-[#14161a]/80" />
        <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-[#14161a]/25" />
        <div className="mt-2.5 h-6 rounded-md bg-[#ff5a1f]" />
      </div>
      <div className="flex-1 rounded-xl border border-white/10 bg-[#14161a] p-2.5">
        <div className="h-1.5 w-2/3 rounded-full bg-white/80" />
        <div className="mt-1.5 h-1.5 w-1/2 rounded-full bg-white/20" />
        <div className="mt-2.5 h-6 rounded-md bg-[#ff6a33]" />
      </div>
    </div>
  );
}

function AuthVisual() {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {[
        { icon: Apple, label: "Apple" },
        { label: "Google" },
        { label: "Email" },
      ].map((p) => (
        <span
          key={p.label}
          className="flex items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 font-mono text-[11px] font-semibold text-cream/90"
        >
          {p.icon && <p.icon className="h-3.5 w-3.5" />}
          {p.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5 rounded-full border border-flame/30 bg-flame/10 px-3 py-1.5 font-mono text-[11px] font-semibold text-flame">
        офлайн-очередь
      </span>
    </div>
  );
}

const FEATURES: Feature[] = [
  {
    icon: WifiOff,
    title: "Офлайн-first",
    text: "Данные живут на устройстве. Нет сети — приложение работает как ни в чём не бывало, изменения уйдут при первой возможности.",
    tag: "PWA + Service Worker",
    span: "md:col-span-2",
  },
  {
    icon: MoonStar,
    title: "Три темы",
    text: "Светлая, тёмная и системная — отдельные наборы токенов, а не инверсия.",
    tag: "контраст ≥ 4.5:1",
    visual: <ThemeVisual />,
  },
  {
    icon: Apple,
    title: "iPhone-приложение",
    text: "SwiftUI, iOS 16+, полный паритет функций и общие данные с сайтом.",
    tag: "Xcode · App Store",
  },
  {
    icon: CloudUpload,
    title: "Синхронизация",
    text: "Supabase Auth + Postgres + RLS. Один аккаунт — сайт, iPhone и Telegram.",
    tag: "Apple · Google · Email",
    visual: <AuthVisual />,
  },
  {
    icon: FileDown,
    title: "Данные — твои",
    text: "Резервная копия JSON, экспорт CSV, удаление аккаунта одной кнопкой.",
    tag: "backup · csv",
  },
  {
    icon: ShieldCheck,
    title: "Приватность",
    text: "Row Level Security: чужие смены и деньги увидеть невозможно в принципе. Токены — только в секретах.",
    tag: "RLS · 0 трекеров",
  },
];

export function Bento() {
  return (
    <section className="relative py-16 sm:py-20 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-5 md:px-8">
        <SectionHead
          index="04"
          kicker="Платформа"
          title={
            <>
              Инженерия, которой <span className="text-outline">можно</span>{" "}
              доверять
            </>
          }
        />

        <div className="mt-10 grid gap-3 sm:mt-14 sm:gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.06} className={cn(f.span)}>
              <SpotCard className="flex h-full flex-col p-5 sm:p-7">
                <div className="flex items-start justify-between">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl border border-flame/25 bg-flame/10 text-flame">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-smoke">
                    {f.tag}
                  </span>
                </div>
                <h3 className="mt-6 text-[20px] font-extrabold tracking-tight">
                  {f.title}
                </h3>
                <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-fog">
                  {f.text}
                </p>
                {f.visual}
              </SpotCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
