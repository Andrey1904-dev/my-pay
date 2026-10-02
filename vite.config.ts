import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const previewHosts = ["localhost", ".localhost", ".e2b.app"];

export default defineConfig({
  // Relative asset URLs keep the build working on both a domain root and
  // GitHub Pages' /my-pay/ project path.
  base: "./",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: previewHosts,
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: previewHosts,
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      // app.html is a separate, existing static PWA entry. It is copied as-is
      // after the landing page is bundled so its classic script stays intact.
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
    },
  },
});
