// Private per-problem notes — LeetCode-style.  Persisted to Firestore
// under /userNotes/{uid}/items/{slug}; visible only to the owner.

import { useEffect, useRef, useState } from "react";

import { getNote, saveNote } from "@/lib/firestore-client";
import { useAuth } from "@/lib/useAuth";

export default function NotesPanel({ slug }: { slug: string }) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user) { setLoaded(true); return; }
    let cancelled = false;
    getNote(user.user_id, slug)
      .then((b) => { if (!cancelled) { setBody(b); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [user, slug]);

  // Debounced autosave.
  useEffect(() => {
    if (!user || !loaded) return;
    if (timer.current) clearTimeout(timer.current);
    setState("saving");
    timer.current = setTimeout(async () => {
      try { await saveNote(user.user_id, slug, body); setState("saved"); }
      catch { setState("error"); }
    }, 700);
    return () => { if (timer.current) clearTimeout(timer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  if (!user) {
    return <div className="text-sm text-muted">Log in to keep private notes on this problem.</div>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Private notes — only you can see these.</span>
        <span>
          {state === "saving" ? "saving…" : state === "saved" ? "saved ✓" : state === "error" ? <span className="text-bad">save failed</span> : ""}
        </span>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={12}
        placeholder={"Jot down your approach, edge cases, complexity, things to revisit…\n\nMarkdown-ish text is fine."}
        className="w-full resize-y rounded border border-border bg-bg p-3 font-mono text-xs leading-6 focus:border-accent focus:outline-none"
      />
    </div>
  );
}
