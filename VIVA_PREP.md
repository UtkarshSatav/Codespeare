# CodeSphere — Viva Preparation Guide

> One-stop revision sheet. Read Part 0 + Part 2 + Part 3 the night before;
> skim the rest. Everything here is grounded in *your* actual code and docs.

---

## PART 0 — The 60-Second Elevator Pitch (memorise this)

> "CodeSphere is a scalable, secure online judge like LeetCode/HackerRank. A user
> writes code in the browser, submits it, and gets a verdict (Accepted, Wrong
> Answer, etc.). The core problem is that **every request is untrusted, attacker-
> supplied code**, and we must run millions of them per day without one bad
> submission harming the platform or another user.
>
> My design solves this with a **producer → durable queue → consumer pipeline**.
> The API returns immediately (`202 Accepted`) and pushes the job onto a
> **per-language Kafka queue**. **Stateless Docker sandbox workers** pick up the
> job, run the code under **cgroups + seccomp + no network**, compare output to
> hidden test cases, and emit a verdict that's pushed back to the user over
> WebSocket. **PostgreSQL** is the system of record, **S3** holds code blobs,
> **Redis** holds leaderboards and rate limits. It scales horizontally because
> workers are stateless and the queue absorbs bursts."

### Numbers to have ready
| Metric | Value |
|---|---|
| Latency target | P50 < 1.5 s, P95 < 5 s |
| Throughput | 10K submissions/min sustained, 50K burst |
| Availability | 99.95% (~21 min downtime/month) |
| Languages | Python, C++, Java, JS, Go |
| Default limits | CPU 2 s, RAM 256 MB, 64 PIDs, 64 FDs |
| Rate limit | 12 submissions/min/user |
| Source cap | 64 KB |
| Warm pool | 8 containers/pod → cold start 400 ms → 30 ms |
| Verdict taxonomy | AC, WA, TLE, MLE, RE, CE, SE |

### The one sentence that wins the viva
> "Every architectural decision traces back to a single fact: **the workload is
> hostile** — so isolation, resource fairness, and decoupling bursty load from
> finite execution capacity dominate the design."

---

## PART 1 — One-Paragraph Answer Per Question

**Q1 (Requirements).** Functional = *what it does*: user mgmt, problem catalogue,
multi-language submission, server-side compilation, sandboxed execution, test-case
validation, verdict generation, submission history, real-time result streaming,
leaderboards, contests, admin tools. Non-functional = *how well*: low latency,
horizontal scalability, high throughput, **strong isolation**, availability, fault
tolerance, **resource fairness**, security/auditability, maintainability, cost,
observability, determinism. The three that dominate everything: **sandboxing,
strong isolation, resource fairness** — all forced by the hostile workload.

**Q2 (Architecture).** Client → CDN → Load Balancer → API Gateway (auth + rate
limit) → Submission Service (validate, store code in S3, insert QUEUED row, publish
to Kafka) → returns `202`. **The synchronous HTTP boundary ends at the queue.**
Per-language Kafka topics → stateless Docker sandbox workers → Result Service →
writes verdict to Postgres, updates Redis leaderboard, pushes over WebSocket.

**Q3 (Execution flow).** Lifecycle: `QUEUED → COMPILING → RUNNING → JUDGED`.
Worker fetches code from S3, boots a locked-down Docker container, compiles (CE if
fails), runs each test case under CPU/wall/memory limits, compares output with the
right checker mode, **early-exits on first failure**, publishes verdict, and
**acks the queue message only after the verdict is written** (so nothing is lost
on crash). Security is **defense-in-depth**: auth → container → cgroups/seccomp →
no network → runtime monitoring → optional gVisor.

**Q4 (Database).** **Polyglot persistence**: PostgreSQL is the system of record
(users, problems, test_cases, submissions, submission_results, contests); S3 holds
large blobs (code, stdout, test I/O) referenced by `*_s3_key`; Redis holds rate
limits + leaderboards (sorted sets); Kafka is the replayable audit log;
Elasticsearch for problem search. Submissions table is **range-partitioned by
month** and shard-friendly by `user_id`.

**Q5 (Implementation).** A single-process Python simulation mirroring the real
pipeline 1-to-1: `api_gateway → submission_service → queue.Queue → sandbox_worker
→ code_executor → test_validator`. The executor uses `subprocess` +
`resource.setrlimit` (Docker stand-in); the validator supports exact/trimmed/
numeric_eps/custom_checker. `demo.py` proves all 6 verdicts.

