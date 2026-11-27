// Behaviour shared by the generated essay pages and the in-browser reader:
// image lightbox, copy-code buttons, code highlighting, scroll progress,
// bookmark and share buttons.
import { showToast, readSaved, writeSaved, loadScript, loadStyle, LIBS } from "/assets/site.js";

/** Clipboard write with a fallback for in-app browsers that block the Clipboard API. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;opacity:0;top:0;left:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* ignore */ }
    ta.remove();
    return ok;
  }
}

/* ---------------- lightbox ---------------- */
let lastFocus = null;
function openLightbox(img) {
  const box = document.getElementById("lightbox");
  const big = document.getElementById("lightbox-img");
  if (!box || !big) return;
  lastFocus = document.activeElement;
  big.src = img.currentSrc || img.src;
  big.alt = img.alt || "Enlarged image";
  box.classList.add("active");
  box.setAttribute("aria-hidden", "false");
  box.focus();
}
function closeLightbox() {
  const box = document.getElementById("lightbox");
  if (!box || !box.classList.contains("active")) return false;
  box.classList.remove("active");
  box.setAttribute("aria-hidden", "true");
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  return true;
}
export { closeLightbox };

/* ---------------- article body enhancements ---------------- */
export function enhanceArticle(body) {
  if (!body) return;

  body.querySelectorAll("img").forEach((img) => {
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "Enlarge image" + (img.alt ? ": " + img.alt : ""));
    img.addEventListener("click", () => openLightbox(img));
    img.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openLightbox(img); }
    });
  });

  body.querySelectorAll("pre").forEach((pre) => {
    if (pre.querySelector(".copy-code-btn")) return;
    const btn = document.createElement("button");
    btn.className = "copy-code-btn";
    btn.type = "button";
    const label = (icon, text) => { btn.innerHTML = `<i class="${icon}" aria-hidden="true"></i> ${text}`; };
    label("far fa-copy", "Copy");
    btn.addEventListener("click", async () => {
      const code = pre.querySelector("code");
      if (await copyText(code ? code.innerText : pre.innerText)) {
        label("fas fa-check", "Copied");
        setTimeout(() => label("far fa-copy", "Copy"), 2000);
      } else {
        showToast("Could not copy. Select the code and copy it manually.", "error");
      }
    });
    pre.appendChild(btn);
  });

  // Only download the highlighter when an essay actually contains code.
  if (body.querySelector("pre code")) {
    loadStyle(LIBS.hljsCss);
    loadScript(LIBS.hljs)
      .then(() => body.querySelectorAll("pre code").forEach((b) => window.hljs && window.hljs.highlightElement(b)))
      .catch(() => { /* plain code blocks are fine */ });
  }
}

/* ---------------- bookmark + share (event delegation: survives re-renders) ---------------- */
function article() { return document.querySelector(".article"); }
function noteInfo() {
  const a = article();
  const canon = document.querySelector('link[rel="canonical"]');
  return {
    id: a ? a.dataset.noteId || "" : "",
    title: a ? a.dataset.title || document.title : document.title,
    url: (canon && canon.href) || location.href,
  };
}

export function syncBookmark() {
  const btn = document.getElementById("bookmark-btn");
  if (!btn) return;
  const { id } = noteInfo();
  const on = !!id && readSaved().includes(id);
  btn.classList.toggle("bookmarked", on);
  btn.setAttribute("aria-pressed", String(on));
  btn.setAttribute("aria-label", on ? "Remove from saved" : "Save for later");
  btn.title = on ? "Remove from saved" : "Save for later";
  btn.innerHTML = `<i class="${on ? "fas" : "far"} fa-bookmark" aria-hidden="true"></i>`;
  const nativeBtn = document.getElementById("share-native-btn");
  if (nativeBtn && navigator.share) nativeBtn.hidden = false;
}

function onShareClick(e) {
  const btn = e.target.closest("#bookmark-btn, #copy-link-btn, #share-x-btn, #share-wa-btn, #share-tg-btn, #share-native-btn");
  if (!btn) return;
  const { id, title, url } = noteInfo();
  switch (btn.id) {
    case "bookmark-btn": {
      if (!id) return;
      let list = readSaved();
      if (list.includes(id)) { list = list.filter((x) => x !== id); showToast("Removed from saved notes"); }
      else { list.push(id); showToast("Saved for later!"); }
      writeSaved(list);
      syncBookmark();
      break;
    }
    case "copy-link-btn":
      copyText(url).then((ok) => showToast(ok ? "Link copied to clipboard!" : "Could not copy the link", ok ? "info" : "error"));
      break;
    case "share-wa-btn":
      window.open(`https://wa.me/?text=${encodeURIComponent(title + " " + url)}`, "_blank", "noopener");
      break;
    case "share-x-btn":
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, "_blank", "noopener");
      break;
    case "share-tg-btn":
      window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}`, "_blank", "noopener");
      break;
    case "share-native-btn":
      if (navigator.share) navigator.share({ title, url }).catch(() => { /* user cancelled */ });
      break;
  }
}

/* ---------------- page chrome: progress bar, sticky nav, scroll-to-top, lightbox close ---------------- */
let started = false;
export function initArticleUi({ progress = true } = {}) {
  if (started) return;
  started = true;
  const bar = document.getElementById("progress-bar");
  const barBox = document.getElementById("progress-container");
  const nav = document.getElementById("main-nav");
  const top = document.getElementById("scroll-top");

  function update() {
    const y = window.scrollY || document.documentElement.scrollTop;
    const h = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    if (bar) bar.style.width = (progress && h > 0 ? Math.min(100, Math.max(0, (y / h) * 100)) : 0) + "%";
    if (nav) nav.classList.toggle("scrolled", y > 50);
    if (top) top.classList.toggle("visible", y > 500);
  }
  if (barBox) barBox.style.display = progress ? "" : "none";
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();

  if (top) top.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  const box = document.getElementById("lightbox");
  if (box) box.addEventListener("click", closeLightbox);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLightbox(); });

  document.addEventListener("click", onShareClick);
  return update;
}
