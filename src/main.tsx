// ## MAIN ##
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary";
import "./index.css";

// ## GLOBAL ERROR OVERLAY ##
function showFatal(msg: string) {
  try {
    const elId = "__fatal_overlay__";
    let el = document.getElementById(elId);
    if (!el) {
      el = document.createElement("div");
      el.id = elId;
      el.style.position = "fixed";
      el.style.inset = "0";
      el.style.background = "#111";
      el.style.color = "#f2f2f2";
      el.style.padding = "18px";
      el.style.zIndex = "999999";
      el.style.overflow = "auto";
      el.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div style="max-width:720px;margin:0 auto;">
        <div style="font-size:22px;font-weight:900;margin-bottom:10px;">Fatal error</div>
        <pre style="white-space:pre-wrap;background:#2a1414;border:1px solid #4a2222;color:#ffb3b3;padding:12px;border-radius:14px;">${escapeHtml(
          msg
        )}</pre>
        <div style="color:#b7b7b7;font-size:12px;">Open DevTools → Console for full stack trace.</div>
      </div>
    `;
  } catch {
    // last resort
    alert(msg);
  }
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

window.addEventListener("error", (ev) => {
  console.error("window.error:", ev.error || ev.message, ev);
  showFatal(String(ev.error?.stack || ev.error?.message || ev.message || ev));
});

window.addEventListener("unhandledrejection", (ev: PromiseRejectionEvent) => {
  console.error("unhandledrejection:", ev.reason, ev);
  showFatal(String((ev.reason && (ev.reason.stack || ev.reason.message)) || ev.reason || ev));
});
// ## GLOBAL ERROR OVERLAY END ##

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
// ## MAIN END ##
