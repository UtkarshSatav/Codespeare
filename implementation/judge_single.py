#!/usr/bin/env python3
"""
judge_single.py — one-shot judge invoked by the Next.js API.

Reads a single JSON payload on stdin describing the submission and the
problem, runs it through the same sandbox-and-validator path used by
demo.py, and writes the verdict JSON to stdout.

Input  (stdin)
--------------
{
  "language": "python3",
  "source":   "<user source code>",
  "problem": {
      "time_limit_ms": 2000,
      "memory_limit_mb": 256,
      "checker_type": "trimmed",
      "checker_eps": 1e-6,
      "test_cases": [
          {"seq": 1, "input": "2 3\n", "expected": "5\n"},
          ...
      ]
  }
}

Output (stdout)
---------------
{
  "verdict": "AC",
  "runtime_ms": 62,
  "memory_kb": 8400,
  "failed_test_seq": null,
  "compile_stderr": "",
  "per_test": [
     {"seq": 1, "verdict": "AC", "runtime_ms": 20, "memory_kb": 8400},
     ...
  ]
}
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict

from sandbox_worker import Problem, Submission, TestCase
from sandbox_worker import SandboxWorker  # only for the _judge method


def main() -> None:
    payload = json.load(sys.stdin)

    p = payload["problem"]
    problem = Problem(
        problem_id=0,
        title="ad-hoc",
        time_limit_ms=int(p.get("time_limit_ms", 2000)),
        memory_limit_mb=int(p.get("memory_limit_mb", 256)),
        checker_type=p.get("checker_type", "trimmed"),
        checker_eps=float(p.get("checker_eps", 1e-6)),
        test_cases=[
            TestCase(
                test_case_id=i + 1,
                seq=int(tc.get("seq", i + 1)),
                input_data=tc.get("input", ""),
                expected_output=tc.get("expected", ""),
                is_sample=bool(tc.get("is_sample", False)),
            )
            for i, tc in enumerate(p["test_cases"])
        ],
    )

    submission = Submission(
        submission_id=0,
        user_id=0,
        problem_id=0,
        language=payload["language"],
        source=payload["source"],
    )

    # We don't need the queue / threading machinery for a one-shot run;
    # we instantiate a worker just to reuse its _judge() method.
    worker = SandboxWorker.__new__(SandboxWorker)
    verdict = worker._judge(submission, problem)

    out = {
        "verdict": verdict.verdict,
        "runtime_ms": verdict.runtime_ms,
        "memory_kb": verdict.memory_kb,
        "failed_test_seq": verdict.failed_test_seq,
        "compile_stderr": verdict.compile_stderr,
        "per_test": [asdict(pt) for pt in verdict.per_test],
    }
    json.dump(out, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
