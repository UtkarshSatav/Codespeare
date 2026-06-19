# Q2 — System Architecture Design

## 2.1 High-Level Architecture

CodeSphere is decomposed into independently scalable services connected by a
durable message queue. The crucial design principle is **the synchronous
HTTP boundary ends at the queue**; everything downstream is async.

```
                        ┌────────────────────────┐
                        │  Web / Mobile Client   │
                        │   (Monaco editor UI)   │
                        └───────────┬────────────┘
                                    │ HTTPS
                                    ▼
                        ┌────────────────────────┐
                        │   CDN  (CloudFront)    │   ─ static assets
                        └───────────┬────────────┘
                                    ▼
                        ┌────────────────────────┐
                        │ Global Load Balancer   │   ─ TLS terminate, GeoDNS
                        └───────────┬────────────┘
                                    ▼
                        ┌────────────────────────┐
                        │      API Gateway       │
                        │  (Kong / AWS API GW)   │   ─ AuthN, rate-limit, route
                        └───────┬────────┬───────┘
                                │        │
                       ┌────────┘        └────────┐
                       ▼                          ▼
              ┌────────────────┐         ┌────────────────┐
              │ Auth Service   │         │ Problem Service│
              │ (JWT issuer)   │         │ (CRUD problems)│
              └────────────────┘         └────────────────┘
                                                  │
                                                  ▼
                                ┌─────────────────────────────┐
                                │     Submission Service      │
                                │   (validate → store → push) │
                                └─────────────┬───────────────┘
                                              │
                  ┌───────────────────────────┼────────────────────────────┐
                  ▼                           ▼                            ▼
        ┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
        │ Postgres        │         │ S3              │         │ Kafka /         │
        │ (submissions    │         │ (code blobs,    │         │ RabbitMQ        │
        │  + verdicts)    │         │  large stdout)  │         │ per-language Q  │
        └─────────────────┘         └─────────────────┘         └────────┬────────┘
                                                                         │
                                              ┌──────────────────────────┼──────────────────────────┐
                                              ▼                          ▼                          ▼
                                    ┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
                                    │ Worker Pool —    │       │ Worker Pool —    │  ...  │ Worker Pool —    │
                                    │   Python         │       │   C++            │       │   Java           │
                                    │ (Docker + nsjail │       │ (Docker + nsjail │       │ (Docker + nsjail │
                                    │  + seccomp)      │       │  + seccomp)      │       │  + seccomp)      │
                                    └────────┬─────────┘       └────────┬─────────┘       └────────┬─────────┘
                                             │                          │                          │
                                             └──────────────────────────┼──────────────────────────┘
                                                                        ▼
                                                          ┌───────────────────────────┐
                                                          │      Result Service       │
                                                          │ (writes verdict, notifies)│
                                                          └─────────────┬─────────────┘
                                                                        │
                                                ┌───────────────────────┼──────────────────────┐
                                                ▼                       ▼                      ▼
                                       ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
                                       │  Postgres      │     │  Redis         │     │  WebSocket Hub │
                                       │  (verdicts)    │     │  (leaderboard, │     │  (push to user)│
                                       └────────────────┘     │   live status) │     └────────────────┘
                                                              └────────────────┘
```

---

## 2.2 Component Responsibilities

### 2.2.1 Web / Mobile Client
* Renders problem statement + Monaco code editor.
* POSTs code to `/api/v1/submissions`.
* Subscribes to `/ws/submission/{id}` for live verdict updates.

### 2.2.2 CDN
* Serves static assets (JS bundles, problem images) globally.
* Reduces origin load by ~80 % for static content.

### 2.2.3 Load Balancer
* L7 routing (ALB / NGINX) — TLS termination, sticky sessions for WebSocket.
* Geo-DNS for region-affine routing.

### 2.2.4 API Gateway
* Authentication (validates JWT issued by Auth Service).
* Per-user rate limiting (token bucket in Redis): e.g. 12 submissions / min.
* Request validation (schema, max body size).
* Forwards to the right downstream service.

### 2.2.5 Submission Service (the producer)
1. Verifies the user is allowed to submit (contest window, problem visibility).
2. Stores the raw code in **S3** at `s3://codesphere/code/{submission_id}`.
3. Inserts a `submissions` row with `status = 'QUEUED'`.
4. Publishes a Kafka message to topic `submit.<language>` with payload:
   ```json
   {
     "submission_id": 1834912,
     "user_id": 42,
     "problem_id": 7,
     "language": "python",
     "code_s3_key": "code/1834912",
     "time_limit_ms": 2000,
     "memory_limit_mb": 256
   }
   ```
