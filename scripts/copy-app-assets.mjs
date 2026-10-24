import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const files = [
  "index.html",
  "app.html",
  "style.css",
  "script.js",
  "sw.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "privacy.html",
  ".nojekyll",
];

for (const file of files) {
  const from = path.join(root, file);
  if (existsSync(from)) {
    cpSync(from, path.join(dist, file));
  }
}

const fontsDir = path.join(root, "fonts");
if (existsSync(fontsDir)) {
  cpSync(fontsDir, path.join(dist, "fonts"), { recursive: true });
}
