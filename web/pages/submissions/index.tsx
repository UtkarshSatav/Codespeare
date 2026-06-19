import Link from "next/link";
import { useEffect, useState } from "react";

import Layout from "@/components/Layout";
import VerdictBadge from "@/components/VerdictBadge";
import {
  watchSubmissions,
  type SubmissionRecord,
} from "@/lib/firestore-client";
import { useAuth } from "@/lib/useAuth";

export default function SubmissionsList() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SubmissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | "mine">(user ? "mine" : "all");

  useEffect(() => { if (user && scope === "all") setScope("mine"); }, [user, scope]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let userId: string | undefined;
    if (scope === "mine") {
      if (!user) { setRows([]); setLoading(false); return; }
      userId = user.user_id;
    }
    unsub = watchSubmissions({ user_id: userId, limit: 100 }, (r) => {
      setRows(r);
      setLoading(false);
    });
    return () => { if (unsub) unsub(); };
  }, [user, scope]);

  return (
    <Layout>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Submissions</h1>
        {user && (
          <div className="flex gap-1 rounded border border-border bg-panel p-1 text-xs">
            <button
              onClick={() => setScope("all")}
              className={`px-3 py-1 rounded ${scope === "all" ? "bg-accent text-bg" : "text-muted"}`}
            >
              all
            </button>
            <button
              onClick={() => setScope("mine")}
              className={`px-3 py-1 rounded ${scope === "mine" ? "bg-accent text-bg" : "text-muted"}`}
            >
              mine
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr className="text-left text-muted">
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Problem</th>
              <th className="px-4 py-2 font-medium">Lang</th>
              <th className="px-4 py-2 font-medium">Verdict</th>
              <th className="px-4 py-2 font-medium">Runtime</th>
              <th className="px-4 py-2 font-medium">Memory</th>
              <th className="px-4 py-2 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="px-4 py-6 text-muted" colSpan={8}>loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td className="px-4 py-6 text-muted" colSpan={8}>no submissions yet</td></tr>
            )}
            {rows.map((s) => (
              <tr key={s.submission_id} className="border-t border-border hover:bg-bg/40">
                <td className="px-4 py-3 text-muted">
                  <Link href={`/submissions/${s.submission_id}`} className="hover:underline">
                    #{s.submission_id.slice(0, 6)}
                  </Link>
                  {s.is_run_only && <span className="ml-1 text-[10px] text-muted">(run)</span>}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/profile/${s.username}`} className="text-accent hover:underline">
                    {s.username}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/problems/${s.problem_slug}`} className="hover:underline">
                    {s.problem_slug}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">{s.language}</td>
                <td className="px-4 py-3">
                  <VerdictBadge verdict={s.verdict ?? (s.status === "RUNNING" ? "RUNNING" : "QUEUED")} />
                </td>
                <td className="px-4 py-3 text-muted">
                  {s.runtime_ms != null ? `${s.runtime_ms} ms` : "—"}
                </td>
                <td className="px-4 py-3 text-muted">
                  {s.memory_kb != null ? `${s.memory_kb} KB` : "—"}
                </td>
                <td className="px-4 py-3 text-xs text-muted">
                  {new Date(s.submitted_at).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}
