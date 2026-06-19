// Client-side auth state, backed by Firebase Auth + a Firestore
// profile doc.  No API mediation: signup → createUserWithEmailAndPassword
// → write /users/{uid} + /usernames/{name} via a transaction.

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User as FbUser,
} from "firebase/auth";
import { createContext, ReactNode, useContext, useEffect, useState } from "react";

import { firebaseAuth } from "@/lib/firebase/client";
import {
  createUserProfile,
  fetchProfileByUid,
  type UserProfile,
} from "@/lib/firestore-client";

export type AuthUser = UserProfile;

interface AuthCtx {
  user: AuthUser | null;
  fbUser: FbUser | null;
  loading: boolean;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null, fbUser: null, loading: true,
  logout: async () => {}, refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [fbUser, setFbUser] = useState<FbUser | null>(null);
  const [user, setUser]     = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(firebaseAuth, async (u) => {
      setFbUser(u);
      if (!u) { setUser(null); setLoading(false); return; }
      try {
        const p = await fetchProfileByUid(u.uid);
        setUser(p);
      } catch (e) {
        console.error("[auth] failed to load profile", e);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });
  }, []);

  async function logout() {
    await signOut(firebaseAuth);
    setUser(null);
  }

  async function refreshProfile() {
    if (!fbUser) return;
    const p = await fetchProfileByUid(fbUser.uid);
    setUser(p);
  }

  return (
    <Ctx.Provider value={{ user, fbUser, loading, logout, refreshProfile }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx { return useContext(Ctx); }

// ───── Convenience signup / login ────────────────────────────────────

export async function emailSignUp(
  email: string,
  password: string,
  username: string,
): Promise<void> {
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    throw new Error("username must be 3-30 chars, alphanumeric or _");
  }
  const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
  try {
    await createUserProfile(cred.user.uid, email, username);
  } catch (e) {
    // Roll back the orphaned auth user so the next attempt can succeed.
    try { await cred.user.delete(); } catch { /* ignore */ }
    throw e;
  }
}

export async function emailLogIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(firebaseAuth, email, password);
}
