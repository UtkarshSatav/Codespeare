// Client-side Firestore data layer.  Pages call these functions directly
// from the browser — there is no longer a Next.js API mediation layer
// for data access.  The only server-side endpoint left is `/api/judge`,
// which is a stateless Python-execution wrapper.
//
// Collections (kept in sync with firestore.rules):
//
//   /users/{uid}
//   /usernames/{name}          — uniqueness index, maps name → uid
//   /submissions/{autoId}
//   /discussions/{autoId}
//   /problemMeta/{slug}        — atomic likes_delta counter
//   /userBookmarks/{uid}/items/{slug}
//   /userLikes/{uid}/items/{slug}

import {
  Timestamp,
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { firestore } from "@/lib/firebase/client";

// ───────── Types — same shape the UI already consumes ───────────────

export type Verdict =
  | "QUEUED" | "RUNNING"
  | "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "SE";

export interface PerTest {
  seq: number;
  verdict: Verdict;
  runtime_ms: number;
  memory_kb: number;
}

export interface SubmissionRecord {
  submission_id: string;
  user_id: string;
  username: string;
  problem_slug: string;
  language: string;
  source: string;
  status: "QUEUED" | "RUNNING" | "JUDGED" | "ERRORED";
  verdict?: Verdict;
  runtime_ms?: number;
  memory_kb?: number;
  failed_test_seq?: number | null;
  compile_stderr?: string;
  per_test?: PerTest[];
  submitted_at: string;
  judged_at?: string;
  is_run_only?: boolean;
}

export interface UserProfile {
  user_id: string;
  username: string;
  email: string;
  rating: number;
  bio?: string;
  created_at: string;
}

export interface Comment {
  comment_id: string;
  problem_slug: string;
  user_id: string;
  username: string;
  body: string;
  created_at: string;
  upvotes: number;
}

// ───────── Helpers ──────────────────────────────────────────────────

function toIso(t: unknown): string {
  if (t instanceof Timestamp) return t.toDate().toISOString();
  if (typeof t === "string") return t;
  return new Date().toISOString();
}

function decodeSubmission(id: string, d: Record<string, unknown>): SubmissionRecord {
  return {
    submission_id: id,
    user_id: d.user_id as string,
    username: d.username as string,
    problem_slug: d.problem_slug as string,
    language: d.language as string,
    source: d.source as string,
    status: d.status as SubmissionRecord["status"],
    verdict: d.verdict as Verdict | undefined,
    runtime_ms: d.runtime_ms as number | undefined,
    memory_kb: d.memory_kb as number | undefined,
    failed_test_seq: d.failed_test_seq as number | null | undefined,
    compile_stderr: d.compile_stderr as string | undefined,
    per_test: d.per_test as PerTest[] | undefined,
    submitted_at: toIso(d.submitted_at),
    judged_at: d.judged_at ? toIso(d.judged_at) : undefined,
    is_run_only: d.is_run_only as boolean | undefined,
  };
}

function decodeProfile(uid: string, d: Record<string, unknown>): UserProfile {
  return {
    user_id: uid,
    username: d.username as string,
    email: d.email as string,
    rating: (d.rating as number) ?? 1200,
    bio: d.bio as string | undefined,
    created_at: toIso(d.created_at),
  };
}

// ───────── Users / usernames ────────────────────────────────────────

export async function createUserProfile(
  uid: string,
  email: string,
  username: string,
): Promise<UserProfile> {
  return await runTransaction(firestore, async (tx) => {
    const nameRef = doc(firestore, "usernames", username.toLowerCase());
    const userRef = doc(firestore, "users", uid);
    const nameSnap = await tx.get(nameRef);
    if (nameSnap.exists()) throw new Error("username already taken");
    tx.set(nameRef, { uid });
    tx.set(userRef, {
      username,
      email,
      rating: 1200,
      created_at: serverTimestamp(),
    });
    return {
      user_id: uid,
      username,
      email,
      rating: 1200,
      created_at: new Date().toISOString(),
    };
  });
}

export async function fetchProfileByUid(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(doc(firestore, "users", uid));
  return snap.exists() ? decodeProfile(uid, snap.data()) : null;
}

export async function fetchProfileByUsername(username: string): Promise<UserProfile | null> {
  const nameSnap = await getDoc(doc(firestore, "usernames", username.toLowerCase()));
  if (!nameSnap.exists()) return null;
  return fetchProfileByUid(nameSnap.data().uid);
}

// ───────── Submissions ──────────────────────────────────────────────

export async function createSubmission(
  user: UserProfile,
  problem_slug: string,
  language: string,
  source: string,
  is_run_only = false,
): Promise<string> {
  const ref = await addDoc(collection(firestore, "submissions"), {
    user_id: user.user_id,
    username: user.username,
    problem_slug,
    language,
    source,
    status: "QUEUED",
    submitted_at: serverTimestamp(),
    is_run_only,
  });
  return ref.id;
}

export async function patchSubmission(
  id: string,
  patch: Partial<Omit<SubmissionRecord, "submission_id" | "submitted_at">>,
): Promise<void> {
  const data: Record<string, unknown> = { ...patch };
  if ("judged_at" in patch) data.judged_at = serverTimestamp();
  // Firestore's UpdateData<T> generic is overly strict when T is unknown;
  // the underlying call accepts any { [k]: FieldValue | primitive }.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await updateDoc(doc(firestore, "submissions", id), data as any);
}

export async function fetchSubmission(id: string): Promise<SubmissionRecord | null> {
  const snap = await getDoc(doc(firestore, "submissions", id));
  return snap.exists() ? decodeSubmission(snap.id, snap.data()) : null;
}

// Live subscription — return an unsubscribe fn.
export function watchSubmission(
  id: string,
  cb: (s: SubmissionRecord | null) => void,
): () => void {
  return onSnapshot(doc(firestore, "submissions", id), (snap) => {
    cb(snap.exists() ? decodeSubmission(snap.id, snap.data()) : null);
  });
}

export async function listSubmissions(opts: {
  user_id?: string;
  problem_slug?: string;
  limit?: number;
} = {}): Promise<SubmissionRecord[]> {
  const constraints = [];
  if (opts.user_id)      constraints.push(where("user_id", "==", opts.user_id));
  if (opts.problem_slug) constraints.push(where("problem_slug", "==", opts.problem_slug));
  constraints.push(orderBy("submitted_at", "desc"));
  constraints.push(limit(opts.limit ?? 50));
  const q = query(collection(firestore, "submissions"), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => decodeSubmission(d.id, d.data()));
}

export function watchSubmissions(
  opts: { user_id?: string; problem_slug?: string; limit?: number },
  cb: (rows: SubmissionRecord[]) => void,
): () => void {
  const constraints = [];
  if (opts.user_id)      constraints.push(where("user_id", "==", opts.user_id));
  if (opts.problem_slug) constraints.push(where("problem_slug", "==", opts.problem_slug));
  constraints.push(orderBy("submitted_at", "desc"));
  constraints.push(limit(opts.limit ?? 50));
  const q = query(collection(firestore, "submissions"), ...constraints);
  return onSnapshot(q, (snap) =>
    cb(snap.docs.map((d) => decodeSubmission(d.id, d.data()))),
  );
}

// ───────── User stats / per-problem status ──────────────────────────

export async function userStatusByProblem(
  user_id: string,
): Promise<Record<string, "AC" | "TRIED">> {
  const q = query(
    collection(firestore, "submissions"),
    where("user_id", "==", user_id),
  );
  const snap = await getDocs(q);
  const result: Record<string, "AC" | "TRIED"> = {};
  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    if (d.is_run_only) continue;
    if (d.status !== "JUDGED") continue;
    if (d.verdict === "AC") result[d.problem_slug as string] = "AC";
    else if (!result[d.problem_slug as string]) result[d.problem_slug as string] = "TRIED";
  }
  return result;
}

