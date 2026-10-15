import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => ({
  base: mode === "android" ? "/assets/web/" : "/",
  build: { target: "chrome90" },
  plugins: [
    react(),
    tailwindcss(),
    ...(mode === "android"
      ? [
          {
            name: "android-content-security-policy",
            transformIndexHtml() {
              return [
                {
                  tag: "meta",
                  attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content:
                      "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'self'",
                  },
                  injectTo: "head-prepend",
                },
              ];
            },
          },
        ]
      : []),
  ],
  optimizeDeps: {
    exclude: ["jsnes"],
  },
  server: {
    port: 3000,
    open: true,
    watch: {
      // Watch the core jsnes source for changes
      ignored: ["!**/node_modules/jsnes/**"],
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setupTests.js"],
  },
}));
