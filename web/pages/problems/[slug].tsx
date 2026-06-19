import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";

import DifficultyBadge from "@/components/DifficultyBadge";
import DiscussionThread from "@/components/DiscussionThread";
import Layout from "@/components/Layout";
import MarkdownLite from "@/components/MarkdownLite";
import NotesPanel from "@/components/NotesPanel";
import SolutionPanel from "@/components/SolutionPanel";
import Tabs from "@/components/Tabs";
import TagPill from "@/components/TagPill";
import TestResultPanel, { type CaseResult } from "@/components/TestResultPanel";
import VerdictBadge from "@/components/VerdictBadge";
import {
  findProblem,
  GENERIC_STUB,
  LANGUAGES,
  relatedProblems,
  RUNNABLE_LANGUAGES,
  type LanguageCode,
  type Problem,
} from "@/lib/problems";
import {
  createSubmission,
  isBookmarked,
  isLiked,
  listSubmissions,
  patchSubmission,
  problemLikeDelta,
  toggleBookmark,
  toggleLike,
  watchSubmission,
  type SubmissionRecord,
} from "@/lib/firestore-client";
import { apiFetch } from "@/lib/apiFetch";
import { clearCode, loadCode, saveCode } from "@/lib/codeStore";
import { useAuth } from "@/lib/useAuth";

const Editor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

type Tab = "description" | "editorial" | "solution" | "submissions" | "notes" | "discussion";

// Mirror the judge's "trimmed" checker for the in-browser sample run.
function norm(t: string): string {
  const lines = (t ?? "").replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.map((l) => l.replace(/\s+$/, "")).join("\n");
}

function monacoLang(lang: LanguageCode): string {
  return lang === "python3" ? "python"
    : lang === "cpp17" ? "cpp"
    : lang === "java17" ? "java"
    : lang === "node18" ? "javascript" : "go";
}

