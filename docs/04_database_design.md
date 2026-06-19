# Q4 — Database Design

## 4.1 Polyglot Persistence — Why More Than One Store?

CodeSphere's data has **wildly different access patterns**, so we use the
right tool per workload instead of forcing everything into one database.

| Data                                       | Store        | Reason                                                |
|--------------------------------------------|--------------|-------------------------------------------------------|
| Users, problems, submissions, verdicts     | **PostgreSQL** | Strong ACID; joins for leaderboards & history       |
| Test-case I/O blobs, source code, large stdout | **S3** | Cheap, durable, can store MBs cheaply                 |
| Rate-limit counters, sessions, cache       | **Redis**    | Sub-ms latency, TTL semantics                         |
| Live leaderboards (sorted by rating/score) | **Redis ZSET** | O(log N) updates, O(log N + M) range read           |
| Submission stream / audit log              | **Kafka**    | Replayable, infinite retention to S3 sink             |
| Full-text problem search                   | **Elasticsearch** | Tokenized search across problem statements       |

The **system of record** is PostgreSQL; everything else is derived.

---

## 4.2 PostgreSQL Schema (see `database/schema.sql` for full DDL)

### 4.2.1 Tables

```
┌──────────┐        ┌──────────────┐        ┌─────────────────┐
│  users   │◄──────►│ submissions  │◄──────►│submission_results│
└──────────┘        └──────┬───────┘        └────────┬────────┘
      ▲                    │                         │
      │                    ▼                         ▼
      │             ┌──────────────┐         ┌──────────────┐
      └─────────────│  problems    │─────────│ test_cases   │
                    └──────────────┘         └──────────────┘
                            ▲
                            │
                    ┌──────────────┐
                    │  languages   │
                    └──────────────┘
```

### 4.2.2 Core Tables (abbreviated; complete in `database/schema.sql`)

```sql
-- USERS ---------------------------------------------------------------
CREATE TABLE users (
    user_id        BIGSERIAL PRIMARY KEY,
    username       VARCHAR(50)   UNIQUE NOT NULL,
    email          VARCHAR(255)  UNIQUE NOT NULL,
    password_hash  VARCHAR(255)  NOT NULL,
    role           VARCHAR(20)   NOT NULL DEFAULT 'user',
    rating         INT           NOT NULL DEFAULT 1200,
    is_banned      BOOLEAN       NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- LANGUAGES (lookup) -------------------------------------------------
CREATE TABLE languages (
    language_code   VARCHAR(20) PRIMARY KEY,           -- 'python3','cpp17',...
    display_name    VARCHAR(50) NOT NULL,
    docker_image    VARCHAR(255) NOT NULL,
    compile_cmd     TEXT,                              -- NULL = interpreted
    run_cmd         TEXT NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- PROBLEMS -----------------------------------------------------------
CREATE TABLE problems (
    problem_id        BIGSERIAL PRIMARY KEY,
    slug              VARCHAR(120) UNIQUE NOT NULL,
    title             VARCHAR(255) NOT NULL,
    description_md    TEXT         NOT NULL,
    difficulty        VARCHAR(10)  NOT NULL,           -- Easy / Medium / Hard
    time_limit_ms     INT          NOT NULL DEFAULT 2000,
    memory_limit_mb   INT          NOT NULL DEFAULT 256,
    checker_type      VARCHAR(20)  NOT NULL DEFAULT 'exact',
    created_by        BIGINT REFERENCES users(user_id),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    is_public         BOOLEAN      NOT NULL DEFAULT TRUE
);

-- TEST CASES ---------------------------------------------------------
CREATE TABLE test_cases (
    test_case_id   BIGSERIAL PRIMARY KEY,
    problem_id     BIGINT NOT NULL REFERENCES problems(problem_id) ON DELETE CASCADE,
    seq            INT    NOT NULL,                   -- ordering
    input_s3_key   VARCHAR(255) NOT NULL,             -- S3 pointer (avoid bloat)
    expected_s3_key VARCHAR(255) NOT NULL,
    is_sample      BOOLEAN NOT NULL DEFAULT FALSE,
    weight         INT     NOT NULL DEFAULT 1,
    UNIQUE (problem_id, seq)
);

-- SUBMISSIONS --------------------------------------------------------
CREATE TABLE submissions (
    submission_id   BIGSERIAL PRIMARY KEY,
    user_id         BIGINT  NOT NULL REFERENCES users(user_id),
    problem_id      BIGINT  NOT NULL REFERENCES problems(problem_id),
    language_code   VARCHAR(20) NOT NULL REFERENCES languages(language_code),
    code_s3_key     VARCHAR(255) NOT NULL,
    code_hash       CHAR(64)    NOT NULL,             -- SHA-256, dedupe key
    status          VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
    verdict         VARCHAR(20),                      -- final verdict
    runtime_ms      INT,
    memory_kb       INT,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    judged_at       TIMESTAMPTZ
);

CREATE INDEX idx_sub_user_date ON submissions (user_id, submitted_at DESC);
CREATE INDEX idx_sub_problem  ON submissions (problem_id, verdict);
CREATE INDEX idx_sub_status   ON submissions (status) WHERE status <> 'JUDGED';

-- PER-TEST RESULTS ---------------------------------------------------
CREATE TABLE submission_results (
    result_id       BIGSERIAL PRIMARY KEY,
    submission_id   BIGINT NOT NULL REFERENCES submissions(submission_id) ON DELETE CASCADE,
    test_case_id    BIGINT NOT NULL REFERENCES test_cases(test_case_id),
    verdict         VARCHAR(20) NOT NULL,
    runtime_ms      INT,
    memory_kb       INT,
    actual_output_s3_key VARCHAR(255),                -- only if WA / debug
    UNIQUE (submission_id, test_case_id)
);
```

