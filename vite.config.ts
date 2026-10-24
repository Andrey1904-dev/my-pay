import { defineConfig } from "vite";
export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [{
    name: "dev-pwa-entry",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(/<script src="script\.js[^"]*"><\/script>/, '<script type="module" src="/src/app/main.js"></script>')
        .replace(/if \("serviceWorker" in navigator\)/g, "if (false)");
    },
  }],
  server: { host: "0.0.0.0" },
  preview: { host: "0.0.0.0" },
});
