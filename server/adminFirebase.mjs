import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let app = null;
let db = null;
let hasAdminCredentials = false;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    const credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    app = initializeApp({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "mba-online-quiz",
      credential,
    });
    hasAdminCredentials = true;
  } catch (e) {
    console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON", e);
  }
} else {
  try {
    const existing = getApps();
    app = existing.length > 0 ? existing[0] : initializeApp({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "mba-online-quiz",
    });
  } catch (e) {
    console.warn("[adminFirebase] Default app note:", e.message);
  }
}

try {
  if (app) {
    db = getFirestore(app);
  }
} catch (e) {
  console.warn("[adminFirebase] getFirestore note:", e.message);
}

export { app, db, hasAdminCredentials };
