import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import CalendarHeatmap from "@/components/CalendarHeatmap";
import Layout from "@/components/Layout";
import VerdictBadge from "@/components/VerdictBadge";
import { findProblem, PROBLEMS } from "@/lib/problems";
import {
  fetchProfileByUsername,
  fetchUserStats,
  listBookmarks,
  type SubmissionRecord,
  type UserProfile,
  type UserStats,
} from "@/lib/firestore-client";

interface Data {
  profile: UserProfile;
  stats: UserStats;
  bookmarks: string[];
}

export default function ProfilePage() {
  const router = useRouter();
  const username = router.query.username as string | undefined;
  const [data, setData] = useState<Data | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;
    (async () => {
      try {
        const profile = await fetchProfileByUsername(username);
        if (!profile) { if (!cancelled) setNotFound(true); return; }
        const [stats, bookmarks] = await Promise.all([
          fetchUserStats(profile.user_id, (slug) => findProblem(slug)?.difficulty),
          listBookmarks(profile.user_id),
        ]);
        if (!cancelled) setData({ profile, stats, bookmarks });
      } catch (e) {
        console.error(e);
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => { cancelled = true; };
  }, [username]);

  if (notFound) return <Layout><p className="text-muted">user not found</p></Layout>;
  if (!data) return <Layout><p className="text-muted">loading…</p></Layout>;

  const { profile, stats, bookmarks } = data;
  const totals = {
    problems: PROBLEMS.length,
    easy:   PROBLEMS.filter((p) => p.difficulty === "Easy").length,
    medium: PROBLEMS.filter((p) => p.difficulty === "Medium").length,
    hard:   PROBLEMS.filter((p) => p.difficulty === "Hard").length,
  };

  return (
    <Layout>
      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-panel p-5 text-center">
            <div className="mx-auto mb-3 flex h-20 w-20 items-center justify-center rounded-full bg-accent text-3xl font-bold text-bg">
              {profile.username[0].toUpperCase()}
            </div>
            <div className="text-lg font-semibold">{profile.username}</div>
            <div className="mt-1 text-xs text-muted">
              rating {profile.rating} · joined{" "}
              {new Date(profile.created_at).toLocaleDateString()}
            </div>
            {profile.bio && (
              <div className="mt-3 text-xs text-muted">{profile.bio}</div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-panel p-4 text-xs">
            <div className="mb-2 uppercase tracking-wider text-muted">
              At a glance
            </div>
            <Stat label="Solved"          value={`${stats.solved} / ${totals.problems}`} />
            <Stat label="Attempted"       value={stats.attempted} />
            <Stat label="Acceptance rate" value={`${(stats.acceptance_rate * 100).toFixed(0)}%`} />
            <Stat label="Submissions"     value={stats.total_submissions} />
            <Stat label="Current streak"  value={`🔥 ${stats.current_streak}`} />
            <Stat label="Longest streak"  value={stats.max_streak} />
          </div>

          <div className="rounded-lg border border-border bg-panel p-4 text-xs">
            <div className="mb-2 uppercase tracking-wider text-muted">
              By difficulty
            </div>
            <ProgressRow label="Easy"   done={stats.by_difficulty.Easy}   total={totals.easy}   color="bg-ok"   />
            <ProgressRow label="Medium" done={stats.by_difficulty.Medium} total={totals.medium} color="bg-warn" />
            <ProgressRow label="Hard"   done={stats.by_difficulty.Hard}   total={totals.hard}   color="bg-bad"  />
          </div>
        </aside>

        <div className="space-y-6">
          <div className="rounded-lg border border-border bg-panel p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted">Activity</h2>
            <CalendarHeatmap activity={stats.activity} />
          </div>

          <div className="rounded-lg border border-border bg-panel p-5">
            <h2 className="mb-3 text-sm font-semibold text-muted">
              Recent submissions
            </h2>
            {stats.recent_submissions.length === 0 ? (
              <div className="text-sm text-muted">No submissions yet.</div>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-muted">
                  <tr className="text-left">
                    <th className="py-1">ID</th>
                    <th className="py-1">Problem</th>
                    <th className="py-1">Verdict</th>
                    <th className="py-1">Time</th>
                    <th className="py-1">When</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_submissions.map((s: SubmissionRecord) => (
                    <tr key={s.submission_id} className="border-t border-border">
                      <td className="py-1.5">
                        <Link href={`/submissions/${s.submission_id}`} className="text-accent hover:underline">
                          #{s.submission_id.slice(0, 6)}
                        </Link>
                      </td>
                      <td className="py-1.5">
                        <Link href={`/problems/${s.problem_slug}`} className="hover:underline">
                          {s.problem_slug}
                        </Link>
                      </td>
                      <td className="py-1.5"><VerdictBadge verdict={s.verdict ?? "RUNNING"} /></td>
                      <td className="py-1.5 font-mono">{s.runtime_ms ?? "—"} ms</td>
                      <td className="py-1.5 text-muted">
                        {new Date(s.submitted_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {bookmarks.length > 0 && (
            <div className="rounded-lg border border-border bg-panel p-5">
              <h2 className="mb-3 text-sm font-semibold text-muted">Bookmarks</h2>
              <ul className="flex flex-wrap gap-2 text-sm">
                {bookmarks.map((slug) => (
                  <li key={slug}>
                    <Link href={`/problems/${slug}`} className="rounded border border-border bg-bg px-2 py-1 text-accent hover:border-accent">
                      {slug}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function ProgressRow({
  label, done, total, color,
}: { label: string; done: number; total: number; color: string }) {
  const pct = total === 0 ? 0 : (done / total) * 100;
  return (
    <div className="mb-2">
      <div className="flex justify-between"><span>{label}</span><span>{done}/{total}</span></div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-bg">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
