# Q3 — Code Compilation and Execution Flow

This document traces a single submission end-to-end and explains how each step
is kept **secure**, **fast**, and **reproducible**.

---

## 3.1 Submission Lifecycle States

```
        ┌────────┐    ┌────────┐    ┌──────────┐    ┌─────────┐
USER ──►│ QUEUED │──►│COMPILING│──►│ RUNNING  │──►│ JUDGED  │── client notified
        └────────┘    └────────┘    └──────────┘    └─────────┘
                              │            │
                              ▼            ▼
                         ┌──────┐    ┌──────────┐
                         │  CE  │    │ TLE/MLE/ │
                         └──────┘    │  RE/SE   │
                                     └──────────┘
```

Possible terminal verdicts:

| Code | Meaning              | When emitted                                    |
|------|----------------------|-------------------------------------------------|
| AC   | Accepted             | All test cases produced expected output         |
| WA   | Wrong Answer         | Any test case stdout did not match              |
| TLE  | Time Limit Exceeded  | A test case exceeded wall/CPU limit             |
| MLE  | Memory Limit Exceed. | cgroup OOM-killed the container                 |
| RE   | Runtime Error        | Non-zero exit, segfault, uncaught exception     |
| CE   | Compile Error        | Compiler returned non-zero (compiled langs only)|
| SE   | System Error         | Worker / Docker itself failed — retried         |

---

## 3.2 Step-by-Step Trace

### Step 1 — Submission (Client → API)

```http
POST /api/v1/submissions
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "problem_id": 7,
  "language":   "cpp17",
  "source":     "#include <bits/stdc++.h> ..."
}
```

* API Gateway authenticates the JWT.
* Rate limiter checks `submissions:{user_id}` counter in Redis.
* Submission Service validates language code & source length (≤ 64 KB).

### Step 2 — Persistence

* Source code uploaded to `s3://codesphere/code/{submission_id}`.
* Row inserted into `submissions` with `status='QUEUED'`.
* Returns `202 Accepted { "submission_id": 1834912 }`.

### Step 3 — Enqueue

Submission Service publishes to Kafka topic `submit.cpp17`:

```json
{ "submission_id": 1834912,
  "problem_id":    7,
  "language":      "cpp17",
  "code_s3_key":   "code/1834912",
  "time_limit_ms": 2000,
  "memory_limit_mb": 256 }
```

The message is **durable** (replicated × 3 across brokers) — the client's
submission cannot now be lost.

### Step 4 — Worker Pickup

The C++ worker pool consumes from the `submit.cpp17` partition assigned to it.
On receipt:

1. Set `submissions.status = 'COMPILING'` (used for live UI).
2. Fetch source from S3 (cached for 5 min if same code-hash already seen).
3. Fetch problem + test cases from Postgres (cached in Redis).

### Step 5 — Sandbox Bootstrap

Create / acquire a Docker container with the following flags:

```
docker run --rm
  --network none                        # no internet, no localhost
  --read-only                           # immutable root FS
  --tmpfs /tmp:size=64m,exec            # only writable place
  --memory 256m --memory-swap 256m      # cgroup memory cap
  --cpus 1                              # cgroup cpu cap
  --pids-limit 64                       # block fork bombs
  --ulimit nofile=64:64                 # FD limit
  --ulimit fsize=4194304                # file size 4 MB
  --cap-drop ALL                        # no Linux capabilities
  --security-opt no-new-privileges
  --security-opt seccomp=judge.json     # filter risky syscalls
  --user 65534:65534                    # nobody:nogroup
  codesphere/cpp17-runtime:latest
```

A **warm pool** of 8 such containers per worker pod stays paused; we
`docker exec` into one of them, reducing startup from ~400 ms to ~30 ms.

### Step 6 — Compilation (compiled languages only)

Inside the sandbox:

```bash
g++ -O2 -std=c++17 -static-libstdc++ -o /tmp/sol /tmp/sol.cpp
```

* Wall-clock limit: **10 s** for compile.
* If exit ≠ 0 → emit verdict `CE` with stderr → skip to Step 9.
* If exit = 0 → proceed.

### Step 7 — Test-Case Execution Loop

For each test case (sample first, then hidden):

```
for tc in test_cases:
    stdout, stderr, rc, time_ms, mem_kb =
        run("/tmp/sol",
            stdin=tc.input,
            cpu_limit=2.0 s,
            wall_limit=4.0 s,
            mem_limit=256 MB)

    if exceeded_time:  verdict = TLE; break
    if exceeded_mem:   verdict = MLE; break
    if rc != 0:        verdict = RE;  break
    if compare(stdout, tc.expected_output, tc.tolerance) is False:
        verdict = WA; break
else:
    verdict = AC
```

