// LeetCode-style "Test Result" panel.
//
// Given the result of running the user's code against the *sample* test
// cases, it shows per-case Input / Your Output / Expected, with a chip
// row to switch between cases and an overall pass banner.  Prop-driven
// so it has no dependency on the problem catalogue.

import { useState } from "react";

export interface CaseResult {
  seq: number;
  label?: string;
  input: string;
  expected: string;
  actual?: string;
  stderr?: string;
  passed?: boolean;     // undefined while still running
  runtime_ms?: number;
}

function Block({ title, value, tone = "default" }: { title: string; value: string; tone?: "default" | "good" | "bad" }) {
  const ring =
    tone === "good" ? "border-ok/40" : tone === "bad" ? "border-bad/40" : "border-border";
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">{title}</div>
      <pre className={`max-h-40 overflow-auto whitespace-pre-wrap rounded border ${ring} bg-bg p-2 font-mono text-xs leading-5`}>
        {value === "" ? <span className="text-muted">(empty)</span> : value}
      </pre>
    </div>
  );
}

export default function TestResultPanel({
  cases,
  running,
  title = "Test Result",
}: {
  cases: CaseResult[];
  running?: boolean;
  title?: string;
}) {
  const [sel, setSel] = useState(0);

  if (running) {
    return (
      <div className="rounded-lg border border-border bg-panel p-4 text-sm text-muted">
        Running against sample tests…
      </div>
    );
  }
  if (cases.length === 0) return null;

  const ran = cases.some((c) => c.passed !== undefined);
  const passedCount = cases.filter((c) => c.passed).length;
  const allPassed = ran && passedCount === cases.length;
  const active = cases[Math.min(sel, cases.length - 1)];

  return (
    <div className="rounded-lg border border-border bg-panel">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        {ran && (
          <span className={`text-sm font-semibold ${allPassed ? "text-ok" : "text-bad"}`}>
            {allPassed ? "Accepted" : "Wrong Answer"}
          </span>
        )}
        {ran && (
          <span className="text-xs text-muted">{passedCount}/{cases.length} sample cases passed</span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        {cases.map((c, i) => {
          const tone =
            c.passed === undefined ? "border-border text-muted"
            : c.passed ? "border-ok/50 text-ok" : "border-bad/50 text-bad";
          const activeRing = i === sel ? "bg-bg" : "";
          return (
            <button
              key={c.seq}
              onClick={() => setSel(i)}
              className={`rounded border px-2.5 py-1 text-xs ${tone} ${activeRing} hover:bg-bg`}
            >
              {c.passed === undefined ? "•" : c.passed ? "✓" : "✗"} Case {i + 1}
            </button>
          );
        })}
      </div>

      <div className="space-y-3 p-4">
        {active.label && <div className="text-xs text-muted">{active.label}</div>}
        <Block title="Input" value={active.input} />
        <Block
          title="Your Output"
          value={active.actual ?? "(not run)"}
          tone={active.passed === undefined ? "default" : active.passed ? "good" : "bad"}
        />
        <Block title="Expected Output" value={active.expected} />
        {active.stderr && <Block title="Stderr" value={active.stderr} tone="bad" />}
        {active.runtime_ms !== undefined && (
          <div className="text-xs text-muted">runtime {active.runtime_ms} ms</div>
        )}
      </div>
    </div>
  );
}
