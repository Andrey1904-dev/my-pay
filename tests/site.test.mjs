import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { PAY, PER_CASE, fixedPart, shiftBreakdown, shiftTotal } from "../src/lib/pay.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");

describe("landing page & production build", () => {
  test("root index.html has non-empty fallback markup and compiled landing assets for static hosting", () => {
    const indexHtml = read("index.html");
    const appHtml = read("app.html");

    assert.match(indexHtml, /<div id="root">\s*<div/s, "root #root must not be an empty black container");
    assert.match(indexHtml, /href="\.\/landing\.css\?v=1\.01"/);
    assert.match(indexHtml, /src="\.\/landing\.js\?v=1\.01"/);
    assert.match(indexHtml, /href="\.\/app\.html"/);
    assert.doesNotMatch(indexHtml, /src="\/src\/main\.tsx"/, "root index.html must not depend on uncompiled /src/main.tsx");
    assert.ok(existsSync(path.join(root, "landing.js")), "compiled landing.js must exist in root for GitHub Pages");
    assert.ok(existsSync(path.join(root, "landing.css")), "compiled landing.css must exist in root for GitHub Pages");
    assert.ok(existsSync(path.join(root, ".nojekyll")), ".nojekyll must exist in root");

    assert.match(appHtml, /id="casesInput"/);
    assert.match(appHtml, /script\.js\?v=1\.01/);
  });

  test("landing bundle mounts cleanly without black preloader overlay or scroll lock", async () => {
    const html = read("index.html")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<link\b[^>]*>/gi, "");
    const bundle = read("landing.js");

    const dom = new JSDOM(html, {
      url: "https://andrey1904-dev.github.io/my-pay/",
      runScripts: "dangerously",
      pretendToBeVisual: true,
    });
    const { window } = dom;
    try {
      const errors = [];
      window.addEventListener("error", (e) => errors.push(e.error || e.message));

      window.matchMedia = (q) => ({
        matches: false,
        media: q,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.IntersectionObserver = class {
        constructor(cb) {
          this.cb = cb;
        }
        observe(el) {
          this.cb([{ isIntersecting: true, target: el }]);
        }
        unobserve() {}
        disconnect() {}
      };
      window.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.scrollTo = () => {};

      window.eval(bundle);
      await new Promise((r) => setTimeout(r, 80));

      assert.deepEqual(errors, []);
      assert.equal(
        window.document.documentElement.style.overflow,
        "",
        "documentElement overflow must not be locked to hidden"
      );
      assert.equal(
        window.document.querySelector(".z-\\[300\\]"),
        null,
        "no full-screen black preloader overlay should exist"
      );
      const rootText = window.document.getElementById("root").textContent;
      assert.match(rootText, /CASE\.PLACE/);
      assert.match(rootText, /Смена/);
      assert.match(rootText, /Сколько принесёт смена/);
      assert.match(rootText, /Прозрачная арифметика денег/);
      const appLinks = [...window.document.querySelectorAll('a[href="./app.html"]')];
      assert.ok(appLinks.length >= 2, "landing page must render links to ./app.html");
    } finally {
      window.close();
    }
  });

  test("landing pay helper matches PWA and Telegram default formula", () => {
    assert.equal(PAY.base, 1900);
    assert.equal(PAY.lunch, 200);
    assert.equal(PAY.district, 1.15);
    assert.equal(PAY.caseRate, 7);
    assert.equal(PAY.casePercent, 25);
    assert.equal(PAY.holidayBase, 3800);
    assert.equal(PER_CASE, 1.75);

    assert.equal(fixedPart(false), 2415);
    assert.equal(fixedPart(true), 4600);
    assert.equal(shiftTotal(1000, false), 4165);
    assert.equal(shiftTotal(1000, true), 6350);

    const breakdown = shiftBreakdown(1180, false);
    assert.equal(breakdown.fixed, 2415);
    assert.equal(breakdown.piece, 2065);
    assert.equal(breakdown.total, 4480);
  });

  test("service worker caches landing and PWA assets and manifest points to app.html", () => {
    const sw = read("sw.js");
    const manifest = JSON.parse(read("manifest.webmanifest"));

    assert.match(sw, /"\.\/index\.html"/);
    assert.match(sw, /"\.\/landing\.css\?v=1\.01"/);
    assert.match(sw, /"\.\/landing\.js\?v=1\.01"/);
    assert.match(sw, /"\.\/app\.html"/);
    assert.equal(manifest.start_url, "./app.html");
  });

  test("production build outputs clean dist without duplicate hashed assets", () => {
    execFileSync("npm", ["run", "build"], { cwd: root, stdio: "pipe" });

    for (const file of [
      "dist/index.html",
      "dist/landing.js",
      "dist/landing.css",
      "dist/app.html",
      "dist/script.js",
      "dist/style.css",
      "dist/sw.js",
      "dist/manifest.webmanifest",
      "dist/privacy.html",
      "dist/icon.svg",
      "dist/icon-192.png",
      "dist/icon-512.png",
      "dist/.nojekyll",
      "dist/fonts/manrope-cyrillic-wght-normal.woff2",
    ]) {
      assert.ok(existsSync(path.join(root, file)), `${file} should exist after build`);
    }

    const distFiles = readdirSync(path.join(root, "dist"));
    const hashedDuplicates = distFiles.filter((f) =>
      /^(manifest-|icon-192-|icon-512-|icon-[A-Za-z0-9_-]+\.svg)/.test(f)
    );
    assert.deepEqual(hashedDuplicates, [], "dist must not contain duplicate hashed manifest/icon files");
  });
});
