/* =========================================================
   FILE: vite.config.ts
   FULL FILE REPLACEMENT
   Purpose:
   - Dev: proxy /gs -> your Apps Script Web App /exec URL (from env)
   - Prevent ECONNREFUSED by never proxying to a dead localhost target
   ========================================================= */

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import type { ProxyOptions } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  // IMPORTANT:
  // This MUST be your deployed Apps Script Web App URL ending in /exec
  // Example: https://script.google.com/macros/s/XXXXXXX/exec
  const GS_EXEC = (env.VITE_GOOGLE_SCRIPT_URL || "").trim();

  const proxy: Record<string, string | ProxyOptions> = {};

  // Only set the proxy if we actually have a URL to proxy to.
  // If you forget to set VITE_GOOGLE_SCRIPT_URL, you’ll get a clear error in the browser
  // instead of ECONNREFUSED spam.
  if (GS_EXEC) {
    proxy["/gs"] = {
      target: GS_EXEC,
      changeOrigin: true,
      secure: false,
      // /gs?action=bootstrap -> ?action=bootstrap (appended onto /exec)
      rewrite: (path) => path.replace(/^\/gs/, ""),
    };
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy,
    },
  };
});
