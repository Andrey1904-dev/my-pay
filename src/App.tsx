import { useEffect, useState } from "react";
import { AnimatePresence, MotionConfig } from "framer-motion";
import Lenis from "lenis";
import { Cursor, Nav, Preloader } from "./components/ui";
import { Hero } from "./components/Hero";
import { Calculator } from "./components/Calculator";
import { Scrolly } from "./components/Scrolly";
import { Bot } from "./components/Bot";
import { Bento } from "./components/Bento";
import { Formula } from "./components/Formula";
import { Footer } from "./components/Footer";

export default function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const target = window as unknown as { __lenis?: Lenis };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      target.__lenis = undefined;
      return;
    }

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
    });
    target.__lenis = lenis;

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      target.__lenis = undefined;
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.overflow = loading ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [loading]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="noise relative min-h-screen bg-ink text-cream">
        <AnimatePresence>
          {loading && <Preloader onDone={() => setLoading(false)} />}
        </AnimatePresence>

        <Cursor />
        <Nav visible={!loading} />

        <main>
          <Hero />
          <Calculator />
          <Scrolly />
          <Bot />
          <Bento />
          <Formula />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