export interface UserStats {
  solved: number;
  attempted: number;
  total_submissions: number;
  acceptance_rate: number;
  by_difficulty: Record<"Easy" | "Medium" | "Hard", number>;
  recent_submissions: SubmissionRecord[];
  activity: Record<string, number>;
  current_streak: number;
  max_streak: number;
}

// Compute current + longest daily streaks from a {YYYY-MM-DD: count} map.
// "current" counts consecutive days with activity ending today or
// yesterday (so a streak isn't broken until a full day is missed).
export function computeStreaks(
  activity: Record<string, number>,
): { current: number; max: number } {
  const days = Object.keys(activity).filter((d) => (activity[d] ?? 0) > 0).sort();
  if (days.length === 0) return { current: 0, max: 0 };

  const DAY = 86_400_000;
  const toUtc = (d: string) => Date.parse(d + "T00:00:00Z");

  // Longest run of consecutive calendar days anywhere in the history.
  let max = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (toUtc(days[i]) - toUtc(days[i - 1]) === DAY) run++;
    else run = 1;
    if (run > max) max = run;
  }

  // Current streak: walk backwards from the most recent active day, but
  // only if that day is today or yesterday.
  const todayUtc = Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const lastUtc = toUtc(days[days.length - 1]);
  let current = 0;
  if (todayUtc - lastUtc <= DAY) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (toUtc(days[i]) - toUtc(days[i - 1]) === DAY) current++;
      else break;
    }
  }
  return { current, max };
}

