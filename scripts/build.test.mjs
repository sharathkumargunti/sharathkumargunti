// Run with:  npm test      (no extra packages needed)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  slugify, assignSlugs, addHeadingIds, tocMarkup, stripHtml, esc, makeExcerpt, jsonForScript, purifyHook,
} from '../assets/util.js';
import {
  decodeDocument, prepareNotes, buildSitemap, buildRss, injectMarker, renderEssayPage, build, fetchCollection,
} from './build.mjs';

const fakeRender = (md) => md.split('\n\n')
  .map((p) => (p.startsWith('## ') ? `<h2>${esc(p.slice(3))}</h2>` : `<p>${esc(p)}</p>`)).join('');

test('slugify', () => {
  assert.equal(slugify("India's Rafale deal: what next?"), 'indias-rafale-deal-what-next');
  assert.equal(slugify('  Café & Crème  '), 'cafe-and-creme');
  assert.equal(slugify('తెలంగాణ'), '');
});

test('assignSlugs: unique, deterministic, oldest keeps the clean slug', () => {
  const notes = [
    { id: 'b2', title: 'Same title', createdAt: '2026-02-01T00:00:00Z' },
    { id: 'a1', title: 'Same title', createdAt: '2026-01-01T00:00:00Z' },
    { id: 'c3', title: 'Index', createdAt: '2026-03-01T00:00:00Z' },
    { id: 'XyZ123456', title: '', createdAt: '2026-04-01T00:00:00Z' },
    { id: 'd4', title: 'Whatever', slug: 'My Custom Slug!', createdAt: '2026-05-01T00:00:00Z' },
  ];
  const m = assignSlugs(notes);
  assert.equal(m.get('a1'), 'same-title');
  assert.equal(m.get('b2'), 'same-title-2');
  assert.equal(m.get('c3'), 'index-2'); // "index" is reserved
  assert.equal(m.get('XyZ123456'), 'note-xyz123');
  assert.equal(m.get('d4'), 'my-custom-slug');
});

test('addHeadingIds + toc', () => {
  const { html, headings } = addHeadingIds('<h2>Main</h2><p>x</p><h3 id="old">Why? Why?</h3><h2>Main</h2>');
  assert.deepEqual(headings.map((h) => h.id), ['section-main', 'why-why', 'section-main-2']);
  assert.match(html, /<h3 id="why-why">/);
  assert.equal(tocMarkup(headings.slice(0, 2)), '');
  assert.match(tocMarkup(headings), /href="#why-why"/);
});

test('stripHtml / esc / makeExcerpt', () => {
  assert.equal(stripHtml('<p>A &amp; B&nbsp;<b>C</b></p><script>x()</script>'), 'A & B C');
  assert.equal(esc(`"'<>&`), '&#34;&#39;&#60;&#62;&#38;');
  const long = 'word '.repeat(100);
  assert.ok(makeExcerpt(long, 50).length <= 51);
  assert.match(makeExcerpt(long, 50), /…$/);
  assert.equal(jsonForScript({ a: '</script>' }), '{"a":"\\u003c/script>"}');
});

test('decodeDocument handles Firestore REST value types', () => {
  const d = decodeDocument({
    name: 'projects/p/databases/(default)/documents/notes/abc123',
    fields: {
      title: { stringValue: 'T' }, n: { integerValue: '5' }, ok: { booleanValue: true },
      createdAt: { timestampValue: '2026-01-02T03:04:05Z' },
      tags: { arrayValue: { values: [{ stringValue: 'x' }, { stringValue: 'y' }] } },
      empty: { arrayValue: {} },
    },
    createTime: '2026-01-02T03:04:05Z',
  });
  assert.equal(d.id, 'abc123');
  assert.deepEqual(d.tags, ['x', 'y']);
  assert.deepEqual(d.empty, []);
  assert.equal(d.n, 5);
});

test('essay page: metadata is present and hostile titles are escaped', () => {
  const notes = prepareNotes([{
    id: 'n1', title: 'A "quoted" <b>title</b> & more', tags: ['AI & Tech'], createdAt: '2026-01-02T03:04:05Z',
    content: '## Part one\n\nHello world.\n\n## Part two\n\nMore.\n\n## Part three\n\nEnd.',
  }], fakeRender);
  const page = renderEssayPage(notes[0], notes.map((n) => ({ ...n })));
  assert.match(page, /<link rel="canonical" href="https:\/\/sharathkumargunti\.web\.app\/essays\/a-quoted-b-title-b-and-more">/);
  assert.match(page, /property="og:title" content="A &#34;quoted&#34; &#60;b&#62;title&#60;\/b&#62; &#38; more"/);
  assert.match(page, /<nav class="toc-card"/);
  assert.match(page, /<script type="module" src="\/assets\/essay\.js">/);
  assert.ok(!page.includes('<b>title</b>'));
});

