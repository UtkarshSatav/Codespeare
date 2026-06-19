import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

import DifficultyBadge from "@/components/DifficultyBadge";
import Layout from "@/components/Layout";
import StatusIcon from "@/components/StatusIcon";
import TagPill from "@/components/TagPill";
import {
  dailyProblem,
  findProblem,
  listCompanies,
  listTags,
  PROBLEM_LISTS,
  PROBLEMS,
  randomProblem,
  type Difficulty,
  type Problem,
} from "@/lib/problems";
import { fetchUserStats, userStatusByProblem } from "@/lib/firestore-client";
import { useAuth } from "@/lib/useAuth";

interface Row {
  slug: string;
  problem_id: number;
  title: string;
  difficulty: Difficulty;
  tags: string[];
  company_tags: string[];
  acceptance_rate: number;
  frequency: number;
  status: "AC" | "TRIED" | null;
}

type StatusFilter = "all" | "todo" | "tried" | "solved";
type SortKey = "id" | "title" | "acceptance" | "difficulty" | "frequency";
const DIFF_RANK: Record<Difficulty, number> = { Easy: 0, Medium: 1, Hard: 2 };

const ROWS: Row[] = PROBLEMS.map((p: Problem) => ({
  slug: p.slug,
  problem_id: p.problem_id,
  title: p.title,
  difficulty: p.difficulty,
  tags: p.tags,
  company_tags: p.company_tags,
  acceptance_rate: p.acceptance_rate,
  frequency: p.frequency,
  status: null,
}));