export default function ProblemPage() {
  const router = useRouter();
  const slug = router.query.slug as string | undefined;
  const { user } = useAuth();

  const problem: Problem | undefined = slug ? findProblem(slug) : undefined;

  const [tab, setTab] = useState<Tab>("description");
  const [lang, setLang] = useState<LanguageCode>("python3");
  const [code, setCode] = useState<string>("");
  const [hintsShown, setHintsShown] = useState(0);
  const [customInput, setCustomInput] = useState("");
  const [busy, setBusy] = useState<null | "run" | "submit" | "custom">(null);
  const [submission, setSubmission] = useState<SubmissionRecord | null>(null);
  const [sampleResults, setSampleResults] = useState<CaseResult[] | null>(null);
  const [customResult, setCustomResult] = useState<{ stdout: string; stderr: string; runtime_ms: number; verdict: string } | null>(null);
  const [mySubs, setMySubs] = useState<SubmissionRecord[]>([]);
  const [liked, setLikedState] = useState(false);
  const [likes, setLikes] = useState(0);
  const [bookmarked, setBookmarkedState] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const subUnsubRef = useRef<(() => void) | null>(null);

  const [theme, setTheme] = useState<"vs-dark" | "light">("vs-dark");
  const [fontSize, setFontSize] = useState(13);

  // Load the per-(problem, language) draft, falling back to the STUB
  // starter (never the answer) and then a generic scaffold.
  useEffect(() => {
    if (!problem) return;
    const saved = loadCode(problem.slug, lang);
    setCode(saved ?? problem.starter[lang] ?? GENERIC_STUB[lang]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [problem?.slug, lang]);

  useEffect(() => {
    if (!problem) return;
    problemLikeDelta(problem.slug).then((d) =>
      setLikes(problem.likes + d),
    ).catch(() => setLikes(problem.likes));
    if (!user) { setLikedState(false); setBookmarkedState(false); return; }
    isLiked(user.user_id, problem.slug).then(setLikedState).catch(() => {});
    isBookmarked(user.user_id, problem.slug).then(setBookmarkedState).catch(() => {});
  }, [problem, user]);

  useEffect(() => {
    const t = localStorage.getItem("cs_theme");
    const f = localStorage.getItem("cs_fontsize");
    if (t === "vs-dark" || t === "light") setTheme(t);
    if (f) setFontSize(Number(f));
  }, []);
  useEffect(() => { localStorage.setItem("cs_theme", theme); }, [theme]);
  useEffect(() => { localStorage.setItem("cs_fontsize", String(fontSize)); }, [fontSize]);

  const loadMySubs = useCallback(async () => {
    if (!problem || !user) { setMySubs([]); return; }
    try {
      const rows = await listSubmissions({ user_id: user.user_id, problem_slug: problem.slug, limit: 50 });
      setMySubs(rows);
    } catch (e) { console.error(e); }
  }, [problem, user]);
  useEffect(() => { if (tab === "submissions") loadMySubs(); }, [tab, loadMySubs]);

  useEffect(() => () => {
    if (subUnsubRef.current) subUnsubRef.current();
  }, []);

  // ── Run against SAMPLE tests only (LeetCode "Run") — no Firestore. ──
  const runSamples = useCallback(async () => {
    if (!problem) return;
    if (!RUNNABLE_LANGUAGES.has(lang)) { alert("Only Python 3 runs in this demo."); return; }
    setBusy("run");
    setSubmission(null);
    setCustomResult(null);
    const samples = problem.test_cases.filter((tc) => tc.is_sample);
    setSampleResults(samples.map((tc) => ({ seq: tc.seq, label: tc.label, input: tc.input, expected: tc.expected })));
    const results: CaseResult[] = [];
    for (const tc of samples) {
      try {
        const r = await apiFetch("/api/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: lang, source: code, stdin: tc.input, timeout_ms: problem.time_limit_ms }),
        });
        const j = await r.json();
        const actual = (j.stdout ?? "") as string;
        const passed = j.verdict === "AC" && norm(actual) === norm(tc.expected);
        results.push({ seq: tc.seq, label: tc.label, input: tc.input, expected: tc.expected, actual, stderr: j.stderr, passed, runtime_ms: j.runtime_ms });
      } catch (e) {
        results.push({ seq: tc.seq, label: tc.label, input: tc.input, expected: tc.expected, actual: "", passed: false, stderr: (e as Error).message });
      }
    }
    setSampleResults(results);
    setBusy(null);
  }, [problem, lang, code]);

  // ── Submit against ALL tests — graded, written to Firestore. ──
  const submitGraded = useCallback(async () => {
    if (!user) { alert("log in first"); return; }
    if (!problem) return;
    setBusy("submit");
    setSampleResults(null);
    setSubmission(null);
    setCustomResult(null);

    let id: string;
    try {
      id = await createSubmission(user, problem.slug, lang, code, false);
    } catch (e) {
      alert(`couldn't create submission: ${(e as Error).message}`);
      setBusy(null);
      return;
    }

    if (subUnsubRef.current) subUnsubRef.current();
    subUnsubRef.current = watchSubmission(id, (rec) => {
      setSubmission(rec);
      if (rec && (rec.status === "JUDGED" || rec.status === "ERRORED")) {
        if (subUnsubRef.current) { subUnsubRef.current(); subUnsubRef.current = null; }
        setBusy(null);
        if (tab === "submissions") loadMySubs();
      }
    });

    try { await patchSubmission(id, { status: "RUNNING" }); } catch { /* not fatal */ }

    try {
      const res = await apiFetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem_slug: problem.slug, language: lang, source: code, mode: "submit" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        await patchSubmission(id, {
          status: "ERRORED", verdict: "SE",
          compile_stderr: j.error ?? `judge HTTP ${res.status}`,
          judged_at: new Date().toISOString(),
        });
        return;
      }
      const out = await res.json();
      await patchSubmission(id, {
        status: "JUDGED", verdict: out.verdict, runtime_ms: out.runtime_ms,
        memory_kb: out.memory_kb, failed_test_seq: out.failed_test_seq,
        compile_stderr: out.compile_stderr, per_test: out.per_test,
        judged_at: new Date().toISOString(),
      });
    } catch (e) {
      await patchSubmission(id, {
        status: "ERRORED", verdict: "SE",
        compile_stderr: `judge failed: ${(e as Error).message}`,
        judged_at: new Date().toISOString(),
      });
    }
  }, [user, problem, lang, code, tab, loadMySubs]);

  // Keyboard shortcuts: Cmd/Ctrl+Enter = run, +Shift = submit.  Refs keep
  // the listener pointing at the latest handlers without re-binding.
  const runRef = useRef(runSamples);
  const submitRef = useRef(submitGraded);
  runRef.current = runSamples;
  submitRef.current = submitGraded;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) submitRef.current(); else runRef.current();
      }
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runCustom() {
    if (!problem) return;
    if (!RUNNABLE_LANGUAGES.has(lang)) { alert("Only Python 3 runs in this demo."); return; }
    setBusy("custom");
    setSubmission(null);
    setSampleResults(null);
    setCustomResult(null);
    const r = await apiFetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ language: lang, source: code, stdin: customInput, timeout_ms: problem.time_limit_ms }),
    });
    setBusy(null);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`failed: ${j.error ?? r.status}`);
      return;
    }
    setCustomResult(await r.json());
  }

  function onCodeChange(v: string | undefined) {
    const next = v ?? "";
    setCode(next);
    if (problem) saveCode(problem.slug, lang, next);
  }

  function resetCode() {
    if (!problem) return;
    if (!confirm("Reset your code to the starter stub? Your current draft for this language will be discarded.")) return;
    clearCode(problem.slug, lang);
    setCode(problem.starter[lang] ?? GENERIC_STUB[lang]);
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1200); }
    catch { /* clipboard blocked */ }
  }

  async function onToggleLike() {
    if (!user || !problem) return;
    try {
      const now = await toggleLike(user.user_id, problem.slug);
      setLikedState(now);
      setLikes((n) => n + (now ? 1 : -1));
    } catch (e) { alert(`couldn't update like: ${(e as Error).message}`); }
  }
  async function onToggleBookmark() {
    if (!user || !problem) return;
    try {
      const now = await toggleBookmark(user.user_id, problem.slug);
      setBookmarkedState(now);
    } catch (e) { alert(`couldn't update bookmark: ${(e as Error).message}`); }
  }

  if (!problem) return <Layout><p className="text-muted">loading…</p></Layout>;

  const runnable = RUNNABLE_LANGUAGES.has(lang);
  const samples = problem.test_cases.filter((tc) => tc.is_sample);
  const related = relatedProblems(problem.slug);

  const editorCard = (
    <div className={
      fullscreen
        ? "fixed inset-0 z-50 flex flex-col bg-panel"
        : "overflow-hidden rounded-lg border border-border bg-panel"
    }>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
        <select
          value={lang}
          onChange={(e) => setLang(e.target.value as LanguageCode)}
          className="rounded bg-bg px-2 py-1 text-xs"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}{!RUNNABLE_LANGUAGES.has(l.code) && " (UI only)"}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2 text-muted">
          <button onClick={resetCode} title="Reset to starter" className="hover:text-white">reset</button>
          <button onClick={copyCode} title="Copy code" className="hover:text-white">{copied ? "copied" : "copy"}</button>
          <button onClick={() => setFullscreen((f) => !f)} title="Toggle fullscreen" className="hover:text-white">
            {fullscreen ? "exit ⤢" : "⤢"}
          </button>
          <span className="mx-1">|</span>
          <button onClick={() => setFontSize((f) => Math.max(10, f - 1))} className="hover:text-white">A-</button>
          <span>{fontSize}px</span>
          <button onClick={() => setFontSize((f) => Math.min(20, f + 1))} className="hover:text-white">A+</button>
          <button onClick={() => setTheme((t) => t === "vs-dark" ? "light" : "vs-dark")} className="ml-1 hover:text-white">
            {theme === "vs-dark" ? "☀" : "☾"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={runSamples}
            disabled={!!busy || !runnable}
            title={runnable ? "Run on sample tests (⌘/Ctrl+↵)" : "language not wired in demo"}
            className="rounded border border-border px-3 py-1 hover:border-accent disabled:opacity-40"
          >
            {busy === "run" ? "…" : "run"}
          </button>
          <button
            onClick={submitGraded}
            disabled={!!busy}
            title="Submit against all tests (⌘/Ctrl+Shift+↵)"
            className="rounded bg-accent px-3 py-1 font-semibold text-bg hover:opacity-90 disabled:opacity-40"
          >
            {busy === "submit" ? "…" : "submit"}
          </button>
        </div>
      </div>
      <Editor
        height={fullscreen ? "100%" : "380px"}
        defaultLanguage="python"
        language={monacoLang(lang)}
        theme={theme}
        value={code}
        onChange={onCodeChange}
        options={{
          fontSize,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      />
    </div>
  );

  return (
    <Layout>
      <Link href="/" className="text-sm text-muted hover:text-white">← problems</Link>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border p-5">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-semibold">
                {problem.problem_id}. {problem.title}
              </h1>
              <div className="flex items-center gap-3 text-xs">
                <button onClick={onToggleLike} title="like"
                  className={"hover:text-accent " + (liked ? "text-accent" : "text-muted")}
                >
                  ♥ {likes}
                </button>
                <button onClick={onToggleBookmark} title="bookmark"
                  className={"hover:text-accent " + (bookmarked ? "text-accent" : "text-muted")}
                >
                  {bookmarked ? "★" : "☆"}
                </button>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <DifficultyBadge difficulty={problem.difficulty} />
              <span className="text-muted">·</span>
              <span className="text-muted">{(problem.acceptance_rate * 100).toFixed(0)}% acceptance</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{problem.time_limit_ms} ms / {problem.memory_limit_mb} MB</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{problem.test_cases.length} tests</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {problem.tags.map((t) => <TagPill key={t} tag={t} />)}
            </div>
          </div>

          <div className="border-b border-border px-5 pt-3">
            <Tabs
              active={tab}
              onChange={(k) => setTab(k as Tab)}
              tabs={[
                { key: "description",  label: "Description" },
                { key: "editorial",    label: "Editorial"   },
                { key: "solution",     label: "Solution"    },
                { key: "submissions",  label: "Submissions" },
                { key: "notes",        label: "Notes"       },
                { key: "discussion",   label: "Discussion"  },
              ]}
            />
          </div>

          <div className="p-5">
            {tab === "description" && (
              <div className="space-y-5 text-sm leading-7">
                <MarkdownLite source={problem.description} />

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Constraints</h3>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {problem.constraints.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Examples</h3>
                  <div className="space-y-3">
                    {problem.examples.map((ex, i) => (
                      <div key={i} className="rounded border border-border bg-bg p-3 text-xs">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-muted">Input</div>
                            <pre className="mt-1 font-mono whitespace-pre-wrap">{ex.input}</pre>
                          </div>
                          <div>
                            <div className="text-muted">Output</div>
                            <pre className="mt-1 font-mono whitespace-pre-wrap">{ex.output}</pre>
                          </div>
                        </div>
                        {ex.explanation && <div className="mt-2 text-muted"><em>{ex.explanation}</em></div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Sample tests</h3>
                  <div className="space-y-2">
                    {samples.map((tc, i) => (
                      <div key={i} className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <div className="text-muted">Input</div>
                          <pre className="mt-1 rounded bg-bg p-2 font-mono">{tc.input}</pre>
                        </div>
                        <div>
                          <div className="text-muted">Expected</div>
                          <pre className="mt-1 rounded bg-bg p-2 font-mono">{tc.expected}</pre>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {problem.hints.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Hints</h3>
                    <div className="space-y-2">
                      {problem.hints.slice(0, hintsShown).map((h, i) => (
                        <div key={i} className="rounded border border-warn/40 bg-warn/5 p-2 text-xs text-warn">
                          Hint {i + 1}. {h}
                        </div>
                      ))}
                      {hintsShown < problem.hints.length && (
                        <button onClick={() => setHintsShown((n) => n + 1)} className="text-xs text-accent hover:underline">
                          show hint {hintsShown + 1} of {problem.hints.length}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Companies</h3>
                    <div className="flex flex-wrap gap-1">
                      {problem.company_tags.map((c) => <TagPill key={c} tag={c} />)}
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Frequency</h3>
                    <div className="h-2 w-full rounded-full bg-bg">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${problem.frequency}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted">{problem.frequency}/100 asked</div>
                  </div>
                </div>

                {related.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Related problems</h3>
                    <ul className="space-y-1 text-sm">
                      {related.map((r) => (
                        <li key={r.slug} className="flex items-center gap-2">
                          <DifficultyBadge difficulty={r.difficulty} />
                          <Link href={`/problems/${r.slug}`} className="text-accent hover:underline">{r.title}</Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {tab === "editorial" && <MarkdownLite source={problem.editorial} />}

            {tab === "solution" && (
              <SolutionPanel solution={problem.solution} approach={problem.approach} complexity={problem.complexity} />
            )}

            {tab === "submissions" && (
              <div>
                {!user ? (
                  <div className="text-sm text-muted">Log in to see your submission history.</div>
                ) : mySubs.length === 0 ? (
                  <div className="text-sm text-muted">No submissions yet.</div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-muted">
                      <tr className="text-left">
                        <th className="py-1">ID</th><th className="py-1">Verdict</th>
                        <th className="py-1">Time</th><th className="py-1">Memory</th>
                        <th className="py-1">Lang</th><th className="py-1">When</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mySubs.map((s) => (
                        <tr key={s.submission_id} className="border-t border-border">
                          <td className="py-1.5">
                            <Link href={`/submissions/${s.submission_id}`} className="text-accent hover:underline">
                              #{s.submission_id.slice(0, 6)}{s.is_run_only && " (run)"}
                            </Link>
                          </td>
                          <td className="py-1.5"><VerdictBadge verdict={s.verdict ?? "RUNNING"} /></td>
                          <td className="py-1.5 font-mono">{s.runtime_ms ?? "—"} ms</td>
                          <td className="py-1.5 font-mono">{s.memory_kb ?? "—"} KB</td>
                          <td className="py-1.5 text-muted">{s.language}</td>
                          <td className="py-1.5 text-muted">{new Date(s.submitted_at).toLocaleTimeString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === "notes" && <NotesPanel slug={problem.slug} />}

            {tab === "discussion" && <DiscussionThread slug={problem.slug} />}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {editorCard}

          {sampleResults && (
            <TestResultPanel cases={sampleResults} running={busy === "run"} />
          )}

          <details className="rounded-lg border border-border bg-panel">
            <summary className="cursor-pointer select-none p-3 text-xs text-muted hover:text-white">
              Run with custom input
            </summary>
            <div className="space-y-2 p-3 pt-0">
              <textarea
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                rows={3}
                placeholder="paste stdin here…"
                className="w-full rounded bg-bg p-2 font-mono text-xs"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{runnable ? "uses python3" : "language not wired"}</span>
                <button
                  onClick={runCustom}
                  disabled={!!busy || !runnable || !customInput}
                  className="rounded border border-border px-3 py-1 text-xs hover:border-accent disabled:opacity-40"
                >
                  {busy === "custom" ? "…" : "run"}
                </button>
              </div>
              {customResult && (
                <div className="space-y-1 rounded border border-border bg-bg p-2 text-xs font-mono">
                  <div className="text-muted">verdict: <span className="text-white">{customResult.verdict}</span> · {customResult.runtime_ms} ms</div>
                  {customResult.stdout && <pre className="whitespace-pre-wrap">{customResult.stdout}</pre>}
                  {customResult.stderr && <pre className="whitespace-pre-wrap text-bad">{customResult.stderr}</pre>}
                </div>
              )}
            </div>
          </details>

          {submission && (
            <div className="rounded-lg border border-border bg-panel p-4 text-sm">
              <div className="mb-3 flex items-center gap-3">
                <span className="text-muted">verdict:</span>
                <VerdictBadge verdict={submission.verdict ?? "RUNNING"} />
                {submission.runtime_ms !== undefined && (
                  <span className="text-xs text-muted">{submission.runtime_ms} ms · {submission.memory_kb} KB</span>
                )}
                <Link href={`/submissions/${submission.submission_id}`} className="ml-auto text-xs text-accent hover:underline">
                  details →
                </Link>
              </div>
              {submission.failed_test_seq != null && (
                <div className="text-xs text-bad">failed first on test {submission.failed_test_seq}</div>
              )}
              {submission.compile_stderr && (
                <pre className="mt-2 whitespace-pre-wrap rounded bg-bg p-2 font-mono text-xs text-bad">
                  {submission.compile_stderr}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