test('injectMarker keeps markers and tolerates $ in content', () => {
  const html = 'a<!--SSR:X-->old<!--/SSR:X-->b';
  assert.equal(injectMarker(html, 'X', 'cost $& $1'), 'a<!--SSR:X-->cost $& $1<!--/SSR:X-->b');
  assert.throws(() => injectMarker(html, 'NOPE', ''), /NOPE/);
});

test('sitemap and rss escape special characters and strip XML control chars', () => {
  const notes = prepareNotes([{
    id: 'n1', title: 'Tom &\x00\x08 Jerry', createdAt: '2026-01-02T03:04:05Z', content: 'Hi\x1F there',
  }], fakeRender);
  assert.match(buildSitemap(notes), /<loc>https:\/\/sharathkumargunti\.web\.app\/essays\/tom-and-jerry<\/loc>/);
  const rss = buildRss(notes);
  assert.match(rss, /<title>Tom &#38; Jerry<\/title>/);
  assert.match(rss, /<description>Hi there<\/description>/);
  assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(rss));
});

test('purifyHook: external links open in a new tab, images are lazy', () => {
  const mk = (name, attrs) => ({ nodeName: name, attrs: { ...attrs }, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const ext = mk('A', { href: 'https://example.com/x' });
  const own = mk('A', { href: 'https://sharathkumargunti.web.app/notes' });
  const img = mk('IMG', { src: '/a.png' });
  purifyHook(ext, 'sharathkumargunti.web.app');
  purifyHook(own, 'sharathkumargunti.web.app');
  purifyHook(img, 'sharathkumargunti.web.app');
  assert.equal(ext.attrs.target, '_blank');
  assert.equal(ext.attrs.rel, 'noopener noreferrer');
  assert.equal(own.attrs.target, undefined);
  assert.equal(img.attrs.loading, 'lazy');
});

test('fetchCollection pages through results and explains 403', async () => {
  const pages = [
    { documents: [{ name: 'x/notes/a', fields: {} }], nextPageToken: 't1' },
    { documents: [{ name: 'x/notes/b', fields: {} }] },
  ];
  const seen = [];
  const ok = await fetchCollection('notes', {
    projectId: 'p', apiKey: 'k', referer: 'https://r/',
    fetchImpl: async (url, opts) => { seen.push({ url: String(url), referer: opts.headers.Referer }); return { ok: true, json: async () => pages.shift() }; },
  });
  assert.deepEqual(ok.map((d) => d.id), ['a', 'b']);
  assert.match(seen[1].url, /pageToken=t1/);
  assert.equal(seen[0].referer, 'https://r/');
  await assert.rejects(
    fetchCollection('notes', { projectId: 'p', fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'denied' }) }),
    /403[\s\S]*Hint/
  );
});

test('build writes pages, indexes and fills the markers; refuses an empty site', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'site-'));
  await fs.writeFile(path.join(root, 'notes.html'), '<div id="notes-list" aria-busy="true"><!--SSR:NOTES-->x<!--/SSR:NOTES--></div><!--SSR:NOTESJSON--><script type="application/json" id="ssr-notes">[]</script><!--/SSR:NOTESJSON-->');
  await fs.writeFile(path.join(root, 'index.html'), '<!--SSR:LATEST-->x<!--/SSR:LATEST--><!--SSR:HOME--><script type="application/json" id="ssr-home">null</script><!--/SSR:HOME-->');
  const raw = [
    { id: 'n1', title: 'First essay', tags: ['AI'], createdAt: '2026-01-01T00:00:00Z', content: 'One.' },
    { id: 'n2', title: 'Second essay', slug: 'second', previousSlugs: ['old-second'], tags: ['AI'], createdAt: '2026-02-01T00:00:00Z', content: 'Two.' },
  ];
  const r = await build({ root, rawNotes: raw, render: fakeRender });
  assert.deepEqual(r.slugs, ['second', 'first-essay']);
  assert.equal(r.redirects, 1);
  assert.match(await fs.readFile(path.join(root, 'essays', 'old-second.html'), 'utf8'), /url=\/essays\/second/);
  const idx = JSON.parse(await fs.readFile(path.join(root, 'notes-index.json'), 'utf8'));
  assert.equal(idx.notes[0].slug, 'second');
  const home = await fs.readFile(path.join(root, 'index.html'), 'utf8');
  assert.match(home, /class="latest-link" href="\/essays\/second"/);
  assert.match(home, /<script type="application\/json" id="ssr-home">\{"builtAt":"[^"]+","ids":\["n2","n1"\]\}<\/script>/);
  const notesHtml = await fs.readFile(path.join(root, 'notes.html'), 'utf8');
  assert.match(notesHtml, /id="notes-list" aria-busy="false"/);
  assert.match(notesHtml, /id="ssr-notes">\[\{"id":"n2"/);
  assert.match(notesHtml, /class="note-card featured"/);
  await assert.rejects(build({ root, rawNotes: [], render: fakeRender }), /empty site/);
  await fs.rm(root, { recursive: true, force: true });
});
