// Entry point for the home page.
import { initTheme, showToast, startAnalytics, readSaved } from "/assets/site.js";
import { SITE } from "/assets/firebase-config.js";
import { getFirebase } from "/assets/firebase.js";
import { latestWidgetMarkup } from "/assets/util.js";

initTheme();
startAnalytics();

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// bfcache fix: coming back with the Back button must not show a faded-out page
window.addEventListener("pageshow", () => document.body.classList.remove("fade-out"));

function navigateWithFade(url) {
  if (reducedMotion) { window.location.href = url; return; }
  document.body.classList.add("fade-out");
  setTimeout(() => { window.location.href = url; }, 180);
}

// Smooth fade for internal links (delegated so dynamically injected links work too)
document.addEventListener("click", (e) => {
  const a = e.target.closest("a");
  if (!a) return;
  if (a.target === "_blank" || a.hasAttribute("download") || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  if (!a.href || a.protocol === "mailto:" || a.hostname !== location.hostname) return;
  const u = new URL(a.href);
  if (u.pathname === location.pathname && u.search === location.search && u.hash) return;
  e.preventDefault();
  navigateWithFade(a.href);
});

// Optional contact email icon driven by SITE.contactEmail
if (SITE.contactEmail && SITE.contactEmail.trim()) {
  const icons = document.querySelector(".social-icons");
  if (icons) {
    const a = document.createElement("a");
    a.href = `mailto:${SITE.contactEmail.trim()}`;
    a.setAttribute("aria-label", "Email");
    a.title = "Email";
    a.innerHTML = '<i aria-hidden="true" class="fas fa-envelope"></i>';
    icons.appendChild(a);
  }
}

/* ---------- build-time data (essay ids, latest essay) ---------- */
let ssrHome = null;
try { ssrHome = JSON.parse(document.getElementById("ssr-home").textContent); } catch { /* not built yet */ }

// Saved pill: only count essays that still exist
try {
  const ids = ssrHome && Array.isArray(ssrHome.ids) ? new Set(ssrHome.ids) : null;
  const saved = readSaved().filter((id) => !ids || ids.has(id));
  const pill = document.getElementById("saved-topic-pill");
  const text = document.getElementById("saved-count-text");
  if (saved.length && pill && text) {
    text.textContent = `Saved (${saved.length})`;
    pill.hidden = false;
  }
} catch { /* ignore */ }

// Latest essay: normally written into the page by the build. Fallback for local previews.
try { localStorage.removeItem("cachedLatestEssay"); } catch { /* ignore */ }
const widget = document.getElementById("latest-note-widget");
if (widget && !widget.querySelector(".latest-link")) {
  fetch("/notes-index.json")
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const n = j && j.notes && j.notes[0];
      if (!n) return;
      widget.classList.add("clickable");
      widget.innerHTML = latestWidgetMarkup(n);
    })
    .catch(() => { /* keep the static text */ });
}

/* ---------- contact form ---------- */
const contactForm = document.getElementById("contact-form");
const submitBtn = document.getElementById("submit-btn");
const nameInput = document.getElementById("visitor-name");
const messageInput = document.getElementById("visitor-message");
const honeypotInput = document.getElementById("website-url");
const charCounter = document.getElementById("char-counter");

// Start loading the database library as soon as someone touches the form
contactForm.addEventListener("focusin", () => { getFirebase().catch(() => {}); }, { once: true });

nameInput.addEventListener("input", () => nameInput.classList.remove("error"));

messageInput.addEventListener("input", () => {
  messageInput.classList.remove("error");
  const len = messageInput.value.length;
  if (len > 0) { charCounter.hidden = false; charCounter.textContent = `${len} / 2000`; }
  else charCounter.hidden = true;
});

messageInput.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); contactForm.requestSubmit(); }
});

contactForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  // Silent honeypot check
  if (honeypotInput && honeypotInput.value.trim() !== "") {
    showToast("Message sent successfully! 🎉", "success");
    contactForm.reset();
    charCounter.hidden = true;
    return;
  }

  const name = nameInput.value.trim();
  const message = messageInput.value.trim();
  let hasError = false;
  nameInput.classList.remove("error");
  messageInput.classList.remove("error");
  if (!name) { nameInput.classList.add("error"); hasError = true; }
  if (!message) { messageInput.classList.add("error"); hasError = true; }
  if (hasError) { showToast("Please fill out the highlighted fields!", "warning"); return; }

  let lastMsgAt = 0;
  try { lastMsgAt = parseInt(localStorage.getItem("lastMsgAt") || "0", 10); } catch { /* ignore */ }
  if (Date.now() - lastMsgAt < 30000) {
    showToast("Please wait a moment before sending another message.", "warning");
    return;
  }

  submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Sending...';
  submitBtn.disabled = true;

  try {
    const { db, collection, addDoc, serverTimestamp } = await getFirebase();
    await addDoc(collection(db, "messages"), { name, message, timestamp: serverTimestamp() });
    showToast("Message sent successfully! 🎉", "success");
    try { localStorage.setItem("lastMsgAt", Date.now().toString()); } catch { /* ignore */ }
    contactForm.reset();
    charCounter.hidden = true;
  } catch (error) {
    console.error("Error adding document:", error);
    showToast("Oops! Something went wrong connecting to the database.", "error");
  } finally {
    submitBtn.innerHTML = '<i class="fas fa-paper-plane" aria-hidden="true"></i> Send Message';
    submitBtn.disabled = false;
  }
});
