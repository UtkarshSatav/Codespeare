// POST /api/judge
//
// Stateless: takes (problem_slug, language, source, mode) and returns
// a verdict.  Does NOT touch Firestore — the client owns the submission
// doc and writes the verdict back via the Web SDK.
//
// Why server-side at all?  The Python judge subprocess runs here so
// the browser can't forge per-test runtime / memory numbers and can't
// see hidden test cases.

import type { NextApiRequest, NextApiResponse } from "next";

import { judgeSubmission } from "@/lib/judge";
import { findProblem, LANGUAGES } from "@/lib/problems";

const MAX_SOURCE_BYTES = 64 * 1024;
const VALID_LANGS = new Set(LANGUAGES.map((l) => l.code));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const { problem_slug, language, source, mode } = req.body ?? {};
  if (typeof problem_slug !== "string" || typeof language !== "string" || typeof source !== "string") {
    res.status(400).json({ error: "missing fields" });
    return;
  }
  if (!VALID_LANGS.has(language as never)) {
    res.status(400).json({ error: `unknown language: ${language}` });
    return;
  }
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    res.status(413).json({ error: "source too large" });
    return;
  }
  const problem = findProblem(problem_slug);
  if (!problem) {
    res.status(404).json({ error: "problem not found" });
    return;
  }
  const runMode: "run" | "submit" = mode === "run" ? "run" : "submit";

  try {
    const verdict = await judgeSubmission(source, language, problem, runMode);
    res.status(200).json(verdict);
  } catch (e) {
    res.status(500).json({
      verdict: "SE",
      runtime_ms: 0,
      memory_kb: 0,
      failed_test_seq: null,
      compile_stderr: `judge failed: ${(e as Error).message}`,
      per_test: [],
    });
  }
}