5. Returns `202 Accepted` with the `submission_id`.

### 2.2.6 Execution Queue (Kafka topics, one per language)
* **Why per-language?** Workers are heavy (gcc image ≈ 1 GB). Mixing languages
  in one queue would force every worker to host every toolchain. Partitioning
  by language allows each pool to be image-cached and right-sized.
* **Durable**: messages persisted to disk; survive worker restarts.
* **At-least-once delivery** — workers ack only after verdict is written;
  combined with an idempotent verdict update keyed on `submission_id`.

### 2.2.7 Sandbox Workers (the consumers)
Each worker is a Kubernetes pod that:
1. Polls its language's Kafka partition.
2. Downloads code from S3.
3. Spins up a fresh Docker container with:
   * Network disabled (`--network none`).
   * Read-only root FS, writable `/tmp` of bounded size (tmpfs 64 MB).
   * `cap-drop=ALL`, `--security-opt seccomp=judge.json`.
   * `--memory 256m --cpus 1 --pids-limit 64`.
   * `--user 65534:65534` (nobody).
4. Compiles (if needed), then runs once per test case via `subprocess.run`
   with `timeout` and `resource.setrlimit`.
5. Publishes verdict to topic `verdict.events`.
6. Acks the original message **only after** verdict is published.

A **warm pool** of 5-10 pre-created containers per worker keeps cold-start at
~50 ms instead of 300-500 ms.

### 2.2.8 Result Service
* Subscribes to `verdict.events`.
* Upserts the final verdict into `submissions` and per-test rows into
  `submission_results`.
* Pushes a message into the WebSocket hub for the owning user.
* Updates Redis-backed leaderboards and live problem stats.

### 2.2.9 Databases — see `docs/04_database_design.md`
* **PostgreSQL** — users, problems, test cases, submissions, verdicts.
* **S3** — code blobs and large output dumps.
* **Redis** — rate-limit counters, JWT denylist, leaderboards (Sorted Sets),
  problem metadata cache.
* **Kafka** — execution queue and verdict event stream (replayable audit log).

---

## 2.3 Component Interaction Sequence (happy path)

```
Client  ──► API Gateway ──► Submission Service ──► [Postgres + S3 + Kafka]
                                                          │
                                                          ▼
                                              Kafka topic: submit.python
                                                          │
                                                          ▼
                                              Python Worker pod
                                                          │
                                                          ▼
                                              Docker sandbox runs code
                                                          │
                                                          ▼
                                              Kafka topic: verdict.events
                                                          │
                                                          ▼
                                              Result Service ──► Postgres
                                                                ──► Redis (leaderboard)
                                                                ──► WS Hub ──► Client
```

End-to-end this is **fire-and-forget from the client's perspective**: the
HTTP request returns in ~50 ms; the verdict arrives over WebSocket within
seconds.

---

## 2.4 Why This Topology?

| Decision                              | Alternative considered     | Why we picked this                              |
|---------------------------------------|-----------------------------|------------------------------------------------|
| Async queue between API and workers   | Synchronous gRPC to workers | Sync would block API threads for seconds, killing throughput |
| Per-language Kafka topics             | Single shared queue         | Lets each pool be image-specialized, avoids head-of-line blocking |
| Docker + seccomp (not bare process)   | `chroot`, `os.fork()`       | Untrusted code escapes process-level isolation trivially |
| Postgres + S3 split                   | Everything in Postgres      | Storing 64 KB code rows × millions in Postgres explodes index size |
| Redis for leaderboards                | SQL `ORDER BY rating LIMIT` | Sorted sets give O(log N) updates, sub-ms read |
| WebSocket push                        | Long-poll                   | Lower latency, fewer connections, native browser support |
| Stateless workers                     | Stateful per-user workers   | Trivial horizontal scale + crash-safety        |

The architecture is deliberately a textbook **producer / queue / consumer
pipeline** because that pattern is the only one that gracefully decouples
bursty incoming load from finite execution capacity — exactly the dominant
constraint for a code-judge platform.
