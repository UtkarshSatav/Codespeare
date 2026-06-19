// Client-side Firebase initialisation.  Safe to import from any page or
// component — the underlying app is memoised so re-imports don't create
// a second instance (Firebase throws if you do that twice).

import { getApps, getApp, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const config = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Whether the deployment has real Firebase credentials wired in.
export const firebaseConfigured = Boolean(config.apiKey && config.projectId);

function makeApp(): FirebaseApp {
  if (getApps().length) return getApp();
  if (!firebaseConfigured) {
    // Don't crash the build/prerender when env is missing (e.g. a fresh
    // Vercel deploy before env vars are added).  Auth/Firestore calls will
    // still fail at runtime until the NEXT_PUBLIC_FIREBASE_* vars are set in
    // the host's Environment Variables.
    console.warn(
      "[firebase] NEXT_PUBLIC_FIREBASE_* env vars not set; auth & Firestore " +
      "will fail at runtime. Add them in your host (e.g. Vercel → Project " +
      "Settings → Environment Variables) and redeploy.",
    );
  }
  // A non-empty placeholder apiKey keeps getAuth() from throwing
  // `auth/invalid-api-key` during the build when env is absent.
  return initializeApp({ ...config, apiKey: config.apiKey || "missing-api-key" });
}

export const firebaseApp: FirebaseApp = makeApp();
export const firebaseAuth: Auth = getAuth(firebaseApp);
export const firestore:   Firestore = getFirestore(firebaseApp);
