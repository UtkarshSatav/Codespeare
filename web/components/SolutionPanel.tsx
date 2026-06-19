// Official "Solution" tab — gated behind a reveal click so users don't
// spoil themselves by accident (same UX as LeetCode's locked solution).
//
// Shows: an approach write-up (markdown), time/space complexity badges,
// and the reference code with a language switcher + copy button.

import { useState } from "react";

import MarkdownLite from "@/components/MarkdownLite";
import { LANGUAGES, type LanguageCode } from "@/lib/problems";

export default function SolutionPanel({
  solution,
  approach,
  complexity,
}: {
  solution: Partial<Record<LanguageCode, string>>;
  approach: string;
  complexity?: { time: string; space: string };
}) {
  const available = LANGUAGES.filter((l) => solution[l.code]);
  const [revealed, setRevealed] = useState(false);
  const [lang, setLang] = useState<LanguageCode>(available[0]?.code ?? "python3");
  const [copied, setCopied] = useState(false);

  if (!revealed) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-bg/40 py-12 text-center">
        <div className="text-sm text-muted">
          The official solution is hidden so you can try first.
        </div>
        <button
          onClick={() => setRevealed(true)}
          className="rounded bg-accent px-4 py-1.5 text-sm font-semibold text-bg hover:opacity-90"
        >
          Reveal solution
        </button>
      </div>
    );
  }

  const code = solution[lang] ?? "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* clipboard blocked */ }
  }

  return (
    <div className="space-y-5">
      {complexity && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded border border-border bg-bg px-2 py-1">
            <span className="text-muted">Time </span>
            <span className="font-mono text-accent">{complexity.time}</span>
          </span>
          <span className="rounded border border-border bg-bg px-2 py-1">
            <span className="text-muted">Space </span>
            <span className="font-mono text-accent">{complexity.space}</span>
          </span>
        </div>
      )}

      {approach && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Approach</h3>
          <MarkdownLite source={approach} />
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Reference code</h3>
          <div className="flex items-center gap-2 text-xs">
            {available.length > 1 && (
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as LanguageCode)}
                className="rounded bg-bg px-2 py-1 text-xs"
              >
                {available.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            )}
            <button onClick={copy} className="rounded border border-border px-2 py-1 hover:border-accent">
              {copied ? "copied ✓" : "copy"}
            </button>
          </div>
        </div>
        <pre className="overflow-x-auto rounded border border-border bg-bg p-3 font-mono text-xs leading-6">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
