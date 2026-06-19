import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

import Layout from "@/components/Layout";
import VerdictBadge from "@/components/VerdictBadge";
import {
  watchSubmission,
  type SubmissionRecord,
  type Verdict,
} from "@/lib/firestore-client";

export default function SubmissionDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [sub, setSub] = useState<SubmissionRecord | null>(null);

  useEffect(() => {
    if (typeof id !== "string") return;
    const unsub = watchSubmission(id, setSub);
    return unsub;
  }, [id]);

  if (!sub) {
    return (
      <Layout>
        <p className="text-muted">loading submission…</p>
      </Layout>
    );
  }

  const v: Verdict = sub.verdict ?? (sub.status === "RUNNING" ? "RUNNING" : "QUEUED");

  return (
    <Layout>
      <Link href="/submissions" className="text-sm text-muted hover:text-white">
        ← back to submissions
      </Link>

      <div className="mt-4 rounded-lg border border-border bg-panel p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">
            Submission #{sub.submission_id.slice(0, 8)}
          </h1>
          <VerdictBadge verdict={v} />
        </div>
        <div className="mt-2 text-xs text-muted">
          by{" "}
          <Link href={`/profile/${sub.username}`} className="text-accent hover:underline">
            {sub.username}
          </Link>{" "}
          on{" "}
          <Link href={`/problems/${sub.problem_slug}`} className="text-accent hover:underline">
            {sub.problem_slug}
          </Link>{" "}
          · {sub.language} · {sub.is_run_only ? "run on samples" : "full submit"} ·{" "}
          {new Date(sub.submitted_at).toLocaleString()}
        </div>

        {sub.runtime_ms != null && (
          <div className="mt-3 text-sm">
            <span className="text-muted">runtime</span>{" "}
            <span className="font-mono">{sub.runtime_ms} ms</span>{" "}
            <span className="text-muted">· memory</span>{" "}
            <span className="font-mono">{sub.memory_kb} KB</span>
            {sub.failed_test_seq != null && (
              <> · <span className="text-bad">failed test {sub.failed_test_seq}</span></>
            )}
          </div>
        )}

        {sub.compile_stderr && (
          <pre className="mt-4 whitespace-pre-wrap rounded bg-bg p-3 font-mono text-xs text-bad">
            {sub.compile_stderr}
          </pre>
        )}

        {sub.per_test && sub.per_test.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-muted">per-test breakdown</h2>
            <table className="w-full text-xs">
              <thead className="text-muted">
                <tr className="text-left">
                  <th className="py-1 font-medium">#</th>
                  <th className="py-1 font-medium">Verdict</th>
                  <th className="py-1 font-medium">Time</th>
                  <th className="py-1 font-medium">Memory</th>
                </tr>
              </thead>
              <tbody>
                {sub.per_test.map((pt) => (
                  <tr key={pt.seq} className="border-t border-border">
                    <td className="py-1.5">{pt.seq}</td>
                    <td className="py-1.5"><VerdictBadge verdict={pt.verdict} /></td>
                    <td className="py-1.5 font-mono">{pt.runtime_ms} ms</td>
                    <td className="py-1.5 font-mono">{pt.memory_kb} KB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">source</h2>
          <pre className="overflow-x-auto rounded bg-bg p-3 font-mono text-xs">
            {sub.source}
          </pre>
        </div>
      </div>
    </Layout>
  );
}
