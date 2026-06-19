# CodeSphere — Online Code Execution Platform

**System Design Case Study — SEM-4 (S-2)**

A scalable, secure, multi-language code execution platform modeled on LeetCode / HackerRank.
This repository contains the full case-study deliverable: requirements analysis,
architecture design, database schema, working Python implementation, and a
scalability + fault-tolerance plan.

---

## 1. Problem at a Glance

CodeSphere must execute **millions of untrusted code submissions per day** across
many languages while guaranteeing:

| Requirement   | Target                                     |
|---------------|--------------------------------------------|
| Latency       | Verdict on sample tests < 3 s (P95)        |
| Throughput    | 10K submissions/minute sustained at peak   |
| Security      | Hard isolation between executions          |
| Availability  | 99.95 % monthly uptime                     |
| Languages     | Python, C++, Java, JavaScript, Go (initial)|
| Concurrency   | 1K+ parallel sandboxed executions          |

---

## 2. Repository Layout

```
CodeSphere/
├── README.md                      ← you are here (project index + summary)
├── docs/
│   ├── 01_requirements_analysis.md
│   ├── 02_system_architecture.md
│   ├── 03_execution_flow.md
│   ├── 04_database_design.md
│   ├── 05_implementation_logic.md
│   ├── 06_scalability_fault_tolerance.md
│   └── architecture_diagrams.md
├── implementation/
│   ├── code_executor.py           ← sandboxed runner with resource limits
│   ├── test_validator.py          ← test-case comparison engine
│   ├── sandbox_worker.py          ← queue consumer + verdict producer
│   ├── submission_service.py      ← API-facing producer
│   ├── api_gateway.py             ← Flask-style REST entrypoint
│   ├── demo.py                    ← end-to-end CLI demo (6 verdicts)
│   └── judge_single.py            ← one-shot CLI judge used by web app
├── web/                           ← Next.js 14 + TypeScript + Tailwind
│   ├── pages/                     ← problem list, editor, submissions, API
│   ├── components/                ← Layout, VerdictBadge
│   ├── lib/                       ← problems, in-memory store, judge bridge
│   └── README.md                  ← how to run the web app
├── database/
│   ├── schema.sql                 ← PostgreSQL DDL for all tables
│   └── sample_data.sql            ← seed data for users/problems/tests
└── requirements.txt
```

---

## 3. Mapping to the Case-Study Questions

| Question                                       | File                                              |
|-----------------------------------------------|---------------------------------------------------|
| Q1. Requirements Analysis                      | `docs/01_requirements_analysis.md`                |
| Q2. System Architecture Design                 | `docs/02_system_architecture.md`                  |
| Q3. Code Compilation and Execution Flow        | `docs/03_execution_flow.md`                       |
| Q4. Database Design                            | `docs/04_database_design.md` + `database/*.sql`   |
| Q5. Algorithm and Implementation               | `docs/05_implementation_logic.md` + `implementation/*` |
| Q6. Scalability and Fault Tolerance            | `docs/06_scalability_fault_tolerance.md`          |

---

## 4. Architectural Summary

```
                          ┌──────────────────────┐
   Web / Mobile Client ──►│  CDN + Load Balancer │
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐
                          │     API Gateway      │── Auth / Rate-limit
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐      ┌─────────────────┐
                          │ Submission Service   │─────►│ Postgres (meta) │
                          └──────────┬───────────┘      └─────────────────┘
                                     ▼                  ┌─────────────────┐
                          ┌──────────────────────┐      │ S3 (code blobs) │
                          │ Kafka / RabbitMQ     │      └─────────────────┘
                          │  (per-language queue)│
                          └──────────┬───────────┘
                                     ▼
                ┌───────────┬────────┴───────┬───────────┐
                ▼           ▼                ▼           ▼
            ┌───────┐   ┌───────┐        ┌───────┐   ┌───────┐
            │Worker │   │Worker │  ...   │Worker │   │Worker │   (Docker
            │ (py)  │   │ (cpp) │        │ (java)│   │ (js)  │    sandboxes)
            └───┬───┘   └───┬───┘        └───┬───┘   └───┬───┘
                └───────────┴────────┬───────┴───────────┘
                                     ▼
                          ┌──────────────────────┐
                          │   Result Service     │── WebSocket push
                          └──────────┬───────────┘
                                     ▼
                          ┌──────────────────────┐
                          │ Postgres + Redis     │
                          │  (verdicts/leaders)  │
                          └──────────────────────┘
```

See `docs/architecture_diagrams.md` for a more detailed diagram.

---

## 5. How to Run

### 5a. CLI demo (Python only — no Node required)

```bash
cd implementation
python3 demo.py
```

Walks through six submissions exercising every verdict in the production
taxonomy: **AC / WA / TLE / MLE / RE / CE**.

### 5b. Web platform (LeetCode-style UI)

```bash
cd web
npm install
npm run dev      # → http://localhost:3000  (or 3001 if 3000 is taken)
```

Then open the URL, pick a problem, edit code in the Monaco editor, and hit
**submit**. The Next.js API route validates the request, persists a
`QUEUED` submission, and spawns the Python judge as a subprocess; the
client polls for the verdict every 300 ms. This mirrors the production
async architecture (`POST /api/submissions` returns `202 + submission_id`,
verdict is fetched separately) one-to-one — only the queue (in-memory vs.
Kafka) and the sandbox (subprocess vs. Docker) are substituted for
portability.

---

## 6. Justification Highlights

* **Async submission queue** — execution latency (~1-5 s) is far longer than an
  HTTP request budget; sync would collapse under burst load.
* **Per-language queues** — toolchain images are big (gcc ≈ 1 GB); partitioning
  lets each worker pool be specialized and image-cached.
* **Docker + seccomp + cgroups** — practical sweet-spot between security and
  startup time. gVisor / Firecracker upgrade path documented for high-risk
  workloads (paid contests).
* **PostgreSQL for metadata, S3 for blobs** — ACID guarantees for verdicts,
  cheap storage for arbitrarily-large code / outputs.
* **Stateless workers** — any worker can crash without losing data; message ack
  happens only after a verdict is written.

Detailed justification is inline in each `docs/0X_*.md`.

---

## 7. Real-World Inspirations

| Platform     | Pattern reused                                          |
|--------------|----------------------------------------------------------|
| LeetCode     | Async submission + WebSocket verdict push               |
| HackerRank   | Per-language Docker workers, hidden test cases          |
| Codeforces   | Strict time + memory budgets, partial credit per case   |
| AWS Lambda   | Warm pool + Firecracker microVMs for cold-start mitigation |
| Judge0       | Open-source reference for the executor API surface      |
# Codespeare