**Q6 (Scalability).** Stateless components scale horizontally via K8s HPA driven by
**Kafka consumer lag**. Per-language queues kill head-of-line blocking. Fault
tolerance rests on one invariant: **ack only after verdict is written** → at-least-
once delivery + idempotent verdict upsert = zero lost submissions. Multi-AZ,
read replicas, warm pools, DLQ, backpressure/load-shedding for free-tier users.

---

## PART 2 — Design Decisions (the "Why X not Y?" table examiners love)

| Decision | Rejected alternative | Why mine wins |
|---|---|---|
| **Async queue** between API & workers | Synchronous gRPC call to a worker | Execution takes 1–5 s; sync would pin API threads and collapse under burst. Queue absorbs spikes. |
| **Per-language Kafka topics** | One shared queue | A 30 s C++ compile would block fast Python jobs (head-of-line blocking). Per-language pools are image-cached & right-sized. |
| **Docker + seccomp + cgroups** | `chroot` / bare `os.fork()` | Process-level isolation is trivially escaped by untrusted code. Need kernel-level limits. |
| **Postgres + S3 split** | Store `code TEXT` in Postgres | 64 KB × millions of rows bloats indexes & TOAST. S3 is cheap, durable, keeps rows tiny. |
| **Redis ZSET for leaderboard** | SQL `ORDER BY rating LIMIT` | O(log N) update + sub-ms read vs. an expensive sort on every read. |
| **WebSocket push** | HTTP long-poll | Lower latency, fewer connections, native browser support. |
| **Stateless workers** | Stateful per-user workers | Any worker can crash/scale/reschedule without data loss. |
| **Ack after verdict write** | Ack on message receipt | Guarantees a crash re-runs the job instead of silently dropping a user's code. |
| **Early-exit on first failed test** | Run all tests always | Saves worker time; most submissions fail fast. (Contest mode can override for partial credit.) |
| **Range-partition submissions by month** | One giant table | Old partitions detach to cold storage; time-bounded queries hit one partition. |

---

## PART 3 — Anticipated Viva Questions + Crisp Answers

### Security (most likely focus — the whole point of the platform)

**Q: How do you stop a fork bomb (`while True: os.fork()`)?**
cgroup `pids-limit=64` (and `RLIMIT_NPROC` in the demo). The 65th process fails to
spawn; the container can't exhaust host PIDs.

**Q: How do you stop a memory bomb (`x = [0]*10**9`)?**
cgroup `--memory 256m`; the kernel OOM-kills the container → we emit **MLE**. In the
demo, `RLIMIT_AS` + post-hoc peak-RSS check.

**Q: How do you stop an infinite loop?**
Two timers: `RLIMIT_CPU` (CPU seconds) fires SIGXCPU/SIGKILL, **plus** an external
**wall-clock** timer (~2× CPU limit) to catch `sleep`/I/O-wait loops. Either → **TLE**.

**Q: Why wall-clock AND cpu limit — isn't one enough?**
No. CPU limit doesn't count time spent sleeping or blocked on I/O. A `time.sleep(999)`
burns ~0 CPU but hangs the worker. Wall-clock catches it.

**Q: How do you stop network exfiltration / crypto-mining callbacks?**
`docker run --network none` — no loopback, no DNS, no interface at all. Plus network
policies restrict pods to only reach Kafka/S3/Postgres.

**Q: How do you stop reading `/etc/shadow` or writing host files?**
`--read-only` root FS + run as `--user 65534:65534` (nobody) + only writable path is a
bounded `tmpfs /tmp` (64 MB). `RLIMIT_FSIZE` caps file size at 4 MB.

**Q: What's seccomp doing here?**
A syscall whitelist (`seccomp=judge.json`) blocks dangerous syscalls — `ptrace`,
`mount`, `unshare`, `keyctl`, `bpf`, `userfaultfd` — so even a clever program can't
reach kernel attack surface. `--cap-drop ALL` + `--no-new-privileges` block setuid
escalation and capability abuse.

**Q: Docker shares the host kernel — what about a container escape / Spectre?**
Acknowledged limit. That's the **gVisor / Firecracker tier** (Layer 5): a user-space
or micro-VM kernel giving each execution its **own kernel boundary**. We reserve it
for high-stakes paid contests on dedicated node groups, so a blast radius is bounded
to one pool. (This is exactly what AWS Lambda does with Firecracker.)

