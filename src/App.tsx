import { MotionConfig } from "framer-motion";
import { Cursor, Nav } from "./components/ui";
import { Hero } from "./components/Hero";
import { Calculator } from "./components/Calculator";
import { Scrolly } from "./components/Scrolly";
import { Bot } from "./components/Bot";
import { Bento } from "./components/Bento";
import { Formula } from "./components/Formula";
import { Footer } from "./components/Footer";

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="noise relative min-h-screen bg-ink text-cream">
        <Cursor />
        <Nav />
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
