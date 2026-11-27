# sharathkumargunti.web.app

Personal site: home page, notes list, one page per essay, and an admin panel.

## How it fits together

- **Essays, drafts and messages live in Firestore** (`notes`, `drafts`, `messages`). You write in `adminwithpassword.html`.
- **Every deploy first runs `scripts/build.mjs`.** It reads the published essays and writes real pages into `essays/<slug>.html`, plus `notes-index.json`, `search-index.json`, `sitemap.xml` and `rss.xml`, and fills in the essay list on `notes.html` and the latest essay on `index.html`. This is what makes WhatsApp, X, Telegram and Google see each essay's own title, summary and link.
- **A deploy starts when** you push to `main`, every 6 hours, you press **Deploy site** in the admin panel, or you press *Run workflow* on the GitHub Actions tab.
- If the build fails, the workflow turns red and **the live site keeps its previous version**.
- Settings that used to be copied into three files now live in one: `assets/firebase-config.js`.

## Go-live checklist (do these in order)

1. **Delete two old files** from the repository: `firebase-config.js` (the one in the root; it was not used by any page) and `sitemap.xml` (it is generated now).
2. **Firestore rules.**
   1. Firebase console > Authentication > Users: copy the *User UID* of every admin account.
   2. Firestore Database > Start collection `admins`; add one document per admin. The document ID is the UID; give it any field, for example `role` = `admin`.
   3. Rules tab: paste the contents of `firestore.rules` and press Publish. (Do step 2 first, or you lock yourself out of publishing.)
3. **Push to `main`** and open the Actions tab. The first run installs the build tools and takes about a minute. Open `/notes`, then one essay under `/essays/...`.
4. **Recommended:** Google Cloud console > APIs & Services > Credentials > the browser key > *Websites* restriction. Allow `https://sharathkumargunti.web.app/*`, `https://sharathkumargunti.firebaseapp.com/*` and `http://localhost:*`. The build sends your site address as its referrer, so it is not blocked.
5. **Optional, for the Deploy button:** GitHub > Settings > Developer settings > Fine-grained tokens. Repository access: only this repo. Permission: *Actions: Read and write*. Then in the admin panel, Notes tab, press the gear next to **Deploy site** and enter `owner/repo` and the token. They are stored in that browser only. After that, publishing, updating, unpublishing and deleting start a deploy by themselves.

## Day to day

- Publish in the admin panel. Wait about 2 minutes for the deploy, then share the link (`Copy Link` in the essay menu). Before the deploy finishes the link still opens the essay, but link previews are generic until the page is built, and WhatsApp remembers what it saw first.
- Unpublishing or deleting an essay takes effect at the next deploy.
- Each essay has a **Link** and a **Summary** field in the editor. Changing the link of a published essay keeps the old address working.
- Unpublishing and publishing again keeps the same address and original date.
- Visitors who send Do Not Track or Global Privacy Control are not counted by analytics. To switch analytics off completely, set `analytics: false` in `assets/firebase-config.js`.

## Files

| Path | What it is |
| --- | --- |
| `assets/firebase-config.js` | Firebase settings and site-wide switches (single source of truth) |
| `assets/util.js` | Slugs, excerpts and page markup shared by the browser, admin and build |
| `assets/site.css`, `assets/base.css` | Styles for notes pages and shared accessibility rules |
| `assets/notes.js`, `home.js`, `essay.js`, `article.js`, `site.js`, `firebase.js` | Page scripts. Firebase loads only when needed |
| `scripts/build.mjs`, `scripts/build.test.mjs` | The pre-render build and its tests (`npm test`) |
| `firestore.rules` | Rules to paste into the Firebase console (not deployed automatically) |
| `.github/` | Deploy workflows and the build step |

## Notes

- `npm install && npm test` checks the build code. `npm run build` rewrites `index.html` and `notes.html`; run `git checkout index.html notes.html` afterwards if you ran it locally.
- If the build says **403**: the rules do not allow public reads of `notes`, or the API key's website restriction does not list the site address.
- `https://sharathkumargunti.web.app` is also written by hand in the `<head>` of `index.html`, `notes.html` and in `robots.txt`. If you ever add a custom domain, change it there and in `assets/firebase-config.js`.
