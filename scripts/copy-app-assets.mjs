import { cp, copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "dist");

// Keep the original, fully functional PWA beside the new marketing landing page.
// These are copied byte-for-byte so the existing vanilla app and its tests do
// not depend on Vite's HTML or JavaScript transforms.
const appFiles = [
  "app.html",
  "style.css",
  "script.js",
  "sw.js",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "icon-512.png",
  "privacy.html",
];

await mkdir(output, { recursive: true });
await Promise.all(
  appFiles.map((file) => copyFile(path.join(root, file), path.join(output, file))),
);
await cp(path.join(root, "fonts"), path.join(output, "fonts"), {
  recursive: true,
  force: true,
});
await writeFile(path.join(output, ".nojekyll"), "");

console.log(`Copied the PWA shell and assets to ${output}`);
