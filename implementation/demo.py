"""
demo.py
=======

End-to-end demonstration of the CodeSphere pipeline running in a single
process.  Spins up:

    APIGateway → SubmissionService → in-memory queue → SandboxWorker

and judges six deliberately different Python submissions, exercising
every verdict in the production taxonomy:

    1. Correct           →  AC   (Accepted)
    2. Off-by-one        →  WA   (Wrong Answer)
    3. Infinite loop     →  TLE  (Time Limit Exceeded)
    4. Memory bomb       →  MLE  (Memory Limit Exceeded)
    5. Division by zero  →  RE   (Runtime Error)
    6. Syntax error      →  CE   (Compile Error — via py_compile)

Each submission goes through the same path a real one would in production
(producer + queue + worker), with the only differences being the queue
implementation (Python `queue.Queue` rather than Kafka) and the sandbox
implementation (`subprocess` + `resource.setrlimit` rather than Docker).
"""

from __future__ import annotations

import queue
import time

from api_gateway import APIGateway
from sandbox_worker import Problem, SandboxWorker, TestCase
from submission_service import InMemoryStores, SubmissionService


# ---------------------------------------------------------------------------
# Three test programs targeting the "Two Sum (Integers)" problem.
# ---------------------------------------------------------------------------

CORRECT_PY = """\
a, b = map(int, input().split())
print(a + b)
"""

OFF_BY_ONE_PY = """\
a, b = map(int, input().split())
print(a + b + 1)         # deliberately wrong
"""

INFINITE_LOOP_PY = """\
a, b = map(int, input().split())
while True:               # never terminates → TLE
    pass
"""

MEMORY_BOMB_PY = """\
a, b = map(int, input().split())
# Allocate ~100 MB on a 32 MB-limit problem → MLE.
# bytearray() touches every page, so peak RSS actually rises.
big = bytearray(100 * 1024 * 1024)
print(a + b, len(big))
"""

RUNTIME_ERROR_PY = """\
a, b = map(int, input().split())
print(a // (b - b))       # ZeroDivisionError → RE
"""

COMPILE_ERROR_PY = """\
a, b = map(int, input().split()
print(a + b)              # missing ')'  →  SyntaxError → CE
"""


# ---------------------------------------------------------------------------
# Bootstrap stores
# ---------------------------------------------------------------------------

def build_world() -> tuple[APIGateway, InMemoryStores, queue.Queue]:
    stores = InMemoryStores()
    stores.users[42] = "alice"

    stores.problems[1] = Problem(
        problem_id=1,
        title="Two Sum (Integers)",
        time_limit_ms=2000,
        memory_limit_mb=256,
        checker_type="trimmed",
        checker_eps=1e-6,
        test_cases=[
            TestCase(101, 1, "2 3\n",      "5\n",   is_sample=True),
            TestCase(102, 2, "100 200\n",  "300\n", is_sample=False),
            TestCase(103, 3, "-7 7\n",     "0\n",   is_sample=False),
        ],
    )

    # A second problem with a tight 32 MB memory limit so the MLE
    # submission has something to bump into.
    stores.problems[2] = Problem(
        problem_id=2,
        title="Two Sum (Tight Memory)",
        time_limit_ms=2000,
        memory_limit_mb=32,
        checker_type="trimmed",
        checker_eps=1e-6,
        test_cases=[
            TestCase(201, 1, "2 3\n", "5\n", is_sample=True),
        ],
    )

    job_queue: queue.Queue = queue.Queue()
    sub_service = SubmissionService(stores, job_queue)
    gateway = APIGateway(stores, sub_service)

    return gateway, stores, job_queue


# ---------------------------------------------------------------------------
# Pretty-printer for the verdict
# ---------------------------------------------------------------------------

def print_verdict(label: str, verdict) -> None:
    print(f"\n=== {label} ===")
    if verdict is None:
        print("  (no verdict — timed out waiting)")
        return
    print(f"  submission_id    : {verdict.submission_id}")
    print(f"  verdict          : {verdict.verdict}")
    print(f"  runtime_ms       : {verdict.runtime_ms}")
    print(f"  memory_kb        : {verdict.memory_kb}")
    if verdict.failed_test_seq is not None:
        print(f"  failed test seq  : {verdict.failed_test_seq}")
    if verdict.compile_stderr:
        print("  compile stderr   :")
        for line in verdict.compile_stderr.splitlines():
            print(f"      {line}")
    print("  per-test breakdown:")
    for pt in verdict.per_test:
        print(f"      tc#{pt.seq:>2}  {pt.verdict:>3}  "
              f"{pt.runtime_ms:>4} ms  {pt.memory_kb:>6} KB")


def await_verdict(gateway: APIGateway, token: str, sid: int,
                  timeout_s: float = 8.0):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        v = gateway.get_verdict(token, sid)
        if v is not None:
            return v
        time.sleep(0.05)
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    gateway, stores, job_queue = build_world()

    # Start one worker — in production this would be a fleet of pods.
    worker = SandboxWorker(job_queue, stores.verdicts, name="worker-py-1")
    worker.start()

    token = gateway.login_mock(user_id=42)

    # (label, source, problem_id)
    cases = [
        ("Submission 1 — correct solution",       CORRECT_PY,        1),
        ("Submission 2 — off-by-one solution",    OFF_BY_ONE_PY,     1),
        ("Submission 3 — infinite loop (TLE)",    INFINITE_LOOP_PY,  1),
        ("Submission 4 — memory bomb (MLE)",      MEMORY_BOMB_PY,    2),
        ("Submission 5 — runtime error (RE)",     RUNTIME_ERROR_PY,  1),
        ("Submission 6 — syntax error (CE)",      COMPILE_ERROR_PY,  1),
    ]

    for label, source, pid in cases:
        sid = gateway.post_submission(token, problem_id=pid,
                                      language="python3", source=source)
        verdict = await_verdict(gateway, token, sid)
        print_verdict(label, verdict)

    worker.stop()
    worker.join(timeout=1.0)


if __name__ == "__main__":
    main()
