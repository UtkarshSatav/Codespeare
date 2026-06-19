# Q5 — Algorithm and Implementation (Python)

## 5.1 Scope of the Python Implementation

The runnable code in `implementation/` is a **single-process simulation** of
the full pipeline:

```
api_gateway.py  ──►  submission_service.py  ──►  in-memory queue
                                                  │
                                                  ▼
                                          sandbox_worker.py
                                                  │
                                                  ▼
                                          code_executor.py   ◄── runs user code
                                                  │
                                                  ▼
                                          test_validator.py   ◄── compares output
```

In a real cluster the queue is Kafka and the executor uses Docker; here we
use `multiprocessing.Queue` and `subprocess.run` with `resource.setrlimit` so
the demo runs on any laptop without Docker installed.

The demo entrypoint is `implementation/demo.py`. Running it walks through:

1. Registering a user.
2. Submitting Python code to a "Sum of Two Numbers" problem.
3. The worker executing the code against 3 hidden test cases.
4. Verdict generation and printing.

---

## 5.2 Core Algorithm — Execute & Validate

The heart of the system is the **executor → validator** loop. Pseudocode:

```
function judge(submission):
    code = fetch_code(submission.code_blob)
    problem = fetch_problem(submission.problem_id)

    if problem.requires_compile:
        ok, err = compile(code, language=submission.language)
        if not ok: return verdict("CE", details=err)

    results = []
    for tc in problem.test_cases sorted by seq:
        out, runtime_ms, mem_kb, err = run_sandboxed(
            binary_or_script,
            stdin=tc.input,
            cpu_limit_s = problem.time_limit_ms / 1000,
            mem_limit_mb = problem.memory_limit_mb)

        if err == "TIMEOUT":  return verdict("TLE", upto=tc)
        if err == "OOM":      return verdict("MLE", upto=tc)
        if err == "SIGNAL":   return verdict("RE",  upto=tc)

        passed = compare(out, tc.expected, mode=problem.checker_type)
        results.append((tc.id, passed, runtime_ms, mem_kb))
        if not passed:
            return verdict("WA", upto=tc, results=results)

    return verdict("AC", results=results)
```

Notable properties:

* **Early exit** on first failure — most submissions either pass or fail
  quickly; we don't waste workers on doomed runs.
* **Determinism** — limits are applied per test case, not globally.
* **Streaming** — the worker emits a `live:status:{sid}` Redis key after each
  test case so the UI shows "test 3/10 ✅".

---

## 5.3 Sandbox Mechanics in Python

`code_executor.py` applies these protections **without Docker** (since the
demo must run anywhere):

| Mechanism                          | API used                              |
|------------------------------------|---------------------------------------|
| CPU-time limit                     | `resource.setrlimit(RLIMIT_CPU, ...)` |
| Memory limit                       | `resource.setrlimit(RLIMIT_AS, ...)`  |
| Process count limit (fork bomb)    | `resource.setrlimit(RLIMIT_NPROC, ...)`|
| File-size limit                    | `resource.setrlimit(RLIMIT_FSIZE, ...)`|
| Wall-clock timeout                 | `subprocess.run(..., timeout=...)`    |
| Forced kill on SIGKILL             | `os.killpg` on the process group      |
| Isolated stdin/stdout              | `subprocess.PIPE`                     |
| Working dir = ephemeral tempdir    | `tempfile.TemporaryDirectory`         |

A **production worker** swaps these for Docker flags (see `03_execution_flow.md`)
because Python-level `setrlimit` is bypassable by sufficiently determined code
(e.g., direct `syscall()` to remove the limit). The demo limits are sufficient
to demonstrate the verdicts, not to hold against real attackers.

---

## 5.4 Test-Case Validation Logic

`test_validator.py` supports four comparison modes:

```python
def compare(actual: str, expected: str, mode: str = "trimmed",
            eps: float = 1e-6) -> bool:
    if mode == "exact":
        return actual == expected
    if mode == "trimmed":
        return _normalize(actual) == _normalize(expected)
    if mode == "numeric_eps":
        return _numeric_close(actual, expected, eps)
    if mode == "custom_checker":
        raise NotImplementedError("requires problem-supplied judge")
```

Where `_normalize` collapses trailing whitespace and CR/LF, and
`_numeric_close` tokenises both sides and applies `abs(a-b) ≤ eps + eps*|b|`.

The mode is per-problem (`problems.checker_type`), so:

* String problems → `trimmed`
* "Compute π to 6 places" → `numeric_eps`
* "Print any valid topological order" → `custom_checker`

---

## 5.5 How the Demo Maps to the Production System

| Production component   | Demo file                          | Stand-in                |
|------------------------|------------------------------------|-------------------------|
| Web client             | hard-coded JSON in `demo.py`       | —                       |
| API Gateway            | `api_gateway.py`                   | Pure-Python class       |
| Submission Service     | `submission_service.py`            | Writes to a Python dict |
| Kafka                  | `multiprocessing.Queue`            | Same producer/consumer semantics |
| Sandbox Worker         | `sandbox_worker.py` (loop)         | Same control flow       |
| Docker sandbox         | `code_executor.py` (`subprocess` + rlimit) | Weaker but illustrative |
| Result Service         | callback in `sandbox_worker.py`    | Updates same dict       |
| Postgres               | in-memory `dict`                   | —                       |
| S3                     | local files in `/tmp/codesphere`   | —                       |

This 1-to-1 mapping makes the case-study code easy to grade — the same
control-flow runs in toy form in `demo.py` and at scale in the real cluster.

---

## 5.6 Sample Verdict Outputs (from `demo.py`)

Running `python demo.py` will print, for three different submissions:

```
▶ Submission 1  (correct)         → AC   (runtime 14 ms, memory 5 MB)
▶ Submission 2  (off-by-one)      → WA   (failed test 2/3)
▶ Submission 3  (infinite loop)   → TLE  (killed after 2.0 s)
```

This demonstrates the four most-common verdicts and the early-exit behaviour
described in §5.2.