export default function Home() {
  const { user } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(ROWS);
  const [q, setQ] = useState("");
  const [diff, setDiff] = useState<"all" | Difficulty>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [company, setCompany] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [streak, setStreak] = useState<{ current: number; max: number } | null>(null);

  const daily = useMemo(() => dailyProblem(), []);
  const allTags = useMemo(() => listTags(), []);
  const companies = useMemo(() => listCompanies(), []);

  useEffect(() => {
    if (!user) { setRows(ROWS); setStreak(null); return; }
    let cancelled = false;
    userStatusByProblem(user.user_id).then((statusMap) => {
      if (cancelled) return;
      setRows(ROWS.map((r) => ({ ...r, status: statusMap[r.slug] ?? null })));
    }).catch(() => { /* leave rows blank */ });
    fetchUserStats(user.user_id, (slug) => findProblem(slug)?.difficulty)
      .then((s) => { if (!cancelled) setStreak({ current: s.current_streak, max: s.max_streak }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(1); }
  }

  const filtered = useMemo(() => {
    const out = rows.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q.toLowerCase())) return false;
      if (diff !== "all" && p.difficulty !== diff) return false;
      if (activeTag && !p.tags.includes(activeTag)) return false;
      if (company !== "all" && !p.company_tags.includes(company)) return false;
      if (status === "solved" && p.status !== "AC") return false;
      if (status === "tried" && p.status !== "TRIED") return false;
      if (status === "todo" && p.status !== null) return false;
      return true;
    });
    out.sort((a, b) => {
      let c = 0;
      if (sortKey === "id") c = a.problem_id - b.problem_id;
      else if (sortKey === "title") c = a.title.localeCompare(b.title);
      else if (sortKey === "acceptance") c = a.acceptance_rate - b.acceptance_rate;
      else if (sortKey === "frequency") c = a.frequency - b.frequency;
      else if (sortKey === "difficulty") c = DIFF_RANK[a.difficulty] - DIFF_RANK[b.difficulty];
      return c * sortDir;
    });
    return out;
  }, [rows, q, diff, status, activeTag, company, sortKey, sortDir]);

  const solved = rows.filter((r) => r.status === "AC").length;
  const total = rows.length;
  const easyDone = rows.filter((r) => r.difficulty === "Easy" && r.status === "AC").length;
  const medDone = rows.filter((r) => r.difficulty === "Medium" && r.status === "AC").length;
  const hardDone = rows.filter((r) => r.difficulty === "Hard" && r.status === "AC").length;
  const totEasy = rows.filter((r) => r.difficulty === "Easy").length;
  const totMed = rows.filter((r) => r.difficulty === "Medium").length;
  const totHard = rows.filter((r) => r.difficulty === "Hard").length;

  const sortArrow = (key: SortKey) => sortKey === key ? (sortDir === 1 ? " ▲" : " ▼") : "";

  return (
    <Layout>
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">Problems</h1>
            <button
              onClick={() => router.push(`/problems/${randomProblem().slug}`)}
              className="rounded border border-border bg-panel px-3 py-1.5 text-sm hover:border-accent"
              title="Open a random problem"
            >
              🎲 Pick One
            </button>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search problems…"
              className="flex-1 min-w-[180px] rounded border border-border bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none"
            />
            <select value={diff} onChange={(e) => setDiff(e.target.value as typeof diff)}
              className="rounded border border-border bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none">
              <option value="all">all difficulties</option>
              <option value="Easy">Easy</option>
              <option value="Medium">Medium</option>
              <option value="Hard">Hard</option>
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded border border-border bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none">
              <option value="all">all status</option>
              <option value="todo">to-do</option>
              <option value="tried">attempted</option>
              <option value="solved">solved</option>
            </select>
            <select value={company} onChange={(e) => setCompany(e.target.value)}
              className="rounded border border-border bg-panel px-3 py-2 text-sm focus:border-accent focus:outline-none">
              <option value="all">all companies</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {allTags.map((t) => (
              <TagPill key={t} tag={t} active={activeTag === t}
                onClick={() => setActiveTag(activeTag === t ? null : t)} />
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-panel">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-bg/50">
                <tr className="text-left text-muted">
                  <th className="px-3 py-2 font-medium w-8"></th>
                  <th className="cursor-pointer px-3 py-2 font-medium w-12 hover:text-white" onClick={() => toggleSort("id")}>#{sortArrow("id")}</th>
                  <th className="cursor-pointer px-3 py-2 font-medium hover:text-white" onClick={() => toggleSort("title")}>Title{sortArrow("title")}</th>
                  <th className="px-3 py-2 font-medium">Tags</th>
                  <th className="cursor-pointer px-3 py-2 font-medium hover:text-white" onClick={() => toggleSort("acceptance")}>Acceptance{sortArrow("acceptance")}</th>
                  <th className="cursor-pointer px-3 py-2 font-medium hover:text-white" onClick={() => toggleSort("frequency")}>Freq.{sortArrow("frequency")}</th>
                  <th className="cursor-pointer px-3 py-2 font-medium hover:text-white" onClick={() => toggleSort("difficulty")}>Difficulty{sortArrow("difficulty")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td className="px-3 py-6 text-muted" colSpan={7}>No problems match.</td></tr>
                )}
                {filtered.map((p) => (
                  <tr key={p.slug} className="border-t border-border hover:bg-bg/40">
                    <td className="px-3 py-3"><StatusIcon status={p.status} /></td>
                    <td className="px-3 py-3 text-muted">{p.problem_id}</td>
                    <td className="px-3 py-3">
                      <Link href={`/problems/${p.slug}`} className="text-accent hover:underline">{p.title}</Link>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.tags.slice(0, 3).map((t) => <TagPill key={t} tag={t} />)}
                      </div>
                    </td>
                    <td className="px-3 py-3 text-muted">{(p.acceptance_rate * 100).toFixed(0)}%</td>
                    <td className="px-3 py-3">
                      <div className="h-1.5 w-14 rounded-full bg-bg" title={`${p.frequency}/100`}>
                        <div className="h-full rounded-full bg-accent/70" style={{ width: `${p.frequency}%` }} />
                      </div>
                    </td>
                    <td className="px-3 py-3"><DifficultyBadge difficulty={p.difficulty} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted">Daily challenge</div>
            <Link href={`/problems/${daily.slug}`} className="text-accent hover:underline">{daily.title}</Link>
            <div className="mt-1 text-xs"><DifficultyBadge difficulty={daily.difficulty} /></div>
          </div>

          {streak && (
            <div className="rounded-lg border border-border bg-panel p-4">
              <div className="mb-2 text-xs uppercase tracking-wider text-muted">Streak</div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-2xl font-semibold">🔥 {streak.current}</div>
                  <div className="text-xs text-muted">current</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-semibold">{streak.max}</div>
                  <div className="text-xs text-muted">best</div>
                </div>
              </div>
            </div>
          )}

          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wider text-muted">
              <span>Study plans</span>
              <Link href="/lists" className="lowercase text-accent hover:underline">view all</Link>
            </div>
            <ul className="space-y-2 text-sm">
              {PROBLEM_LISTS.map((l) => (
                <li key={l.slug}>
                  <Link href={`/lists#${l.slug}`} className="flex items-center gap-2 hover:text-accent">
                    <span className="text-accent">{l.icon}</span>
                    <span>{l.name}</span>
                    <span className="ml-auto text-xs text-muted">{l.problem_slugs.length}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted">Progress</div>
            <div className="text-2xl font-semibold">{solved}<span className="text-muted text-base"> / {total}</span></div>
            <div className="mt-3 space-y-2 text-xs">
              <ProgressLine label="Easy" done={easyDone} total={totEasy} color="bg-ok" />
              <ProgressLine label="Medium" done={medDone} total={totMed} color="bg-warn" />
              <ProgressLine label="Hard" done={hardDone} total={totHard} color="bg-bad" />
            </div>
          </div>
        </aside>
      </div>
    </Layout>
  );
}

function ProgressLine({ label, done, total, color }: { label: string; done: number; total: number; color: string }) {
  const pct = total === 0 ? 0 : (done / total) * 100;
  return (
    <div>
      <div className="flex justify-between"><span>{label}</span><span>{done}/{total}</span></div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-bg">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
