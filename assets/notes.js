// Entry point for /notes: the essay list (pre-rendered by the build, enhanced here)
// and a fallback reader for essays that have not been built into /essays/<slug> yet.
import { initTheme, startAnalytics, readSaved, loadScript, LIBS } from "/assets/site.js";
import { SITE } from "/assets/firebase-config.js";
import { getFirebase } from "/assets/firebase.js";
import {
  ESSAY_PATH, esc, tagsOf, toIso, bylineDate, readingMinutes, makeExcerpt, roughPlainFromMarkdown, stripHtml,
  assignSlugs, noteCardMarkup, articleMarkup, addHeadingIds, tocMarkup, purifyHook, relatedNotes,
} from "/assets/util.js";
import { enhanceArticle, initArticleUi, syncBookmark } from "/assets/article.js";

const $ = (id) => document.getElementById(id);
const gridView = $("grid-view");
const singleNote = $("single-note");
const listEl = $("notes-list");
const filterBar = $("filter-bar");
const searchInput = $("note-search");
const resultsMeta = $("results-meta");
const backLink = $("back-link");
const backText = $("back-text");
const progressBox = $("progress-container");

initTheme();
initArticleUi({ progress: true });
startAnalytics();

function readSsr() {
  try {
    const el = $("ssr-notes");
    const v = el ? JSON.parse(el.textContent) : null;
    return Array.isArray(v) && v.length ? v : null;
  } catch { return null; }
}
const ssr = readSsr();
const params = new URLSearchParams(location.search);

/* ======================================================================
   LIST
   ====================================================================== */
let notes = [];
let activeFilter = (params.get("tag") || params.get("topic") || "all").trim().toLowerCase() || "all";
let searchText = "";
let searchIndex = null;
let searchIndexPromise = null;
let saved = readSaved();

function emptyState(icon, text) {
  return `<div class="empty-state"><i class="fas ${icon}" aria-hidden="true"></i><p>${esc(text)}</p></div>`;
}

function toSummary(n, slug, plain) {
  return {
    id: n.id, slug,
    href: `/notes?id=${encodeURIComponent(n.id)}`,
    title: n.title || "Untitled",
    excerpt: (n.excerpt || "").trim() || makeExcerpt(plain, 240),
    tags: tagsOf(n),
    createdAt: toIso(n.createdAt),
    updatedAt: toIso(n.updatedAt),
    mins: readingMinutes(plain),
    _plain: plain.toLowerCase().slice(0, 20000),
  };
}

// Only used when the page was not pre-rendered (for example a local preview).
async function loadLiveSummaries() {
  const { db, collection, getDocs, query, orderBy } = await getFirebase();
  const snap = await getDocs(query(collection(db, "notes"), orderBy("createdAt", "desc")));
  const raw = [];
  snap.forEach((d) => raw.push({ id: d.id, ...d.data() }));
  const slugs = assignSlugs(raw);
  return raw.map((n) => toSummary(n, slugs.get(n.id), roughPlainFromMarkdown(n.content)));
}

