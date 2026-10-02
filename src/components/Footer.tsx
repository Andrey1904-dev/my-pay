import { ArrowUpRight, Apple, Code2, Send, Smartphone } from "lucide-react";
import { Marquee, Magnetic, Reveal, APP_URL, REPO_URL, scrollToId } from "./ui";

export function Footer() {
  return (
    <footer className="relative overflow-hidden pt-10">
      <Marquee
        items={["Поставь на контроль", "Смена", "Деньги", "Цель", "Смена", "Деньги", "Цель"]}
        outline
        className="border-y border-white/5 py-4 opacity-70 sm:py-6"
        duration={26}
      />

      {/* CTA */}
      <div className="relative py-16 sm:py-20 md:py-36">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-[480px] w-[820px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-flame/12 blur-[150px]" />
        <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-5 md:px-8">
          <Reveal>
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-flame sm:text-[11px] sm:tracking-[0.4em]">
              06 · установка
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="mt-6 text-[clamp(2.6rem,8vw,6.5rem)] font-extrabold uppercase leading-[0.92] tracking-tight">
              Смена. <span className="text-outline">Деньги.</span>{" "}
              <span className="text-flame">Контроль.</span>
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="mx-auto mt-6 max-w-lg text-[15px] leading-relaxed text-fog">
              Открой на телефоне — и добавь на экран «Домой». Работает как
              приложение, весит меньше фото, живёт офлайн.
            </p>
          </Reveal>

          <Reveal delay={0.24}>
            <div className="mt-8 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-4">
              <Magnetic className="w-full sm:w-auto">
                <a
                  href={APP_URL}
                  className="group relative flex min-h-12 w-full items-center justify-center overflow-hidden rounded-full bg-flame px-5 py-3 text-[14px] font-extrabold text-ink transition-transform duration-300 hover:scale-[1.04] active:scale-95 sm:w-auto sm:px-8 sm:py-4.5 sm:text-[15px]"
                >
                  <span className="relative z-10 flex items-center gap-2.5 py-0.5">
                    <Smartphone className="h-4.5 w-4.5" />
                    <span className="sm:hidden">Открыть приложение</span>
                    <span className="hidden sm:inline">Открыть веб-приложение</span>
                    <ArrowUpRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </span>
                  <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
                </a>
              </Magnetic>
              <a
                href={`${REPO_URL}/blob/main/ios/README_IOS.md`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full border border-line px-5 py-3 text-[14px] font-bold text-cream transition-colors duration-300 hover:border-flame/60 hover:text-flame sm:w-auto sm:px-7 sm:py-4"
              >
                <Apple className="h-4.5 w-4.5" />
                На iPhone
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full border border-line px-5 py-3 text-[14px] font-bold text-cream transition-colors duration-300 hover:border-flame/60 hover:text-flame sm:w-auto sm:px-7 sm:py-4"
              >
                <Code2 className="h-4.5 w-4.5" />
                Исходники
              </a>
            </div>
          </Reveal>
        </div>
      </div>

      {/* bottom bar */}
      <div className="border-t border-white/5">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-5 px-4 py-8 sm:px-5 md:flex-row md:px-8">
          <button
            onClick={() => scrollToId("top")}
            className="flex items-center gap-3"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-flame font-mono text-sm font-bold text-ink">
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

          <p className="font-mono text-[11px] text-smoke">
            сделано для команды CASE.PLACE · Екатеринбург
          </p>

          <div className="flex items-center gap-5 font-mono text-[11px] uppercase tracking-[0.2em] text-fog">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition-colors hover:text-flame"
            >
              <Code2 className="h-3.5 w-3.5" /> github
            </a>
            <span className="h-3 w-px bg-line" />
            <a
              href={`${REPO_URL}/blob/main/telegram_bot_setup.md`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition-colors hover:text-flame"
            >
              <Send className="h-3.5 w-3.5" /> бот
            </a>
            <span className="h-3 w-px bg-line" />
            <span className="text-smoke">v1.01</span>
          </div>
        </div>
      </div>

      {/* giant word */}
      <div className="pointer-events-none select-none overflow-hidden">
        <p className="text-outline-faint -mb-[0.24em] text-center text-[clamp(4rem,14.5vw,13rem)] font-extrabold uppercase leading-none tracking-tight">
          salary
        </p>
      </div>
    </footer>
  );
}
