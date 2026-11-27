// ONE place for the Firebase project settings and a few site-wide switches.
// Imported by index, notes, every generated essay page and the admin panel, and
// read by scripts/build.mjs (so the static build and the browser always agree).
//
// Firebase web keys are not secrets: they only identify the project. What protects
// your data is firestore.rules, plus restricting this key by HTTP referrer in
// Google Cloud Console (APIs & Services > Credentials).

export const firebaseConfig = {
  apiKey: "AIzaSyBQjkNDJcYSzURKXTfC4DWVGTpwlhPADPY",
  authDomain: "sharathkumargunti-e14ea.firebaseapp.com",
  projectId: "sharathkumargunti-e14ea",
  storageBucket: "sharathkumargunti-e14ea.firebasestorage.app",
  messagingSenderId: "1096886966800",
  appId: "1:1096886966800:web:cde6e33a76e3912434c895",
  measurementId: "G-XE5RVTCFLN"
};

export const SITE = {
  // Canonical address used in links, sitemap, RSS and social cards. If you add a
  // custom domain later, change it here and redeploy.
  url: "https://sharathkumargunti.web.app",
  name: "Sharath Kumar Gunti",
  // Shown as a mail icon on the home page when filled in, e.g. "you@example.com".
  contactEmail: "",
  // Firebase Analytics on the public pages (never on the admin panel). Visitors who
  // send Do Not Track or Global Privacy Control are skipped. Set to false to turn off.
  analytics: true,
  // One version for every dynamic Firebase import on the site.
  firebaseVersion: "12.10.0"
};