* **Early exit** on first failure (default). Contest mode can be configured to
  run all tests for partial credit.
* Wall-clock limit is ~2× CPU limit to catch sleep loops.
* Memory is measured by `cgroup memory.max_usage_in_bytes`.

### Step 8 — Output Comparison Modes

| Mode           | Used for                  | Description                       |
|----------------|---------------------------|-----------------------------------|
| `exact`        | Default                   | Byte-for-byte equality            |
| `trimmed`      | Most string problems      | Trim trailing whitespace per line |
| `numeric_eps`  | Floating-point problems   | `abs(a-b) ≤ ε` per token          |
| `custom_checker` | Multi-valid-output problems | Run a problem-supplied judge binary |

### Step 9 — Verdict Publication

Worker publishes to Kafka topic `verdict.events`:

```json
{ "submission_id": 1834912,
  "verdict":       "AC",
  "runtime_ms":    143,
  "memory_kb":     8192,
  "per_test": [
    {"tc_id":1,"verdict":"AC","time_ms":12,"mem_kb":4096},
    {"tc_id":2,"verdict":"AC","time_ms":143,"mem_kb":8192}
  ]
}
```

Worker then **acks the original `submit.cpp17` message**. If anything before
this point crashed, Kafka redelivers and a fresh worker re-runs from Step 4.

### Step 10 — Result Persistence & Notification

Result Service:
* Updates `submissions` row (status, verdict, totals).
* Bulk-inserts `submission_results` per test case.
* `ZINCRBY leaderboard:7 1 user:42` — bumps Redis sorted-set rank.
* Pushes WebSocket frame to the user's session — client UI flips to ✅ Accepted.

---

## 3.3 Security Mechanisms (defense in depth)

```
   ┌──────────────────────────────────────────────────────────────┐
   │ Layer 0 — Authentication, rate-limit, source-size cap        │  prevents trivial abuse
   ├──────────────────────────────────────────────────────────────┤
   │ Layer 1 — Container (Docker)                                 │  process & FS isolation
   │   • read-only root, tmpfs /tmp                               │
   │   • non-root user                                            │
   ├──────────────────────────────────────────────────────────────┤
   │ Layer 2 — Linux primitives                                   │  kernel-level limits
   │   • cgroups (cpu, mem, pids)                                 │
   │   • capabilities dropped (CAP_NET_*, CAP_SYS_*)              │
   │   • seccomp-bpf syscall whitelist                            │
   │   • no-new-privileges                                        │
   ├──────────────────────────────────────────────────────────────┤
   │ Layer 3 — Network                                            │  blocks exfiltration
   │   • --network none  (no loopback, no DNS)                    │
   ├──────────────────────────────────────────────────────────────┤
   │ Layer 4 — Runtime monitoring                                 │  detect-and-kill
   │   • wall-clock timer  + cgroup memory watcher                │
   │   • syscall-trace summary stored for audit                   │
   ├──────────────────────────────────────────────────────────────┤
   │ Layer 5 — (Optional, high-stakes) gVisor / Firecracker       │  separate kernel
   └──────────────────────────────────────────────────────────────┘
```

Each layer protects against a specific attack:

| Attack                          | Stopped by                              |
|---------------------------------|-----------------------------------------|
| Fork bomb (`while True: fork()`)| cgroup `pids` limit (64)                |
| Memory bomb (`x = [0]*1e9`)     | cgroup `memory.max`                     |
| Infinite loop                   | wall-clock + CPU timer → `SIGKILL`      |
| Reading `/etc/shadow`           | read-only FS + non-root user            |
| Writing huge file               | tmpfs size cap + `RLIMIT_FSIZE`         |
| Network exfiltration            | `--network none`                        |
| Privilege escalation (setuid)   | `no-new-privileges` + capability drop   |
| Loading kernel modules          | dropped `CAP_SYS_MODULE`                |
| Spectre/sidechannel snooping    | gVisor / Firecracker tier               |

---

## 3.4 Efficiency Mechanisms

| Optimisation              | Saves                                       |
|---------------------------|---------------------------------------------|
| Warm Docker pool          | ~300 ms / submission                        |
| S3 code cache by hash     | Skip re-download for duplicate submissions  |
| Redis problem cache       | One Postgres query per problem fetch        |
| Per-language worker pools | Toolchain image stays in OS page cache      |
| Early-exit on WA/TLE      | Avoids running remaining tests              |
| Static linking (C++)      | No dynamic-linker overhead on every run     |
| Parallel test execution   | Optional; configurable per problem          |

The result is a **median end-to-end latency of ~1.2 s** for an
all-passing Python submission with 10 test cases, on commodity worker
hardware — well under the 5 s P95 target in NFR1.
