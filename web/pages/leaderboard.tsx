import Link from "next/link";
import { useEffect, useState } from "react";

import Layout from "@/components/Layout";
import {
  fetchLeaderboard,
  type LeaderboardEntry,
} from "@/lib/firestore-client";

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLeaderboard().then((r) => { setRows(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <Layout>
      <h1 className="mb-6 text-2xl font-semibold">Leaderboard</h1>
      <div className="overflow-hidden rounded-lg border border-border bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50 text-left text-muted">
            <tr>
              <th className="px-4 py-2 font-medium w-12">#</th>
              <th className="px-4 py-2 font-medium">User</th>
              <th className="px-4 py-2 font-medium">Rating</th>
              <th className="px-4 py-2 font-medium">Solved</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td className="px-4 py-6 text-muted" colSpan={4}>loading…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td className="px-4 py-6 text-muted" colSpan={4}>no users yet</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.user_id} className="border-t border-border hover:bg-bg/40">
                <td className="px-4 py-3 text-muted">
                  {i < 3 ? <span className="text-accent">★ {i + 1}</span> : i + 1}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/profile/${r.username}`} className="text-accent hover:underline">
                    {r.username}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono">{r.rating}</td>
                <td className="px-4 py-3 font-mono">{r.solved}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-xs text-muted">
        Rating starts at 1200 for new accounts. Solved counts come from
        <code className="text-accent">verdict = &quot;AC&quot;</code> submissions in Firestore.
      </p>
    </Layout>
  );
}