### 4.2.3 Why These Choices?

* **`BIGSERIAL` keys** — submissions will exceed 2³¹ on a busy platform.
* **`code_s3_key` instead of `code TEXT`** — keeps row size tiny; avoids
  bloating index pages and TOAST tables.
* **`code_hash`** — enables submission deduplication and plagiarism heuristics.
* **`status` partial index** — vastly speeds the "find pending submissions"
  query (only non-final rows are indexed).
* **`ON DELETE CASCADE`** — deleting a problem cleans test cases & results
  atomically.

---

## 4.3 Sharding & Partitioning Strategy

### Submissions Table — Time-Range Partitioning

```sql
CREATE TABLE submissions (
    ...
) PARTITION BY RANGE (submitted_at);

CREATE TABLE submissions_2026_06 PARTITION OF submissions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
```

* Old partitions can be detached and moved to cheap storage.
* Time-bounded queries (`WHERE submitted_at > NOW() - INTERVAL '7 days'`)
  hit only one partition.

### Read Replicas

* 1 primary, 3+ async replicas.
* Read-heavy endpoints (problem list, submission history) routed to replicas.
* Verdict writes always to primary.

### Future Sharding

When a single Postgres can't keep up, shard `submissions` by `user_id` hash.
The schema above is already shard-friendly because submission queries are
almost always scoped to one user or one problem.

---

## 4.4 NoSQL & Cache Layers

### Redis Keys

| Key pattern                       | Type     | Purpose                          | TTL    |
|-----------------------------------|----------|----------------------------------|--------|
| `rate:sub:{user_id}`              | INT      | Token-bucket submission limit    | 60 s   |
| `cache:problem:{problem_id}`      | HASH     | Problem metadata cache           | 10 min |
| `leaderboard:problem:{problem_id}`| ZSET     | Best runtimes for a problem      | none   |
| `leaderboard:global`              | ZSET     | User rating ranking              | none   |
| `live:status:{submission_id}`     | STRING   | Real-time progress for WS push   | 1 hour |
| `session:{jwt_jti}`               | STRING   | Token revocation list            | 24 hrs |

### S3 Bucket Layout

```
s3://codesphere/
├── code/{submission_id}                 (text/plain, max 64 KB)
├── stdout/{submission_id}/{test_case_id} (only stored for WA / failed)
└── testcases/{problem_id}/{seq}/{input,expected}.txt
```

---

## 4.5 Sample Query Patterns

```sql
-- Most-recent 50 submissions for a user
SELECT submission_id, problem_id, verdict, submitted_at
FROM submissions
WHERE user_id = $1
ORDER BY submitted_at DESC
LIMIT 50;
-- Uses idx_sub_user_date

-- Best runtime per user for a given problem (for leaderboard rebuild)
SELECT user_id, MIN(runtime_ms) AS best_ms
FROM submissions
WHERE problem_id = $1 AND verdict = 'AC'
GROUP BY user_id;

-- Detect duplicate submission (recent identical code)
SELECT submission_id
FROM submissions
WHERE user_id = $1 AND code_hash = $2
  AND submitted_at > NOW() - INTERVAL '1 minute';
```

---

## 4.6 Capacity Estimate

Assume:

* 1 M users, 100 K DAU
* 50 submissions / DAU / day → 5 M submissions / day
* ~150 days retention in hot Postgres → ~750 M rows hot
* Each row ≈ 200 B → ~150 GB hot, easily one big Postgres instance
* S3 code blobs avg 2 KB × 5 M / day = 10 GB / day → ~$0.25/day raw storage

So a single Postgres primary + replicas can comfortably hold 6 months of
hot data; everything older flows to a partitioned cold table or BigQuery
for analytics.
