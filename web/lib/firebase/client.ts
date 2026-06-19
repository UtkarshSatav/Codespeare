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

function makeApp(): FirebaseApp {
  if (!config.projectId) {
    // We don't throw here — the UI will surface a friendlier error on
    // first auth call.  This lets `next build` succeed before .env.local
    // is filled in.
    console.warn(
      "[firebase] NEXT_PUBLIC_FIREBASE_* env vars not set; auth & Firestore will fail at runtime.",
    );
  }
  return getApps().length ? getApp() : initializeApp(config);
}

export const firebaseApp: FirebaseApp = makeApp();
export const firebaseAuth: Auth = getAuth(firebaseApp);
export const firestore:   Firestore = getFirestore(firebaseApp);