function loadSearchIndex() {
  if (!searchIndexPromise) {
    searchIndexPromise = fetch("/search-index.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((j) => { searchIndex = j || {}; applyFilters(false); });
  }
  return searchIndexPromise;
}

function buildFilters() {
  const counts = {};
  notes.forEach((n) => tagsOf(n).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const savedCount = notes.filter((n) => saved.includes(n.id)).length;

  let html =
    `<div class="filter-group">` +
    `<button type="button" class="filter-tag" data-filter="all">All Topics <span class="pill-count">${notes.length}</span></button>` +
    `<button type="button" class="filter-tag" data-filter="saved"><i class="fas fa-bookmark" aria-hidden="true"></i> Saved <span class="pill-count" id="saved-pill-count">${savedCount}</span></button>` +
    `</div>`;
  if (tags.length) {
    html += `<div class="filter-divider"></div><div class="filter-group">` +
      tags.map((t) => `<button type="button" class="filter-tag" data-filter="${esc(t)}">${esc(t)} <span class="pill-count">${counts[t]}</span></button>`).join("") +
      `</div>`;
  }
  filterBar.innerHTML = html;
  syncFilterPills();
}

function syncFilterPills() {
  let matched = false;
  filterBar.querySelectorAll(".filter-tag").forEach((btn) => {
    const on = (btn.dataset.filter || "").trim().toLowerCase() === activeFilter;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", String(on));
    if (on) matched = true;
  });
  if (!matched) {
    activeFilter = "all";
    const all = filterBar.querySelector('.filter-tag[data-filter="all"]');
    if (all) { all.classList.add("active"); all.setAttribute("aria-pressed", "true"); }
  }
}

function matches(n, terms) {
  let tagOk;
  if (activeFilter === "all") tagOk = true;
  else if (activeFilter === "saved") tagOk = saved.includes(n.id);
  else tagOk = tagsOf(n).some((t) => t.toLowerCase() === activeFilter);
  if (!tagOk) return false;
  if (!terms.length) return true;
  const body = (searchIndex && searchIndex[n.slug]) || n._plain || "";
  const hay = `${n.title || ""} ${n.excerpt || ""} ${tagsOf(n).join(" ")} ${body}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function applyFilters(animate = true) {
  if (!notes.length) {
    listEl.innerHTML = emptyState("fa-pen-nib", "No essays published yet.");
    listEl.setAttribute("aria-busy", "false");
    return;
  }
  const terms = searchText.split(/\s+/).filter(Boolean);
  const filtered = notes.filter((n) => matches(n, terms));

  if (!filtered.length) {
    const msg = activeFilter === "saved" && !searchText
      ? "You have not saved any essays yet."
      : searchText ? `No essays match "${searchText}".` : "No essays in this topic yet.";
    listEl.innerHTML = emptyState(activeFilter === "saved" ? "fa-bookmark" : "fa-search", msg);
  } else {
    const featuredOn = activeFilter === "all" && !searchText;
    listEl.innerHTML = filtered
      .map((n, i) => noteCardMarkup(n, { featured: featuredOn && i === 0, delay: Math.min(i, 8) * 0.06, animate }))
      .join("");
  }
  listEl.setAttribute("aria-busy", "false");

  if (resultsMeta) {
    resultsMeta.textContent = activeFilter === "all" && !searchText
      ? ""
      : `${filtered.length} of ${notes.length} ${notes.length === 1 ? "essay" : "essays"}`;
  }
}

async function openList() {
  progressBox.style.display = "none";
  try {
    notes = ssr || (await loadLiveSummaries());
  } catch (err) {
    console.error("Could not load notes:", err);
    listEl.innerHTML = emptyState("fa-exclamation-triangle", "Could not load notes. Please refresh the page.");
    listEl.setAttribute("aria-busy", "false");
    return;
  }
  buildFilters();
  applyFilters(!ssr); // pre-rendered cards are already visible: do not replay the entrance animation

  filterBar.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-tag");
    if (!btn) return;
    activeFilter = (btn.dataset.filter || "all").trim().toLowerCase();
    syncFilterPills();
    applyFilters(true);
    history.replaceState(null, "", activeFilter !== "all" ? `/notes?tag=${encodeURIComponent(activeFilter)}` : "/notes");
  });

  searchInput.addEventListener("input", () => {
    searchText = searchInput.value.trim().toLowerCase();
    if (searchText) loadSearchIndex();
    applyFilters(false);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.activeElement === searchInput && searchInput.value) {
      searchInput.value = "";
      searchText = "";
      applyFilters(false);
      searchInput.blur();
    } else if (e.key === "/" && document.activeElement !== searchInput && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

/* ======================================================================
   FALLBACK READER (essays published since the last build)
   ====================================================================== */
function readerMessage(icon, text) {
  singleNote.innerHTML =
    `<div class="reader-status"><i class="fas ${icon}" aria-hidden="true"></i><p>${esc(text)}</p>` +
    `<p><a href="/notes">Browse all essays</a></p></div>`;
}

async function fetchNote(id, slug) {
  const { db, collection, doc, getDoc, getDocs, query, where, limit } = await getFirebase();
  if (id) {
    const s = await getDoc(doc(db, "notes", id));
    if (s.exists()) return { id: s.id, ...s.data() };
  }
  if (slug) {
    const q = await getDocs(query(collection(db, "notes"), where("slug", "==", slug), limit(1)));
    if (!q.empty) { const d = q.docs[0]; return { id: d.id, ...d.data() }; }
    // Older essays have no slug field: match the slug derived from the title.
    const all = await getDocs(query(collection(db, "notes")));
    const raw = [];
    all.forEach((d) => raw.push({ id: d.id, ...d.data() }));
    const map = assignSlugs(raw);
    return raw.find((n) => map.get(n.id) === slug) || null;
  }
  return null;
}

async function renderReader(note) {
  await Promise.all([loadScript(LIBS.marked), loadScript(LIBS.purify)]);
  if (!window.__purifyHooked) {
    const host = new URL(SITE.url).hostname;
    window.DOMPurify.addHook("afterSanitizeAttributes", (n) => purifyHook(n, host));
    window.__purifyHooked = true;
  }
  const clean = window.DOMPurify.sanitize(window.marked.parse(String(note.content || "")));
  const { html: bodyHtml, headings } = addHeadingIds(clean);
  const mins = readingMinutes(stripHtml(clean));
  const tags = tagsOf(note);
  const title = note.title || "Untitled";

  singleNote.innerHTML = articleMarkup({
    id: note.id, title, tags,
    dateLine: bylineDate(note.createdAt, note.updatedAt, mins),
    bodyHtml, tocHtml: tocMarkup(headings),
    related: ssr ? relatedNotes(ssr, { id: note.id, tags }) : [],
  });
  document.title = `${title} | Sharath Kumar Gunti`;
  enhanceArticle($("article-body"));
  syncBookmark();

  const h1 = $("article-title");
  if (h1) h1.focus({ preventScroll: true });
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
}

async function openReader(id, slug) {
  // The build already made a real page for this essay: go there.
  const hit = ssr && ssr.find((n) => (id && n.id === id) || (slug && n.slug === slug));
  if (hit) { location.replace(`${ESSAY_PATH}/${hit.slug}${location.hash}`); return; }

  gridView.style.display = "none";
  singleNote.style.display = "block";
  progressBox.style.display = "";
  backLink.href = "/notes";
  backText.textContent = "All Notes";
  document.title = "Loading essay | Sharath Kumar Gunti";
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex"; // the pre-rendered page is the one to index
  document.head.appendChild(robots);
  singleNote.innerHTML = `<div class="reader-status" role="status"><div class="spin"></div><p>Loading essay...</p></div>`;

  try {
    const note = await fetchNote(id, slug);
    if (!note) { document.title = "Essay not found | Sharath Kumar Gunti"; readerMessage("fa-exclamation-triangle", "This essay could not be found."); return; }
    await renderReader(note);
  } catch (err) {
    console.error("Could not load essay:", err);
    readerMessage("fa-exclamation-triangle", "Could not load this essay. Please try again.");
  }
}

/* ---------------- route ---------------- */
const wantId = params.get("id");
const wantSlug = params.get("slug");
if (wantId || wantSlug) openReader(wantId, wantSlug);
else openList();
