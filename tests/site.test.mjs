import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

test("лендинг и рабочее PWA доступны как отдельные страницы", () => {
  const landing = read("index.html");
  const app = read("app.html");
  const manifest = JSON.parse(read("manifest.webmanifest"));
  const serviceWorker = read("sw.js");
  const source = read("src/components/ui.tsx");

  assert.match(landing, /<div id="root"><\/div>/);
  assert.match(landing, /src="\/src\/main\.tsx"/);
  assert.match(landing, /смена считается сама/);
  assert.match(app, /id="homeScreen"/);
  assert.match(app, /id="financeScreen"/);
  assert.match(source, /BASE_URL}\s*app\.html/);
  assert.equal(manifest.start_url, "./app.html");
  assert.equal(manifest.id, "./app.html");
  assert.match(serviceWorker, /"\.\/app\.html"/);
  assert.match(serviceWorker, /url\.pathname\.endsWith\("\/app\.html"\)/);
});

test("лендинг адаптирован к узкому экрану и safe area телефона", () => {
  const landing = read("index.html");
  const hero = read("src/components/Hero.tsx");
  const phone = read("src/components/Phone.tsx");
  const features = read("src/components/Scrolly.tsx");
  const bot = read("src/components/Bot.tsx");

  assert.match(landing, /viewport-fit=cover/);
  assert.match(hero, /text-\[clamp\(2\.8rem,12vw,8\.6rem\)\]/);
  assert.match(hero, /sm:flex-row/);
  assert.match(phone, /calc\(100vw-48px\)/);
  assert.match(features, /compact \/>/);
  assert.match(bot, /useInView\(sectionRef/);
});
