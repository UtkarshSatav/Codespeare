import { useEffect, useState } from "react";

import { useAuth } from "@/lib/useAuth";
import {
  addComment,
  listComments,
  upvoteComment,
  type Comment,
} from "@/lib/firestore-client";

export default function DiscussionThread({ slug }: { slug: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try { setComments(await listComments(slug)); }
    catch (e) { console.error(e); }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [slug]);

  async function post() {
    if (!user || !draft.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await addComment(slug, user, draft.trim());
      setDraft("");
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upvote(id: string) {
    try { await upvoteComment(id); await refresh(); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="space-y-4">
      {user ? (
        <div className="rounded border border-border bg-bg p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Share an approach, hint, or follow-up question…"
            rows={3}
            className="w-full resize-none rounded bg-panel p-2 text-sm focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between">
            {err && <span className="text-xs text-bad">{err}</span>}
            <span className="text-xs text-muted">{draft.length}/2000</span>
            <button
              onClick={post}
              disabled={busy || !draft.trim()}
              className="rounded bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-40"
            >
              {busy ? "…" : "post"}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded border border-border bg-bg p-3 text-sm text-muted">
          Log in to join the discussion.
        </div>
      )}

      {comments.length === 0 && (
        <div className="text-sm text-muted">No comments yet — be the first.</div>
      )}
      {comments.map((c) => (
        <div key={c.comment_id} className="rounded border border-border bg-bg p-3 text-sm">
          <div className="mb-1 flex items-center justify-between">
            <div className="text-xs">
              <span className="font-semibold text-accent">{c.username}</span>
              <span className="ml-2 text-muted">
                {new Date(c.created_at).toLocaleString()}
              </span>
            </div>
            <button
              onClick={() => upvote(c.comment_id)}
              className="text-xs text-muted hover:text-accent"
              title="upvote"
            >
              ▲ {c.upvotes}
            </button>
          </div>
          <div className="whitespace-pre-wrap">{c.body}</div>
        </div>
      ))}
    </div>
  );
}
