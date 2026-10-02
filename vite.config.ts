import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function devLandingTransform(): Plugin {
  return {
    name: "dev-landing-transform",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace(/<link\s+rel="stylesheet"\s+href="\.\/landing\.css[^"]*"\s*\/?>\s*/g, "")
          .replace(
            /<script\s+type="module"\s+src="\.\/landing\.js[^"]*"><\/script>/,
            '<script type="module" src="/src/main.tsx"></script>'
          );
      },
    },
  };
}

export default defineConfig(({ command }) => ({
  base: "./",
  publicDir: false,
  plugins: [devLandingTransform(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions:
      command === "build"
        ? {
            input: path.resolve(__dirname, "src/main.tsx"),
            output: {
              entryFileNames: "landing.js",
              chunkFileNames: "landing-[name].js",
              assetFileNames: (assetInfo) =>
                assetInfo.name?.endsWith(".css") ? "landing.css" : "assets/[name][extname]",
            },
          }
        : undefined,
  },
}));
