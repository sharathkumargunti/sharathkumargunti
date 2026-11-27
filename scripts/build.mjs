#!/usr/bin/env node
// Pre-renders your essays into static pages. Runs inside the GitHub Action just
// before every deploy (on push, on a schedule, and when you press "Deploy" in the
// admin panel). It does NOT change your Firestore data.
//
// What it writes into the checkout (all regenerated on every run):
//   essays/<slug>.html    one real page per essay with its own title, description,
//                         social-card tags, canonical URL and the article text
//   notes-index.json      list data for /notes and the home page
//   search-index.json     plain text used by the search box (loaded on demand)
//   sitemap.xml, rss.xml
//   notes.html, index.html   the SSR:... marker regions are filled in
//
// If anything goes wrong it exits with an error, so the deploy step never runs and
// the live site keeps its previous version.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { firebaseConfig, SITE } from '../assets/firebase-config.js';
import {
  ESSAY_PATH, esc, stripHtml, toMs, toIso, tagsOf, readingMinutes, makeExcerpt, bylineDate, slugify,
  assignSlugs, addHeadingIds, tocMarkup, purifyHook, jsonForScript, noteCardMarkup,
  latestWidgetMarkup, relatedNotes, articleMarkup,
} from '../assets/util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* Firestore REST                                                      */
/* ------------------------------------------------------------------ */

export function decodeValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) {
    return Object.fromEntries(
      Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decodeValue(x)])
    );
  }
  return null;
}

export function decodeDocument(d) {
  const fields = Object.fromEntries(
    Object.entries(d.fields || {}).map(([k, v]) => [k, decodeValue(v)])
  );
  return { id: String(d.name).split('/').pop(), ...fields, createTime: d.createTime, updateTime: d.updateTime };
}

export async function fetchCollection(name, {
  projectId, apiKey, base = 'https://firestore.googleapis.com', referer, fetchImpl = fetch,
} = {}) {
  const docs = [];
  let pageToken = '';
  do {
    const url = new URL(`${base}/v1/projects/${projectId}/databases/(default)/documents/${name}`);
    url.searchParams.set('pageSize', '100');
    if (apiKey) url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetchImpl(url, { headers: referer ? { Referer: referer } : {} });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 400);
      let hint = '';
      if (res.status === 403) {
        hint = '\n  Hint: the "notes" collection must allow public reads in firestore.rules, and if you restricted ' +
          'the API key by HTTP referrer, the site address must be on its list.';
      }
      throw new Error(`Firestore answered ${res.status} for "${name}": ${body}${hint}`);
    }
    const json = await res.json();
    for (const d of json.documents || []) docs.push(decodeDocument(d));
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
}

/* ------------------------------------------------------------------ */
/* Notes -> page models                                                */
/* ------------------------------------------------------------------ */

export function prepareNotes(rawNotes, render) {
  const slugs = assignSlugs(rawNotes);
  const prepared = rawNotes.map((n) => {
    const html = render(String(n.content ?? ''));
    const { html: bodyHtml, headings } = addHeadingIds(html);
    const plain = stripHtml(html);
    const manual = String(n.excerpt ?? '').trim();
    return {
      id: n.id,
      slug: slugs.get(n.id),
      title: String(n.title ?? '').trim() || 'Untitled',
      tags: tagsOf(n),
      createdAt: toIso(n.createdAt) || toIso(n.createTime),
      updatedAt: toIso(n.updatedAt),
      excerpt: manual || makeExcerpt(plain, 240),
      mins: readingMinutes(plain),
      bodyHtml,
      headings,
      plain,
      previousSlugs: Array.isArray(n.previousSlugs) ? n.previousSlugs.map(slugify).filter(Boolean) : [],
    };
  });
  prepared.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt) || a.slug.localeCompare(b.slug));
  return prepared;
}

export const summaryOf = (n) => ({
  id: n.id, slug: n.slug, title: n.title, excerpt: n.excerpt, tags: n.tags,
  createdAt: n.createdAt, updatedAt: n.updatedAt, mins: n.mins,
});

