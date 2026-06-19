"""
sandbox_worker.py
=================

A worker that consumes submission jobs from an in-process queue, runs
them through the executor + validator, and writes verdicts back to the
shared "results store" (a dict acting as our Postgres stand-in).

The control flow mirrors the production worker described in
docs/03_execution_flow.md verbatim — the only differences are:

  * `queue.Queue` instead of Kafka.
  * `code_executor.py` with rlimits instead of a Docker container.

All public behaviour — early-exit on first failure, verdict mapping,
per-test-case stats — is identical to the production design.
"""

from __future__ import annotations

import queue
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

from code_executor import CodeExecutor, prepare_workdir
from test_validator import compare


# ---------------------------------------------------------------------------
# Domain types — these would normally live in a `models.py`.
# ---------------------------------------------------------------------------

@dataclass
class TestCase:
    test_case_id: int
    seq: int
    input_data: str
    expected_output: str
    is_sample: bool = False


@dataclass
class Problem:
    problem_id: int
    title: str
    time_limit_ms: int
    memory_limit_mb: int
    checker_type: str
    checker_eps: float
    test_cases: List[TestCase]


@dataclass
class Submission:
    submission_id: int
    user_id: int
    problem_id: int
    language: str
    source: str


@dataclass
class PerTestResult:
    test_case_id: int
    seq: int
    verdict: str
    runtime_ms: int
    memory_kb: int


@dataclass
class Verdict:
    submission_id: int
    verdict: str
    runtime_ms: int = 0
    memory_kb: int = 0
    failed_test_seq: Optional[int] = None
    compile_stderr: str = ""
    per_test: List[PerTestResult] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Worker
# ---------------------------------------------------------------------------

class SandboxWorker(threading.Thread):
    """
    Consumes (submission, problem) tuples from a queue, judges them, and
    writes the verdict into the shared `results` dict.
    """

    def __init__(
        self,
        job_queue: "queue.Queue[tuple[Submission, Problem]]",
        results: Dict[int, Verdict],
        name: str = "worker",
    ):
        super().__init__(daemon=True, name=name)
        self.job_queue = job_queue
        self.results = results
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        while not self._stop_event.is_set():
            try:
                submission, problem = self.job_queue.get(timeout=0.25)
            except queue.Empty:
                continue
            try:
                verdict = self._judge(submission, problem)
            except Exception as exc:                          # pragma: no cover
                verdict = Verdict(
                    submission_id=submission.submission_id,
                    verdict="SE",
                    compile_stderr=f"worker error: {exc!r}",
                )
            # The verdict write must succeed BEFORE the queue ack
            # (here: `task_done`) — same invariant as production.
            self.results[submission.submission_id] = verdict
            self.job_queue.task_done()

    # ------------------------------------------------------------------
    # Judging algorithm
    # ------------------------------------------------------------------

    def _judge(self, submission: Submission, problem: Problem) -> Verdict:
        executor = CodeExecutor(
            cpu_limit_s=problem.time_limit_ms / 1000.0,
            wall_limit_s=max(2.0, 2 * problem.time_limit_ms / 1000.0),
            memory_limit_mb=problem.memory_limit_mb,
        )

        with prepare_workdir(submission.source, submission.language) as tmp:
            workdir = Path(tmp)

            # ---- Step 1: compile (skipped for interpreted languages) ----
            comp = executor.compile(workdir, submission.language)
            if not comp.success:
                return Verdict(
                    submission_id=submission.submission_id,
                    verdict="CE",
                    compile_stderr=comp.stderr,
                )

            # ---- Step 2: run each test case until first failure ---------
            per_test: List[PerTestResult] = []
            total_runtime = 0
            peak_memory = 0

            for tc in sorted(problem.test_cases, key=lambda t: t.seq):
                run = executor.run(workdir, submission.language, tc.input_data)
                total_runtime += run.runtime_ms
                peak_memory = max(peak_memory, run.memory_kb)

                if run.timed_out:
                    per_test.append(PerTestResult(
                        tc.test_case_id, tc.seq, "TLE",
                        run.runtime_ms, run.memory_kb))
                    return self._finish("TLE", submission, total_runtime,
                                        peak_memory, tc.seq, per_test)

                if run.out_of_memory:
                    per_test.append(PerTestResult(
                        tc.test_case_id, tc.seq, "MLE",
                        run.runtime_ms, run.memory_kb))
                    return self._finish("MLE", submission, total_runtime,
                                        peak_memory, tc.seq, per_test)

                if run.runtime_error:
                    per_test.append(PerTestResult(
                        tc.test_case_id, tc.seq, "RE",
                        run.runtime_ms, run.memory_kb))
                    return self._finish("RE", submission, total_runtime,
                                        peak_memory, tc.seq, per_test)

                cmp = compare(
                    run.stdout, tc.expected_output,
                    mode=problem.checker_type,
                    eps=problem.checker_eps or 1e-6,
                )
                if not cmp.passed:
                    per_test.append(PerTestResult(
                        tc.test_case_id, tc.seq, "WA",
                        run.runtime_ms, run.memory_kb))
                    return self._finish("WA", submission, total_runtime,
                                        peak_memory, tc.seq, per_test)

                per_test.append(PerTestResult(
                    tc.test_case_id, tc.seq, "AC",
                    run.runtime_ms, run.memory_kb))

            # ---- Step 3: all tests passed ------------------------------
            return self._finish("AC", submission, total_runtime,
                                peak_memory, None, per_test)

    @staticmethod
    def _finish(verdict_code, sub, runtime, mem, failed_seq, per_test):
        return Verdict(
            submission_id=sub.submission_id,
            verdict=verdict_code,
            runtime_ms=runtime,
            memory_kb=mem,
            failed_test_seq=failed_seq,
            per_test=per_test,
        )
