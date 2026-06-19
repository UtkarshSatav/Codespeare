import type { Verdict } from "@/lib/firestore-client";

const COLORS: Record<Verdict, string> = {
  QUEUED:   "bg-border  text-muted",
  RUNNING:  "bg-warn/20 text-warn",
  AC:       "bg-ok/20   text-ok",
  WA:       "bg-bad/20  text-bad",
  TLE:      "bg-bad/20  text-bad",
  MLE:      "bg-bad/20  text-bad",
  RE:       "bg-bad/20  text-bad",
  CE:       "bg-bad/20  text-bad",
  SE:       "bg-warn/20 text-warn",
};

const LABEL: Record<Verdict, string> = {
  QUEUED:  "Queued",
  RUNNING: "Running…",
  AC:      "Accepted",
  WA:      "Wrong Answer",
  TLE:     "Time Limit Exceeded",
  MLE:     "Memory Limit Exceeded",
  RE:      "Runtime Error",
  CE:      "Compile Error",
  SE:      "System Error",
};

export default function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${COLORS[verdict]}`}
    >
      {LABEL[verdict]}
    </span>
  );
}