**Q: Why not run user code as a normal process with setrlimit (like your demo)?**
The demo admits this: `setrlimit` is bypassable by sufficiently determined code (a raw
`syscall()` can lift the limit). It's enough to *demonstrate verdicts*, not to hold
real attackers. Production needs kernel-enforced cgroups + namespaces.

### Architecture & flow

**Q: Walk me through one submission end-to-end.**
POST → API Gateway authenticates JWT + checks Redis rate limit → Submission Service
validates (lang + ≤64 KB), uploads code to S3, inserts `submissions` row `QUEUED`,
publishes to `submit.<lang>` Kafka topic, returns `202 + submission_id`. Worker
consumes → `COMPILING` → fetch code/tests → boot sandbox → compile → run each test
under limits → first failure wins (early exit) → publish to `verdict.events` → **ack**
→ Result Service writes verdict + per-test rows, bumps Redis leaderboard, pushes
WebSocket frame → UI flips to ✅.

**Q: Why is the queue the most important component?**
It **decouples bursty incoming load from finite execution capacity**. Without it, a
contest spike (100× baseline in seconds) would back-pressure straight into the API and
take the whole site down. The queue is the shock absorber.

**Q: What happens if a worker dies mid-execution?**
The Kafka message was never acked (ack happens only after verdict write). K8s restarts
the pod; Kafka **redelivers** the message; a fresh worker re-runs from scratch. The
idempotent verdict upsert (keyed on `submission_id`) makes a duplicate delivery safe.
**Net: zero lost submissions.**

**Q: At-least-once delivery means a job can run twice. Is that a problem?**
Functionally no — execution is deterministic, and the verdict write is an **upsert on
`submission_id`**, so a re-run just overwrites with the same result. We accept "run
twice" to guarantee "never zero times."

**Q: Why partition Kafka per language instead of per user?**
Workers are heavy (gcc image ≈ 1 GB). Per-language lets each pool host exactly one
toolchain, stay image-cached, and be right-sized (many small Python pods vs. few large
JVM pods). It also prevents a slow C++ compile from blocking Python (head-of-line).

### Database

**Q: Why not store the code in the database?**
A 64 KB text column × millions of rows bloats Postgres indexes and TOAST storage,
slowing every query. We store a tiny `code_s3_key` pointer instead; the blob lives in
cheap, durable S3.

**Q: What's `code_hash` for?**
SHA-256 of the source. Two uses: **dedup** (don't re-judge identical resubmits within a
minute) and **plagiarism heuristics** (identical hashes across users).

**Q: Explain the partial index `WHERE status <> 'JUDGED'`.**
99% of rows are eventually `JUDGED`. The "find pending work" query only cares about the
tiny open set, so we index *only* non-final rows — a much smaller, faster index.

**Q: How does this scale past one Postgres?**
First read replicas (1 primary + 3 async; reads → replicas, verdict writes → primary).
Then range-partition `submissions` by month. Then shard by `user_id` hash — the schema
is already shard-friendly because queries are scoped to one user or one problem.

**Q: Why Postgres and not pure NoSQL?**
Verdicts need **ACID** (a contest result is academically/financially meaningful) and we
need **joins** for leaderboards and history. NoSQL is used where it fits — Redis for
sorted leaderboards, S3 for blobs, Kafka for the log. That's **polyglot persistence**:
right tool per access pattern.

### Implementation / code

**Q: How does your validator handle floating-point answers?**
`numeric_eps` mode: tokenize both sides, compare each numeric token with
`math.isclose(rel_tol, abs_tol=eps)`. So `3.14159265` vs `3.141592` passes within ε.
Non-numeric tokens fall back to exact compare. (Stops false WAs on valid float output.)

