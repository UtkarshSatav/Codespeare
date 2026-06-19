// Per-(problem, language) editor persistence in localStorage.
//
// Why: now that the editor starts from a *stub* (not the solution), a
// user's in-progress code must survive page reloads and language toggles
// — exactly like LeetCode keeps your draft per problem.  This is a pure
// client-side draft cache; the authoritative record is still the
// Firestore submission written on run/submit.

const PREFIX = "cs_code:";

function key(slug: string, lang: string): string {
  return `${PREFIX}${slug}:${lang}`;
}

/** Load a saved draft, or null if none exists. */
export function loadCode(slug: string, lang: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key(slug, lang));
  } catch {
    return null;
  }
}

/** Persist the current draft (debounce at the call site if needed). */
export function saveCode(slug: string, lang: string, code: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(slug, lang), code);
  } catch {
    /* quota or privacy mode — drafts are best-effort */
  }
}

/** Drop a saved draft (used by "Reset to starter"). */
export function clearCode(slug: string, lang: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(slug, lang));
  } catch {
    /* ignore */
  }
}
