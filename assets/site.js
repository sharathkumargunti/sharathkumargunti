// Small DOM helpers shared by the public pages.
import { firebaseConfig, SITE } from "/assets/firebase-config.js";

/* ---------- theme ---------- */
export function initTheme() {
  const btn = document.getElementById("dark-mode-toggle");
  if (!btn) return;
  const root = document.documentElement;
  const meta = document.getElementById("theme-color-meta");
  const sync = () => btn.setAttribute("aria-pressed", String(root.classList.contains("dark-mode")));
  sync();
  btn.addEventListener("click", () => {
    const dark = root.classList.toggle("dark-mode");
    try { localStorage.setItem("theme", dark ? "dark" : "light"); } catch { /* private mode */ }
    if (meta) meta.setAttribute("content", dark ? "#121212" : "#FCE5CD");
    sync();
  });
}

/* ---------- toast ---------- */
const TOAST_ICONS = {
  success: "fa-check-circle",
  error: "fa-times-circle",
  warning: "fa-exclamation-triangle",
  info: "fa-check-circle",
};

export function showToast(message, type = "info", ms = 3000) {
  const box = document.getElementById("toast-container");
  if (!box) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icon = document.createElement("i");
  icon.className = `fas ${TOAST_ICONS[type] || TOAST_ICONS.info}`;
  icon.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.textContent = message;
  t.append(icon, " ", text);
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/* ---------- saved essays (ids in localStorage, shared by every page) ---------- */
export function readSaved() {
  try {
    const v = JSON.parse(localStorage.getItem("savedNotes") || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
export function writeSaved(list) {
  try { localStorage.setItem("savedNotes", JSON.stringify(list)); } catch { /* ignore */ }
}

/* ---------- lazy script / style loading ---------- */
const loaded = new Map();
export function loadScript(src, integrity = "") {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      if (integrity) { s.integrity = integrity; s.crossOrigin = "anonymous"; }
      s.onload = resolve;
      s.onerror = () => { loaded.delete(src); reject(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    }));
  }
  return loaded.get(src);
}
export function loadStyle(href, integrity = "") {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  if (integrity) { l.integrity = integrity; l.crossOrigin = "anonymous"; }
  document.head.appendChild(l);
}

/* Pinned third-party libraries (only fetched where needed) */
export const LIBS = {
  marked: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
  purify: "https://cdn.jsdelivr.net/npm/dompurify@3.5.0/dist/purify.min.js",
  hljs: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js",
  hljsCss: "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/tokyo-night-dark.min.css",
};

/* ---------- analytics (public pages only, after the page is idle) ---------- */
export function startAnalytics() {
  if (!SITE.analytics) return;
  const dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true;
  if (dnt) return;
  const run = async () => {
    try {
      const base = `https://www.gstatic.com/firebasejs/${SITE.firebaseVersion}`;
      const appMod = await import(`${base}/firebase-app.js`);
      const an = await import(`${base}/firebase-analytics.js`);
      if (!(await an.isSupported())) return;
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      an.getAnalytics(app);
    } catch { /* analytics must never break the page */ }
  };
  if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 5000 });
  else setTimeout(run, 3000);
}