export async function fetchUserStats(
  user_id: string,
  difficultyOf: (slug: string) => "Easy" | "Medium" | "Hard" | undefined,
): Promise<UserStats> {
  const q = query(
    collection(firestore, "submissions"),
    where("user_id", "==", user_id),
  );
  const snap = await getDocs(q);
  const solvedSet = new Set<string>();
  const triedSet  = new Set<string>();
  const byDiff: UserStats["by_difficulty"] = { Easy: 0, Medium: 0, Hard: 0 };
  let acCount = 0;
  let total = 0;
  const activity: Record<string, number> = {};
  const rows: SubmissionRecord[] = [];
  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    if (d.is_run_only) continue;
    total++;
    if (d.verdict === "AC") { acCount++; solvedSet.add(d.problem_slug); }
    else                    {            triedSet.add(d.problem_slug);  }
    const day = toIso(d.submitted_at).slice(0, 10);
    activity[day] = (activity[day] ?? 0) + 1;
    rows.push(decodeSubmission(docSnap.id, d));
  }
  for (const slug of solvedSet) {
    const diff = difficultyOf(slug);
    if (diff) byDiff[diff]++;
  }
  rows.sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  const streaks = computeStreaks(activity);
  return {
    solved: solvedSet.size,
    attempted: triedSet.size,
    total_submissions: total,
    acceptance_rate: total === 0 ? 0 : acCount / total,
    by_difficulty: byDiff,
    recent_submissions: rows.slice(0, 10),
    activity,
    current_streak: streaks.current,
    max_streak: streaks.max,
  };
}

// ───────── Discussions ──────────────────────────────────────────────

export async function listComments(problem_slug: string): Promise<Comment[]> {
  const q = query(
    collection(firestore, "discussions"),
    where("problem_slug", "==", problem_slug),
    orderBy("created_at", "desc"),
    limit(100),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      comment_id: d.id,
      problem_slug: x.problem_slug,
      user_id: x.user_id,
      username: x.username,
      body: x.body,
      created_at: toIso(x.created_at),
      upvotes: x.upvotes ?? 0,
    };
  });
}

export async function addComment(
  problem_slug: string,
  user: UserProfile,
  body: string,
): Promise<void> {
  await addDoc(collection(firestore, "discussions"), {
    problem_slug,
    user_id: user.user_id,
    username: user.username,
    body,
    upvotes: 0,
    created_at: serverTimestamp(),
  });
}

