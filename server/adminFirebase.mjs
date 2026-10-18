import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

let app;
if (!getApps().length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    } catch (e) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON", e);
    }
  }

  app = initializeApp({
    projectId: process.env.VITE_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "mba-online-quiz",
    ...(credential ? { credential } : {}),
  });
} else {
  app = getApps()[0];
}

export const db = getFirestore(app);