**Q: What are the four checker modes and when do you use each?**
`exact` (byte-for-byte), `trimmed` (default — ignores trailing whitespace/CRLF),
`numeric_eps` (float problems), `custom_checker` (multiple valid outputs, e.g. "any
valid topological order" — runs a problem-supplied judge binary).

**Q: In the demo, how do you tell TLE apart from RE? Both get killed.**
In `code_executor.py`: if the kill signal is SIGKILL/SIGXCPU **and** runtime ≥ 90% of
the CPU limit, it's **TLE**; a non-zero exit with no timeout/OOM is **RE**; SIGKILL near
the memory cap is **MLE**. The signal + timing + memory together disambiguate.

**Q: Why `start_new_session=True` / process groups?**
So the child gets its own process group. If user code forks, one `os.killpg` SIGKILLs
the **entire** group cleanly — no orphaned runaway children.

**Q: Your demo isn't really secure — why submit it?**
It's a **faithful control-flow simulation**, not a production sandbox. Every component
maps 1-to-1 to production (queue.Queue↔Kafka, subprocess+rlimit↔Docker, dict↔Postgres).
It runs on any laptop with no Docker, and proves all 6 verdicts. The doc is explicit
about which guarantees are weakened for portability.

### Scalability & ops

**Q: How exactly does autoscaling trigger?**
K8s HPA scales the worker Deployment on **Kafka consumer-group lag** (external metric),
target ≤ 20 msgs lag/pod, min 10 / max 1000 replicas. Contest load → lag climbs → pods
scale up in ~30 s (warm node pool via Karpenter/Cluster Autoscaler + pre-pulled images).

**Q: What's the warm pool and why?**
Each worker pod keeps ~8 paused Docker containers ready. We `docker exec` into one
instead of `docker run` — cold start drops from ~400 ms to ~30 ms. Critical because
that's per-submission overhead at millions/day.

**Q: What is a dead-letter queue here?**
If a message fails 3×, it goes to `submit.dlq` for human inspection (usually a worker
bug, not user code). Stops a poison message from looping forever.

**Q: How do you shed load when overwhelmed?**
Two levers: per-user Redis token bucket (12/min hard cap), and if aggregate Kafka lag
stays too high, the gateway returns `503` to **anonymous/free** users while paid users
continue. Graceful degradation instead of total collapse.

**Q: Little's law — justify your worker count.**
Concurrency = arrival rate × service time = 500 req/s × 2 s ≈ **1000 concurrent
executions**. At 4 slots/pod → 250 pods minimum, ×2 headroom → ~500. That's where HPA
max ≈ 500–1000 comes from.

**Q: How do you guarantee a new sandbox image doesn't silently break judging?**
**Blue/green with a 1% traffic mirror** — the new executor image judges 1% of traffic in
parallel; we only promote it if its verdict distribution matches the current image.
Catches checker/regression bugs before they hit users.

---

## PART 4 — Whiteboard Diagrams (be ready to draw these)

**1. The pipeline (draw this first, it answers half the questions):**
```
Client → API Gateway → Submission Service → Kafka(per-lang) → Worker(Docker) → Result Service → DB/Redis/WS → Client
            (auth,         (S3 + Postgres        ▲                  │
          rate-limit)       + 202)          durable, x3       ack AFTER verdict write
```

**2. The 6 security layers (draw as a stack):**
```
0 Auth + rate-limit + 64KB cap
1 Container: read-only FS, non-root, tmpfs
2 Kernel: cgroups(cpu/mem/pids) + seccomp + cap-drop + no-new-privs
3 Network: --network none
4 Runtime: wall-clock + memory watcher → SIGKILL
5 (optional) gVisor / Firecracker = separate kernel
```

**3. Submission state machine:**
```
QUEUED → COMPILING → RUNNING → JUDGED
              ↓          ↓
             CE     TLE/MLE/RE/SE
```

---

## PART 5 — Likely "Gotcha" Questions (and honest answers)

**"What's the biggest weakness of your design?"**
Docker shares the host kernel — a kernel-level container escape would be catastrophic.
Mitigation is the gVisor/Firecracker tier, but that has higher startup cost, so it's a
deliberate security-vs-latency trade-off I apply selectively (paid contests), not
everywhere.

**"What would you add with more time?"**
(1) Plagiarism-detection ML pipeline (currently out-of-scope). (2) Custom-checker
execution (stubbed in the demo). (3) gVisor everywhere once startup cost is optimised.
(4) Multi-region active-active Postgres (currently active-passive).

**"How is this different from just running Judge0?"**
Judge0 is a single-node executor API. My contribution is the **distributed system
around it**: per-language queues, autoscaling stateless workers, the ack-after-verdict
fault-tolerance invariant, polyglot persistence, and the scaling/HA story for millions
of requests/day.

**"Why these specific limits (2 s, 256 MB)?"**
They're configurable **per problem** (`time_limit_ms`, `memory_limit_mb` columns with
CHECK constraints 100–30000 ms, 16–1024 MB). 2 s / 256 MB are sane defaults matching
Codeforces/LeetCode norms; a hard DP problem can raise them.

**"Determinism — how do you guarantee identical code gives identical verdict?"**
Limits are applied **per test case**, not globally; the toolchain is pinned in the
Docker image; tests run in `seq` order; checker mode is fixed per problem. Same inputs
→ same verdict on every retry (NFR12) — essential for contest integrity.

---

## PART 6 — Technologies Used (Tech Stack)

