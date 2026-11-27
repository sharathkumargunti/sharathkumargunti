// Loads Firebase (Firestore) only when something actually needs it, so plain
// reading never downloads the SDK.
import { firebaseConfig, SITE } from "/assets/firebase-config.js";

const BASE = `https://www.gstatic.com/firebasejs/${SITE.firebaseVersion}`;
let pending = null;

/** Resolves to { app, db, ...firestoreFunctions } (collection, doc, getDoc, addDoc, ...). */
export function getFirebase() {
  if (!pending) {
    pending = (async () => {
      const [appMod, fsMod] = await Promise.all([
        import(`${BASE}/firebase-app.js`),
        import(`${BASE}/firebase-firestore.js`),
      ]);
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      return { app, db: fsMod.getFirestore(app), ...fsMod };
    })();
    pending.catch(() => { pending = null; }); // allow a retry after a network failure
  }
  return pending;
}
