import Link from "next/link";
import { useEffect, useState } from "react";

import DifficultyBadge from "@/components/DifficultyBadge";
import Layout from "@/components/Layout";
import StatusIcon from "@/components/StatusIcon";
import { findProblem, PROBLEM_LISTS } from "@/lib/problems";
import { userStatusByProblem } from "@/lib/firestore-client";
import { useAuth } from "@/lib/useAuth";

export default function ListsPage() {
  const { user } = useAuth();
  const [statusMap, setStatusMap] = useState<Record<string, "AC" | "TRIED">>({});

  useEffect(() => {
    if (!user) { setStatusMap({}); return; }
    let cancelled = false;
    userStatusByProblem(user.user_id)
      .then((m) => { if (!cancelled) setStatusMap(m); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  return (
    <Layout>
      <h1 className="mb-2 text-2xl font-semibold">Study Plans</h1>
      <p className="mb-6 text-sm text-muted">
        Curated problem collections — work through a track end to end.
      </p>

      <div className="space-y-5">
        {PROBLEM_LISTS.map((list) => {
          const problems = list.problem_slugs.map(findProblem).filter(Boolean);
          const solved = problems.filter((p) => p && statusMap[p.slug] === "AC").length;
          const pct = problems.length ? (solved / problems.length) * 100 : 0;
          return (
            <section key={list.slug} id={list.slug} className="scroll-mt-20 rounded-lg border border-border bg-panel">
              <div className="border-b border-border p-5">
                <div className="flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <span className="text-accent">{list.icon}</span> {list.name}
                  </h2>
                  <span className="text-xs text-muted">{solved}/{problems.length} solved</span>
                </div>
                <p className="mt-1 text-sm text-muted">{list.description}</p>
                <div className="mt-3 h-1.5 w-full rounded-full bg-bg">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <ul className="divide-y divide-border">
                {problems.map((p) =>
                  p ? (
                    <li key={p.slug} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-bg/40">
                      <StatusIcon status={statusMap[p.slug] ?? null} />
                      <span className="w-8 text-muted">{p.problem_id}</span>
                      <Link href={`/problems/${p.slug}`} className="text-accent hover:underline">{p.title}</Link>
                      <span className="ml-auto"><DifficultyBadge difficulty={p.difficulty} /></span>
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          );
        })}
      </div>
    </Layout>
  );
}