The single most important framing for any "which technology / why" question:
**there are two layers — what I *built and ran* (the demo), and what I *designed*
for production (the docs).** State which one you mean. The demo deliberately
substitutes a laptop-runnable equivalent for each heavy production component.

### 6.1 What I actually built & ran (the working code)

| Layer | Technology | Where / why |
|-------|-----------|-------------|
| **Web framework** | **Next.js 14** (Pages Router) + **React 18** | `web/` — SSR/SSG pages + built-in API routes (`/api/judge`, `/api/run`) in one app |
| **Language (frontend)** | **TypeScript 5** | Type-safe problem schema, components, data layer |
| **Styling** | **Tailwind CSS 3** | Utility-first; custom dark design tokens (`bg/panel/accent/…`) in `tailwind.config.ts` |
| **Code editor** | **Monaco Editor** (`@monaco-editor/react`) | The same editor that powers VS Code — syntax highlight, themes, font size |
| **Auth** | **Firebase Authentication** (email/password) | `lib/useAuth.tsx` — client-side, no custom auth server |
| **Database** | **Cloud Firestore** (NoSQL, real-time) | `lib/firestore-client.ts` — submissions, profiles, notes, likes, bookmarks, discussions; `onSnapshot` gives live verdict updates |
| **Security rules** | **Firestore Security Rules** | `web/firestore.rules` — owner-only writes; the only line of defence in the client-direct model |
| **Client persistence** | **localStorage** | `lib/codeStore.ts` — per-(problem, language) code autosave |
| **Judge / execution** | **Python 3** | `implementation/` — executor, validator, worker, one-shot `judge_single.py` |
| **Sandboxing (demo)** | `subprocess` + `resource.setrlimit` + `os.killpg` | CPU/memory/PID/file-size limits + wall-clock kill, all stdlib — runs with **no Docker** |
| **Queue (demo)** | `queue.Queue` / `multiprocessing.Queue` + `threading` | In-process producer→consumer mirroring Kafka semantics |
| **API ↔ judge bridge** | Next.js API route **spawns** `judge_single.py` (`child_process`) | Server-side so the browser can't see hidden tests or forge runtime/memory |
| **DB schema (designed)** | **PostgreSQL 14** DDL (`pgcrypto`, `pg_trgm`, range partitioning) | `database/schema.sql` — the system-of-record design |
| **Data tooling** | **Python generator** | Runs each reference solution to compute every test's expected output (guarantees AC for the solution, WA for the stub) |

### 6.2 What I designed for production (in the docs)

| Concern | Technology | Replaces (demo) |
|---------|-----------|-----------------|
| Durable queue | **Apache Kafka** (per-language topics, RF=3) / RabbitMQ | `queue.Queue` |
| Container sandbox | **Docker** + **seccomp-bpf** + **cgroups** + **nsjail** | `subprocess` + `rlimit` |
| Stronger isolation tier | **gVisor / Firecracker** microVMs | — (high-stakes only) |
| System of record | **PostgreSQL** (primary + read replicas, partitioned) | in-memory `dict` |
| Cache / rate-limit / leaderboard | **Redis** (token bucket + Sorted Sets) | — |
| Blob storage | **Amazon S3** (code + large stdout) | local `/tmp` files |
| Orchestration / autoscale | **Kubernetes** + **HPA** (on Kafka lag) + Karpenter | one process |
| Real-time verdict push | **WebSocket** hub | client polling / `onSnapshot` |
| Search | **Elasticsearch** (problem statements) | array `.filter` |
| Observability | **Prometheus + Grafana**, **OpenTelemetry**, **Loki** | `print`/logs |
| Edge | **CDN (CloudFront)** + **L7 load balancer (ALB/NGINX)** + **API Gateway (Kong)** | — |

### 6.3 Likely tech-stack viva questions

**Q: Why Next.js instead of plain React + Express?**
One framework gives me both the React UI **and** server-side API routes (`/api/judge`,
`/api/run`) in the same project — no separate backend to deploy. The API routes are where
the Python judge is spawned, kept server-side so hidden tests never reach the browser.

**Q: Why Firestore (NoSQL) in the app but PostgreSQL in the design?**
Pragmatism vs. correctness. For a runnable demo, Firestore gives me **auth + a real-time
database + security rules with zero backend code**, and `onSnapshot` makes live verdict
updates trivial. For production I argue **PostgreSQL** because verdicts need ACID and
leaderboards/history need joins — that's the polyglot-persistence point (right store per
access pattern; see Q4).

