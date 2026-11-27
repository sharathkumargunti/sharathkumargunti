// Pure helpers shared by the public pages, the admin panel and scripts/build.mjs.
// Nothing in this file touches the DOM or browser globals, so it also runs in Node.
// Keeping slug, excerpt and markup logic in ONE place means the admin panel, the
// static build and the browser can never disagree about a note's URL or card.

export const SITE_TZ = 'Asia/Kolkata';

// Where the generated essay pages live: /essays/<slug>. (Not under /notes/, because /notes is the
// list page and a folder with the same name as a page can confuse static hosting.)
export const ESSAY_PATH = '/essays';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Escape for HTML text AND attribute values (quotes included). */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
}

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const hex = e[1] === 'x' || e[1] === 'X';
      const cp = hex ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}

/** Plain text from (already sanitised) HTML. */
export function stripHtml(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

/** Rough plain text from Markdown (cheap fallback; the build uses real HTML). */
export function roughPlainFromMarkdown(md) {
  return String(md ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[\s>#*+-]+/gm, ' ')
    .replace(/[*_`~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

/** Milliseconds from an ISO string, Date, number or Firestore Timestamp. */
export function toMs(t) {
  if (!t) return 0;
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  const ms = new Date(t).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function toIso(t) {
  const ms = toMs(t);
  return ms ? new Date(ms).toISOString() : '';
}

export function tagsOf(n) {
  const list = Array.isArray(n.tags) && n.tags.length ? n.tags : (n.tag ? [n.tag] : []);
  return [...new Set(list.map((t) => String(t ?? '').trim()).filter(Boolean))];
}

export function readingMinutes(text) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function makeExcerpt(text, max = 240) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.\-\u2013\u2014]+$/, '') + '\u2026';
}

export function formatDate(t) {
  const ms = toMs(t);
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-IN', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: SITE_TZ,
  });
}

export function bylineDate(createdAt, updatedAt, mins) {
  const c = formatDate(createdAt);
  const u = formatDate(updatedAt);
  let part = c || u || '';
  if (c && u && c !== u) part = `${c} (Updated ${u})`;
  return part ? `${part} \u2022 ${mins} min read` : `${mins} min read`;
}

/* ---------------- slugs ---------------- */

const RESERVED_SLUGS = new Set(['index']);

/** Slug for one note: its own `slug` field, else the title, else a short id. */
export function baseSlug(note) {
  const own = slugify(note.slug);
  if (own) return own;
  const fromTitle = slugify(note.title);
  if (fromTitle) return fromTitle;
  return 'note-' + String(note.id || '').slice(0, 6).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Unique slug per note (Map id -> slug). Deterministic: the oldest note keeps the
 * clean slug, later duplicates get -2, -3 ...
 */
export function assignSlugs(notes) {
  const order = [...notes].sort(
    (a, b) => (toMs(a.createdAt) - toMs(b.createdAt)) || String(a.id).localeCompare(String(b.id))
  );
  const used = new Set(RESERVED_SLUGS);
  const map = new Map();
  for (const n of order) {
    const s = baseSlug(n);
    let out = s;
    let i = 2;
    while (used.has(out)) out = `${s}-${i++}`;
    used.add(out);
    map.set(n.id, out);
  }
  return map;
}

/* ---------------- article HTML helpers (string based, no DOM) ---------------- */

const RESERVED_IDS = new Set([
  'main', 'article-title', 'article-body', 'lightbox', 'lightbox-img', 'toast-container',
  'progress-bar', 'progress-container', 'main-nav', 'back-link', 'notes-list', 'read-next-grid',
  'rn-title', 'toc-title', 'bookmark-btn', 'scroll-top', 'dark-mode-toggle',
]);

/** Adds stable, readable ids to h2/h3 and returns them for a table of contents. */
export function addHeadingIds(html) {
  const used = new Set();
  const headings = [];
  let n = 0;
  const out = String(html ?? '').replace(
    /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi,
    (_m, lvl, attrs, inner) => {
      n += 1;
      const text = stripHtml(inner);
      let base = slugify(text) || `section-${n}`;
      if (RESERVED_IDS.has(base)) base = `section-${base}`;
      let id = base;
      let k = 2;
      while (used.has(id)) id = `${base}-${k++}`;
      used.add(id);
      headings.push({ level: Number(lvl), id, text });
      const clean = (attrs || '').replace(/\sid\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, '');
      return `<h${lvl}${clean} id="${id}">${inner}</h${lvl}>`;
    }
  );
  return { html: out, headings };
}

export function tocMarkup(headings) {
  if (!headings || headings.length <= 2) return '';
  const items = headings
    .map((h) => `<li${h.level === 3 ? ' class="toc-h3"' : ''}><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`)
    .join('');
  return `<nav class="toc-card" aria-labelledby="toc-title"><div class="toc-title" id="toc-title">Table of contents</div><ul>${items}</ul></nav>`;
}

/**
 * DOMPurify `afterSanitizeAttributes` hook: external links open in a new tab and
 * every image loads lazily. Works on browser and jsdom nodes (no globals used).
 */
export function purifyHook(node, siteHost = '') {
  const name = String(node && node.nodeName || '').toUpperCase();
  if (name === 'A') {
    const href = node.getAttribute('href');
    if (href && /^https?:\/\//i.test(href)) {
      let host = '';
      try { host = new URL(href).hostname; } catch { /* ignore */ }
      if (host && host !== siteHost) {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
      }
    }
  } else if (name === 'IMG') {
    node.setAttribute('loading', 'lazy');
    node.setAttribute('decoding', 'async');
  }
}

/** JSON that is safe to place inside <script type="application/json">. */
export function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/* ---------------- shared markup ---------------- */

/** Note summary shape used everywhere: {id, slug, href?, title, excerpt, tags, createdAt, updatedAt, mins} */
export function noteCardMarkup(n, { featured = false, delay = 0, animate = true } = {}) {
  const href = n.href || `${ESSAY_PATH}/${n.slug}`;
  const tag = (n.tags && n.tags[0]) || '';
  const date = formatDate(n.createdAt || n.updatedAt);
  const style = animate ? ` style="animation-delay:${delay}s"` : ' style="animation:none;opacity:1"';
  return (
    `<a href="${esc(href)}" class="note-card${featured ? ' featured' : ''}" data-id="${esc(n.id)}"${style}>` +
    `<div><div class="note-meta"><span class="note-date">${date ? esc(date) + ' &bull; ' : ''}${esc(n.mins)} min read</span>` +
    `${tag ? `<span class="note-tag-badge">${esc(tag)}</span>` : ''}</div>` +
    `<h3>${esc(n.title || 'Untitled')}</h3></div>` +
    `<p class="note-preview">${esc(n.excerpt || '')}</p></a>`
  );
}

/** Link used inside the home page "Latest essay" widget. */
export function latestWidgetMarkup(n) {
  const tag = (n.tags && n.tags[0]) || '';
  return (
    `<a class="latest-link" href="${esc(n.href || ESSAY_PATH + '/' + n.slug)}">` +
    `<span class="latest-header"><span class="latest-label">Latest essay</span>` +
    `<span class="latest-meta">${tag ? esc(tag) + ' &bull; ' : ''}${esc(n.mins)} min read</span></span>` +
    `<span class="latest-title">${esc(n.title || 'Untitled')}</span></a>`
  );
}

export function relatedNotes(all, current, count = 2) {
  const mine = new Set(current.tags || []);
  const overlap = (n) => (n.tags || []).filter((t) => mine.has(t)).length;
  return all
    .filter((n) => n.id !== current.id)
    .sort((a, b) => overlap(b) - overlap(a) || toMs(b.createdAt) - toMs(a.createdAt))
    .slice(0, count);
}

/** The article block used by the static essay pages and the in-browser reader. */
export function articleMarkup({ id, title, tags = [], dateLine, bodyHtml, tocHtml = '', related = [] }) {
  const tagRow = tags.length
    ? `<div class="article-tags-row">${tags
        .map((t) => `<a class="article-tag" href="/notes?tag=${encodeURIComponent(t)}" title="All essays tagged ${esc(t)}">${esc(t)}</a>`)
        .join('')}</div>`
    : '';
  const rel = related.length
    ? `<section class="read-next-section" aria-labelledby="rn-title">` +
      `<h2 class="read-next-title" id="rn-title"><i class="fas fa-layer-group" aria-hidden="true"></i> Keep reading</h2>` +
      `<div class="notes-grid" id="read-next-grid">${related
        .map((n, i) => noteCardMarkup(n, { delay: i * 0.08 }))
        .join('')}</div></section>`
    : '';
  return (
    `<article class="article" data-note-id="${esc(id)}" data-title="${esc(title)}">` +
    tagRow +
    `<h1 class="article-title" id="article-title" tabindex="-1">${esc(title)}</h1>` +
    `<div class="author-byline"><img src="/profile_photo.jpg" alt="Sharath Kumar Gunti" class="author-pic" width="52" height="52" loading="lazy" decoding="async">` +
    `<div class="author-info"><p class="author-name">Sharath Kumar Gunti</p><p class="author-date">${esc(dateLine)}</p></div></div>` +
    tocHtml +
    `<div class="note-body" id="article-body">${bodyHtml}</div>` +
    `<div class="share-section"><span class="share-title">Enjoyed this essay?</span><div class="share-buttons">` +
    `<button type="button" class="share-btn" id="bookmark-btn" aria-pressed="false" aria-label="Save for later" title="Save for later"><i class="far fa-bookmark" aria-hidden="true"></i></button>` +
    `<div class="share-divider" aria-hidden="true"></div>` +
    `<button type="button" class="share-btn" id="copy-link-btn" aria-label="Copy link" title="Copy link"><i class="fas fa-link" aria-hidden="true"></i></button>` +
    `<button type="button" class="share-btn" id="share-x-btn" aria-label="Share on X" title="Share on X"><i class="fa-brands fa-x-twitter" aria-hidden="true"></i></button>` +
    `<button type="button" class="share-btn" id="share-wa-btn" aria-label="Share on WhatsApp" title="Share on WhatsApp"><i class="fa-brands fa-whatsapp" aria-hidden="true"></i></button>` +
    `<button type="button" class="share-btn" id="share-tg-btn" aria-label="Share on Telegram" title="Share on Telegram"><i class="fa-brands fa-telegram" aria-hidden="true"></i></button>` +
    `<button type="button" class="share-btn" id="share-native-btn" aria-label="Share" title="Share" hidden><i class="fas fa-share-nodes" aria-hidden="true"></i></button>` +
    `</div></div>` +
    rel +
    `</article>`
  );
}