/* ------------------------------------------------------------------ */
/* Page templates                                                      */
/* ------------------------------------------------------------------ */

const THEME_INIT = `<script>
(function () {
  try {
    var t = localStorage.getItem('theme');
    var dark = t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) {
      document.documentElement.classList.add('dark-mode');
      var m = document.getElementById('theme-color-meta');
      if (m) m.setAttribute('content', '#121212');
    }
  } catch (e) {}
})();
</script>`;

export function renderEssayPage(note, summaries, site = SITE) {
  const url = `${site.url}${ESSAY_PATH}/${note.slug}`;
  const desc = makeExcerpt(note.excerpt, 158);
  const modified = note.updatedAt || note.createdAt;
  const image = `${site.url}/og-default.png`;
  const article = articleMarkup({
    id: note.id,
    title: note.title,
    tags: note.tags,
    dateLine: bylineDate(note.createdAt, note.updatedAt, note.mins),
    bodyHtml: note.bodyHtml,
    tocHtml: tocMarkup(note.headings),
    related: relatedNotes(summaries, note),
  });
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: note.title,
    description: desc,
    image: [image],
    ...(note.createdAt ? { datePublished: note.createdAt } : {}),
    ...(modified ? { dateModified: modified } : {}),
    author: { '@type': 'Person', name: site.name, url: `${site.url}/` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    ...(note.tags.length ? { keywords: note.tags.join(', ') } : {}),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(note.title)} | ${esc(site.name)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#FCE5CD" id="theme-color-meta">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="alternate" type="application/rss+xml" title="Notes &amp; Essays | ${esc(site.name)}" href="/rss.xml">

<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(site.name)}">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="${esc(note.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(site.name)}: notes on geopolitics, defense, economics and AI">
${note.createdAt ? `<meta property="article:published_time" content="${esc(note.createdAt)}">\n` : ''}${modified ? `<meta property="article:modified_time" content="${esc(modified)}">\n` : ''}<meta property="article:author" content="${esc(site.url)}/">
${note.tags.map((t) => `<meta property="article:tag" content="${esc(t)}">`).join('\n')}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(note.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="twitter:image:alt" content="${esc(site.name)}: notes on geopolitics, defense, economics and AI">
<script type="application/ld+json">${jsonForScript(ld)}</script>

${THEME_INIT}

<link rel="preconnect" href="https://cdnjs.cloudflare.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<link rel="stylesheet" href="/assets/base.css">
<link rel="stylesheet" href="/assets/site.css">
<link rel="modulepreload" href="/assets/essay.js">
<link rel="modulepreload" href="/assets/article.js">
<link rel="modulepreload" href="/assets/site.js">
<link rel="modulepreload" href="/assets/firebase-config.js">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<div id="progress-container" aria-hidden="true"><div id="progress-bar"></div></div>
<nav class="top-nav" id="main-nav" aria-label="Site">
  <a href="/notes" class="back-link" id="back-link"><i class="fas fa-arrow-left" aria-hidden="true"></i> <span id="back-text">All Notes</span></a>
  <button type="button" class="theme-toggle" id="dark-mode-toggle" aria-label="Dark mode" aria-pressed="false" title="Toggle theme"><i class="fas fa-sun" aria-hidden="true"></i><i class="fas fa-moon" aria-hidden="true"></i></button>
</nav>
<div id="lightbox" class="lightbox-overlay" role="dialog" aria-modal="true" aria-label="Image viewer" aria-hidden="true" tabindex="-1"><img id="lightbox-img" class="lightbox-img" alt=""></div>
<button type="button" id="scroll-top" class="scroll-top-btn" aria-label="Scroll to top"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
<main id="main">
<div class="reading-wrapper">
${article}
</div>
</main>
<div id="toast-container" role="status" aria-live="polite"></div>
<script type="module" src="/assets/essay.js"></script>
</body>
</html>
`;
}

export function renderRedirectPage(toSlug, site = SITE) {
  const to = `${ESSAY_PATH}/${toSlug}`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Redirecting</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="${esc(site.url + to)}">
<meta http-equiv="refresh" content="0; url=${esc(to)}">
</head><body><p>This essay has a new address: <a href="${esc(to)}">${esc(site.url + to)}</a></p>
<script>location.replace(${JSON.stringify(to)});</script></body></html>
`;
}

/* ------------------------------------------------------------------ */
/* Sitemap, RSS, marker injection                                      */
/* ------------------------------------------------------------------ */

export function buildSitemap(notes, site = SITE) {
  const day = (iso) => (iso ? iso.slice(0, 10) : '');
  const newest = notes.reduce((m, n) => Math.max(m, toMs(n.updatedAt || n.createdAt)), 0);
  const newestDay = newest ? new Date(newest).toISOString().slice(0, 10) : '';
  const urls = [
    { loc: `${site.url}/`, lastmod: newestDay },
    { loc: `${site.url}/notes`, lastmod: newestDay },
    ...notes.map((n) => ({ loc: `${site.url}${ESSAY_PATH}/${n.slug}`, lastmod: day(n.updatedAt || n.createdAt) })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url>\n    <loc>${esc(u.loc)}</loc>${u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : ''}\n  </url>`).join('\n') +
    `\n</urlset>\n`;
}

const xmlEsc = (s) => esc(String(s ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''));

export function buildRss(notes, site = SITE, now = new Date()) {
  const items = notes.slice(0, 30).map((n) => {
    const link = `${site.url}${ESSAY_PATH}/${n.slug}`;
    return [
      '    <item>',
      `      <title>${xmlEsc(n.title)}</title>`,
      `      <link>${esc(link)}</link>`,
      `      <guid isPermaLink="true">${esc(link)}</guid>`,
      n.createdAt ? `      <pubDate>${new Date(n.createdAt).toUTCString()}</pubDate>` : null,
      `      <description>${xmlEsc(n.excerpt)}</description>`,
      ...n.tags.map((t) => `      <category>${xmlEsc(t)}</category>`),
      '    </item>',
    ].filter(Boolean).join('\n');
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Notes &amp; Essays | ${xmlEsc(site.name)}</title>
    <link>${esc(site.url)}/notes</link>
    <atom:link href="${esc(site.url)}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Deep dives into UPSC CSE topics, geopolitics, Indian defense, the economy and AI.</description>
    <language>en-in</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
${items.join('\n')}
  </channel>
</rss>
`;
}

/** Replaces what sits between <!--SSR:NAME--> and <!--/SSR:NAME--> (markers are kept). */
export function injectMarker(html, name, content) {
  const re = new RegExp(`(<!--SSR:${name}-->)[\\s\\S]*?(<!--\\/SSR:${name}-->)`);
  if (!re.test(html)) throw new Error(`Marker <!--SSR:${name}--> was not found. Was it removed from the page?`);
  return html.replace(re, (_m, open, close) => open + content + close);
}

/* ------------------------------------------------------------------ */
/* Build                                                               */
/* ------------------------------------------------------------------ */

export async function build({ root = ROOT, rawNotes, render, site = SITE, now = new Date() }) {
  const notes = prepareNotes(rawNotes, render);
  if (!notes.length && !process.env.ALLOW_EMPTY) {
    throw new Error('Firestore returned no notes. Refusing to publish an empty site. ' +
      '(Set ALLOW_EMPTY=1 if that is really what you want.)');
  }
  const summaries = notes.map(summaryOf);

  const notesDir = path.join(root, ESSAY_PATH.slice(1));
  await fs.rm(notesDir, { recursive: true, force: true });
  await fs.mkdir(notesDir, { recursive: true });

  for (const n of notes) {
    await fs.writeFile(path.join(notesDir, `${n.slug}.html`), renderEssayPage(n, summaries, site));
  }

  // Old addresses of renamed essays keep working
  const taken = new Set(notes.map((n) => n.slug));
  let redirects = 0;
  for (const n of notes) {
    for (const old of n.previousSlugs) {
      if (taken.has(old)) continue;
      taken.add(old);
      await fs.writeFile(path.join(notesDir, `${old}.html`), renderRedirectPage(n.slug, site));
      redirects += 1;
    }
  }

  const builtAt = now.toISOString();
  await fs.writeFile(path.join(root, 'notes-index.json'), JSON.stringify({ builtAt, notes: summaries }));
  await fs.writeFile(
    path.join(root, 'search-index.json'),
    JSON.stringify(Object.fromEntries(notes.map((n) => [n.slug, n.plain.slice(0, 20000)])))
  );
  await fs.writeFile(path.join(root, 'sitemap.xml'), buildSitemap(notes, site));
  await fs.writeFile(path.join(root, 'rss.xml'), buildRss(notes, site, now));

  // Fill the marker regions in the two pages that list essays
  const notesPage = path.join(root, 'notes.html');
  let html = await fs.readFile(notesPage, 'utf8');
  html = injectMarker(html, 'NOTES', summaries
    .map((n, i) => noteCardMarkup(n, { featured: i === 0, delay: 0, animate: false })).join(''));
  html = html.replace('id="notes-list" aria-busy="true"', 'id="notes-list" aria-busy="false"');
  html = injectMarker(html, 'NOTESJSON', `<script type="application/json" id="ssr-notes">${jsonForScript(summaries)}</script>`);
  await fs.writeFile(notesPage, html);

  const homePage = path.join(root, 'index.html');
  html = await fs.readFile(homePage, 'utf8');
  if (summaries.length) {
    html = injectMarker(html, 'LATEST',
      `<div id="latest-note-widget" class="clickable">${latestWidgetMarkup(summaries[0])}</div>`);
  }
  html = injectMarker(html, 'HOME', `<script type="application/json" id="ssr-home">${jsonForScript({ builtAt, ids: summaries.map((n) => n.id) })}</script>`);
  await fs.writeFile(homePage, html);

  return { count: notes.length, redirects, builtAt, slugs: notes.map((n) => n.slug) };
}

/* ------------------------------------------------------------------ */
/* Markdown -> sanitised HTML (same libraries as the browser reader)   */
/* ------------------------------------------------------------------ */

export async function createRenderer(site = SITE) {
  const [{ marked }, { JSDOM }, { default: createDOMPurify }] = await Promise.all([
    import('marked'), import('jsdom'), import('dompurify'),
  ]);
  const DOMPurify = createDOMPurify(new JSDOM('').window);
  const siteHost = new URL(site.url).hostname;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => purifyHook(node, siteHost));
  return (markdown) => DOMPurify.sanitize(marked.parse(String(markdown ?? '')));
}

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  const apiKey = process.env.FIREBASE_API_KEY || firebaseConfig.apiKey;
  const base = process.env.FIRESTORE_REST_BASE || 'https://firestore.googleapis.com';

  console.log(`Reading notes from Firestore project "${projectId}" ...`);
  const rawNotes = await fetchCollection('notes', { projectId, apiKey, base, referer: `${SITE.url}/` });
  console.log(`  ${rawNotes.length} note(s) found`);

  const render = await createRenderer();
  const result = await build({ rawNotes, render });

  console.log(`Built ${result.count} essay page(s)` + (result.redirects ? ` and ${result.redirects} redirect(s)` : '') + ':');
  result.slugs.forEach((s) => console.log(`  ${ESSAY_PATH}/${s}`));
  console.log('Wrote notes-index.json, search-index.json, sitemap.xml, rss.xml and filled notes.html / index.html.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    console.error(`\nSite build failed: ${msg}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=Site build failed::${msg.split('\n')[0]}`);
    process.exit(1);
  });
}