**Q: Why Monaco?**
It's the editor engine behind VS Code — multi-language syntax highlighting, themes, and
keyboard handling out of the box. Building that from scratch would be a project on its own.

**Q: Your demo sandbox is Python `setrlimit`, not Docker — isn't that insecure?**
Yes, and the docs say so explicitly. `setrlimit` is **bypassable** by determined code
(a raw `syscall` can lift the limit). It's enough to *demonstrate* the verdicts
(AC/WA/TLE/MLE/RE/CE) on any laptop; production swaps it for Docker + seccomp + cgroups,
which are **kernel-enforced**. This is the demo-vs-production substitution, not a design flaw.

**Q: Why TypeScript?**
The problem catalogue has a rich schema (test cases, solutions, complexity, company tags).
Static types catch shape mismatches at build time — `next build` type-checks every page,
which is how I verified the whole feature set compiles.

**Q: How is data correctness guaranteed across the stack?**
A Python generator runs each **reference solution** to produce every test's `expected`
output, then the **real judge** (`judge_single.py`) confirms the solution scores `AC` and
the starter stub scores `WA` — end-to-end, the same path the web app uses.

---

## PART 7 — Known Demo Limitations (say these *before* the examiner finds them)

> Volunteering these earns more marks than being caught out. The framing for
> **every** item is the same: *"that's a deliberate demo-vs-production
> substitution for portability, and the docs say so — here's the production
> answer."* Honesty + a designed fix = full marks.

| # | Limitation (what's true in the running app) | What I say / the production answer |
|---|----------------------------------------------|-------------------------------------|
| 1 | **Only Python 3 actually executes.** C++/Java/JS/Go are selectable but return `SE` ("UI only"). | The judge is language-pluggable; production gives each language its own Docker worker pool. Wiring one is "add an image + a config row" (NFR9). |
| 2 | **Sandbox is `subprocess` + `setrlimit`, not Docker.** It's bypassable by determined code. | Enough to demonstrate all 6 verdicts on any laptop with no Docker. Production = Docker + seccomp + cgroups (kernel-enforced). The 6-layer security model is in `docs/03`. |
| 3 | **Queue is in-process** (`queue.Queue`; the web API spawns `judge_single.py` directly). | 1-to-1 with Kafka producer/consumer semantics; only the transport differs. Production = durable, replicated Kafka per-language topics. |
| 4 | **No Postgres/Redis/S3 running.** The app uses **Firestore**; the Python demo uses an in-memory `dict` + local `/tmp`. | Polyglot-persistence design is in `docs/04` + `database/schema.sql`. Firestore was chosen for a zero-backend runnable demo. |
| 5 | **The client writes its own verdict back to Firestore.** | A known trust gap — the rules comment says so. Production routes verdict writes through a privileged Cloud Function / the Result Service, never the browser. |
| 6 | **Resource limits aren't reliably enforced on macOS** (`RLIMIT_AS`); MLE is detected post-hoc by peak RSS. | A real cgroup hard-kills before that point. The demo *translates* "exceeded" into MLE so the verdict still shows correctly. |
| 7 | **Test inputs are inlined and capped at moderate size** (≤ ~120 elements), not literal 10⁵. | Keeps the JS bundle small; coverage (edge/boundary/duplicate/negative) is what matters. Real platforms keep large hidden tests server-side. All `expected` values are still Python-verified. |
| 8 | **`custom_checker` mode is stubbed** (`NotImplementedError`). | Design is documented (spawn a problem-supplied judge binary); `exact`/`trimmed`/`numeric_eps` are fully implemented. |
| 9 | **`acceptance_rate` is a static seed**, not computed from live submissions; **rating is fixed at 1200** (no Elo updates). | Display/seed values for the demo; production recomputes from `submissions` and runs an Elo rating job. |
| 10 | **Single node — no real autoscaling / WebSocket push.** Live updates use Firestore `onSnapshot` (or polling). | Horizontal scaling, K8s HPA on Kafka lag, and the WebSocket hub are designed in `docs/06`, not deployed. |

**The one-liner that covers all of them:** *"Everything I couldn't run on a laptop,
I designed in the docs and substituted with a behaviourally-equivalent stand-in —
and I labelled every substitution."*

---

### Final tip
If you only memorise three things: (1) **"the workload is hostile"** is the root of
every decision; (2) **"the sync boundary ends at the queue"** explains the whole
architecture; (3) **"ack only after the verdict is written"** is the one invariant
behind all fault tolerance. Anchor every answer back to one of these three.
