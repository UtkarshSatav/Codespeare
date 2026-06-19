// Stateless wrapper around the Python judge subprocess.
//
// Architecture note: this module no longer touches Firestore.  The
// client owns the submission doc; it calls /api/judge with code and
// receives a verdict, then writes the verdict back to Firestore using
// the Web SDK.
//
// In production each of these calls would be a Pub/Sub job consumed by
// a sandboxed Docker worker (see docs/02_system_architecture.md).

import { spawn } from "child_process";
import path from "path";

import { RUNNABLE_LANGUAGES, type Problem } from "@/lib/problems";

const JUDGE_PATH = path.resolve(
  process.cwd(), "..", "implementation", "judge_single.py",
);
const JUDGE_DIR = path.resolve(process.cwd(), "..", "implementation");

export type Verdict =
  | "AC" | "WA" | "TLE" | "MLE" | "RE" | "CE" | "SE";

export interface JudgeOutput {
  verdict: Verdict;
  runtime_ms: number;
  memory_kb: number;
  failed_test_seq: number | null;
  compile_stderr: string;
  per_test: Array<{ seq: number; verdict: Verdict; runtime_ms: number; memory_kb: number }>;
}

export async function judgeSubmission(
  source: string,
  language: string,
  problem: Problem,
  mode: "run" | "submit",
): Promise<JudgeOutput> {
  if (!RUNNABLE_LANGUAGES.has(language as never)) {
    return {
      verdict: "SE",
      runtime_ms: 0,
      memory_kb: 0,
      failed_test_seq: null,
      compile_stderr:
        `Language '${language}' is selectable but not wired in this ` +
        `demo. Only python3 actually runs against the judge. ` +
        `In production each language gets its own Docker worker pool ` +
        `(see docs/02_system_architecture.md).`,
      per_test: [],
    };
  }
  const tests = mode === "run"
    ? problem.test_cases.filter((tc) => tc.is_sample)
    : problem.test_cases;
  return await runJudge(source, language, problem, tests);
}

function runJudge(
  source: string,
  language: string,
  problem: Problem,
  testCases: Problem["test_cases"],
): Promise<JudgeOutput> {
  const payload = JSON.stringify({
    language,
    source,
    problem: {
      time_limit_ms: problem.time_limit_ms,
      memory_limit_mb: problem.memory_limit_mb,
      checker_type: problem.checker_type,
      checker_eps: problem.checker_eps ?? 1e-6,
      test_cases: testCases.map((tc) => ({
        seq: tc.seq,
        input: tc.input,
        expected: tc.expected,
        is_sample: tc.is_sample,
      })),
    },
  });

  return new Promise((resolve, reject) => {
    const proc = spawn("python3", [JUDGE_PATH], {
      cwd: JUDGE_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`judge exited ${code}: ${stderr || stdout}`));
        return;
      }
      try { resolve(JSON.parse(stdout) as JudgeOutput); }
      catch { reject(new Error(`bad judge output: ${stdout.slice(0, 200)}`)); }
    });
    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

// Ad-hoc execution for the "Run with custom input" button — captures
// stdout/stderr rather than producing a verdict.
export function runCustomPython(
  source: string,
  stdinData: string,
  timeoutMs: number,
): Promise<{ verdict: Verdict; stdout: string; stderr: string; runtime_ms: number; memory_kb: number }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const proc = spawn("python3", ["-c", source], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    proc.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    proc.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    const killTimer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs * 2);
    proc.on("close", (code) => {
      clearTimeout(killTimer);
      const runtime_ms = Date.now() - start;
      let verdict: Verdict = "AC";
      if (runtime_ms >= timeoutMs * 1.9) verdict = "TLE";
      else if (code !== 0)               verdict = "RE";
      resolve({ verdict, stdout, stderr, runtime_ms, memory_kb: 0 });
    });
    proc.stdin.write(stdinData);
    proc.stdin.end();
  });
}