export async function upvoteComment(id: string): Promise<void> {
  await updateDoc(doc(firestore, "discussions", id), {
    upvotes: increment(1),
  });
}

// ───────── Likes ────────────────────────────────────────────────────

export async function toggleLike(
  user_id: string,
  slug: string,
): Promise<boolean> {
  const itemRef = doc(firestore, "userLikes", user_id, "items", slug);
  const metaRef = doc(firestore, "problemMeta", slug);
  return await runTransaction(firestore, async (tx) => {
    const ex = await tx.get(itemRef);
    if (ex.exists()) {
      tx.delete(itemRef);
      tx.set(metaRef, { likes_delta: increment(-1) }, { merge: true });
      return false;
    }
    tx.set(itemRef, { liked_at: serverTimestamp() });
    tx.set(metaRef, { likes_delta: increment(1) },  { merge: true });
    return true;
  });
}

export async function isLiked(user_id: string, slug: string): Promise<boolean> {
  const snap = await getDoc(doc(firestore, "userLikes", user_id, "items", slug));
  return snap.exists();
}

export async function problemLikeDelta(slug: string): Promise<number> {
  const snap = await getDoc(doc(firestore, "problemMeta", slug));
  return snap.exists() ? ((snap.data()?.likes_delta as number) ?? 0) : 0;
}

// ───────── Bookmarks ────────────────────────────────────────────────

export async function toggleBookmark(
  user_id: string,
  slug: string,
): Promise<boolean> {
  const ref = doc(firestore, "userBookmarks", user_id, "items", slug);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, { bookmarked_at: serverTimestamp() });
  return true;
}

export async function isBookmarked(user_id: string, slug: string): Promise<boolean> {
  const snap = await getDoc(doc(firestore, "userBookmarks", user_id, "items", slug));
  return snap.exists();
}

export async function listBookmarks(user_id: string): Promise<string[]> {
  const snap = await getDocs(
    collection(firestore, "userBookmarks", user_id, "items"),
  );
  return snap.docs.map((d) => d.id);
}

// ───────── Notes (private, per user + problem) ──────────────────────

export async function getNote(user_id: string, slug: string): Promise<string> {
  const snap = await getDoc(doc(firestore, "userNotes", user_id, "items", slug));
  return snap.exists() ? ((snap.data()?.body as string) ?? "") : "";
}

export async function saveNote(
  user_id: string,
  slug: string,
  body: string,
): Promise<void> {
  const ref = doc(firestore, "userNotes", user_id, "items", slug);
  if (body.trim() === "") {
    await deleteDoc(ref).catch(() => { /* nothing to delete */ });
    return;
  }
  await setDoc(ref, { body, updated_at: serverTimestamp() });
}

// ───────── Leaderboard ──────────────────────────────────────────────

export interface LeaderboardEntry {
  user_id: string;
  username: string;
  rating: number;
  solved: number;
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const [usersSnap, subsSnap] = await Promise.all([
    getDocs(collection(firestore, "users")),
    getDocs(query(
      collection(firestore, "submissions"),
      where("verdict", "==", "AC"),
    )),
  ]);
  const solvedByUser = new Map<string, Set<string>>();
  for (const d of subsSnap.docs) {
    const x = d.data();
    if (x.is_run_only) continue;
    const s = solvedByUser.get(x.user_id) ?? new Set<string>();
    s.add(x.problem_slug);
    solvedByUser.set(x.user_id, s);
  }
  const rows = usersSnap.docs.map((d) => {
    const x = d.data();
    return {
      user_id: d.id,
      username: x.username as string,
      rating: (x.rating as number) ?? 1200,
      solved: solvedByUser.get(d.id)?.size ?? 0,
    };
  });
  rows.sort((a, b) =>
    b.rating - a.rating || b.solved - a.solved || a.username.localeCompare(b.username),
  );
  return rows;
}

// Re-exported so existing imports that touch collectionGroup don't break.
export { collectionGroup };
