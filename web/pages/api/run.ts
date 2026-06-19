// POST /api/run — ad-hoc execute Python code against user-supplied
// stdin and return stdout/stderr.  Stateless; no Firestore involvement.

import type { NextApiRequest, NextApiResponse } from "next";

import { runCustomPython } from "@/lib/judge";
import { RUNNABLE_LANGUAGES } from "@/lib/problems";

const MAX_SOURCE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const { language, source, stdin, timeout_ms } = req.body ?? {};
  if (typeof language !== "string" || typeof source !== "string" || typeof stdin !== "string") {
    res.status(400).json({ error: "missing fields" });
    return;
  }
  if (Buffer.byteLength(source, "utf8") > MAX_SOURCE_BYTES) {
    res.status(413).json({ error: "source too large" });
    return;
  }
  if (!RUNNABLE_LANGUAGES.has(language as never)) {
    res.status(200).json({
      verdict: "SE",
      stdout: "",
      stderr: `Language '${language}' is not wired in this demo; only python3 actually runs.`,
      runtime_ms: 0,
      memory_kb: 0,
    });
    return;
  }
  const out = await runCustomPython(
    source,
    stdin,
    typeof timeout_ms === "number" ? timeout_ms : DEFAULT_TIMEOUT_MS,
  );
  res.status(200).json(out);
}
