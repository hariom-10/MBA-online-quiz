import admin from "firebase-admin";

// Initialize Firebase Admin SDK
// This requires a service account key file, usually provided via environment variable
// GOOGLE_APPLICATION_CREDENTIALS pointing to the path of the JSON file.
// For production, if running on Vercel, use service account config instead.

if (!admin.apps.length) {
  let credential;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      credential = admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
    } catch (e) {
      console.error("Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON", e);
    }
  }

  admin.initializeApp({
    credential: credential || admin.credential.applicationDefault(),
  });
}

export const db = admin.firestore();
