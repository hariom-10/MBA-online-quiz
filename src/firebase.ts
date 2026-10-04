import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getAuth, type Auth } from "firebase/auth";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBKmjYkkXWUbredEM8P1BDtY2YqUMFc3gc",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "mba-online-quiz.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "mba-online-quiz",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "mba-online-quiz.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "322029708869",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:322029708869:web:ae255b65600c9f75be252c",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-48DB5CJJ29",
};

export const isFirebaseConfigured: boolean = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId
);

export const app: FirebaseApp | null = isFirebaseConfigured
  ? (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig))
  : null;

export const firestore: Firestore | null = app ? getFirestore(app) : null;
export const auth: Auth | null = app ? getAuth(app) : null;

export let analytics: Analytics | null = null;
if (typeof window !== "undefined" && app) {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics is not supported in this environment (e.g. cookies blocked or SSR)
  });
}
