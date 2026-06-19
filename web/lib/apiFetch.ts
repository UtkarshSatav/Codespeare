// Thin wrapper around `fetch` for /api/judge and /api/run.  Attaches
// the user's Firebase ID token (if logged in) so the server can rate-
// limit by user if/when that gets added later.

import { firebaseAuth } from "@/lib/firebase/client";

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const u = firebaseAuth.currentUser;
  if (u) {
    const token = await u.getIdToken();
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
