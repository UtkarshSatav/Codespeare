# Q1 — Requirements Analysis

Before architecting the system, we explicitly enumerate **what CodeSphere must
do** (functional requirements) and **how well it must do it** (non-functional
requirements). Each requirement is paired with a justification — i.e. the
real-world failure mode it prevents.

---

## 1.1 Functional Requirements (FR)

| # | Requirement | Description | Justification |
|---|-------------|-------------|---------------|
| FR1 | **User Management** | Sign-up, login (OAuth + email), profile, password reset, role-based access (user / problem-setter / admin) | Every submission must be attributable; abuse mitigation requires identity |
| FR2 | **Problem Catalogue** | CRUD on problems: title, statement, constraints, difficulty, sample I/O, hidden test cases, editorial | The "library" the platform sells; without curated problems, there is no product |
| FR3 | **Multi-Language Code Submission** | Accept code in Python, C/C++, Java, JS, Go (extensible). Validate size (≤ 64 KB) and language | Coding interviews and contests require polyglot support |
| FR4 | **Server-Side Compilation** | Compile compiled languages inside the sandbox; surface compile errors with line numbers | Client-side compile is impossible to trust; uniform toolchain ensures reproducibility |
| FR5 | **Sandboxed Execution** | Run user binary against every test case under strict CPU, memory, time, FD, PID, network limits | Untrusted code WILL try `fork()` bombs, file reads, network calls, crypto-mining |
| FR6 | **Test Case Validation** | Compare actual stdout to expected, supporting exact / trimmed / numeric-tolerance / custom-checker modes | Floating-point and multi-valid-output problems break naive string-compare |
| FR7 | **Verdict Generation** | Produce one of: `AC`, `WA`, `TLE`, `MLE`, `RE`, `CE`, `SE` per submission, plus per-test-case runtime / memory | Same vocabulary as Codeforces / LeetCode — interviewers expect it |
| FR8 | **Submission History** | Persist every submission with code, language, verdict, runtime, memory; queryable by user and problem | Users review past attempts; admins audit suspected cheating |
| FR9 | **Result Streaming / Notification** | Push real-time progress (queued → running → test 3/10 → verdict) to the client | A 30-second blind wait kills UX; live progress is table-stakes |
| FR10 | **Leaderboard & Ranking** | Per-problem, per-contest, and global Elo-style rating | Drives engagement and retention |
| FR11 | **Contest Mode** | Time-boxed problem sets with frozen scoreboards | Required for use cases like ICPC / mock interviews |
| FR12 | **Admin & Moderation Tools** | Disable submissions, mark malicious users, view system metrics | Operational safety net |

---

## 1.2 Non-Functional Requirements (NFR)

| # | Requirement | Target Metric | Justification |
|---|-------------|---------------|---------------|
| NFR1 | **Low Latency** | P50 verdict < 1.5 s, P95 < 5 s (sample tests) | Interview environments need instant feedback; > 5 s feels broken |
| NFR2 | **Horizontal Scalability** | Linear scaling from 100 → 10 000 worker pods | Contest spikes can be 100× the baseline within seconds |
| NFR3 | **High Throughput** | 10 000 submissions/min sustained, 50 000/min burst | Combined load of an ongoing contest + regular users |
| NFR4 | **Strong Isolation** | Zero cross-tenant data leakage; kernel-level sandbox | A single sandbox escape would compromise the whole platform |
| NFR5 | **Availability** | 99.95 % monthly uptime (≈ 21 min/month allowed downtime) | Contests are time-bound: an outage during a contest destroys trust |
| NFR6 | **Fault Tolerance** | Worker / queue / DB node loss must not lose a single submission | Submissions are legally / academically meaningful for users |
| NFR7 | **Resource Fairness** | Per-user rate limits (e.g., 1 submission / 5 s) and per-execution budget (CPU 2 s, RAM 256 MB default) | Prevents one user starving others; caps blast radius of bad code |
| NFR8 | **Security & Auditability** | Every execution is logged with code hash, container ID, syscall trace summary | Compliance, incident response, anti-cheat |
| NFR9 | **Maintainability** | New language pluggable by adding one Docker image + config row | Languages change; build cycle to add Rust should be hours, not weeks |
| NFR10 | **Cost Efficiency** | Idle worker pool ≤ 10 % of peak capacity (autoscaling) | Workers are the dominant cost; idle CPU is wasted spend |
| NFR11 | **Observability** | Tracing across API → queue → worker → DB; SLO dashboards per language | You can't operate what you can't see |
| NFR12 | **Determinism** | Identical code + tests → identical verdict across retries | Required for contest integrity and customer trust |

---

## 1.3 Out-of-Scope (deliberate, for the case study)

* IDE features (autocomplete, debugger) — handled client-side via Monaco editor
* Plagiarism detection ML pipeline — separate offline system
* Payment / subscription billing
* Mobile-app-specific concerns

Explicitly listing these prevents scope creep in the design.

---

## 1.4 Why this Set of Requirements?

The unique attribute of CodeSphere — distinguishing it from a generic SaaS — is
the **hostile workload**: every request *is* untrusted, attacker-supplied code.
This single fact forces three requirements that dominate the design:

1. **FR5 (Sandboxing)** is non-negotiable. A weaker isolation primitive
   (e.g. `chroot`) would have been disqualified.
2. **NFR4 (Strong Isolation)** dictates the choice of container + seccomp +
   gVisor over bare processes.
3. **NFR7 (Resource Fairness)** is the load-shedding mechanism that keeps the
   platform usable when one bad submission tries to consume infinite CPU.

Every architectural decision in `docs/02_system_architecture.md` traces back to
one of the requirements above.
