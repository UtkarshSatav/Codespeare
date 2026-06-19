-- =====================================================================
-- CodeSphere — PostgreSQL Schema (DDL)
-- Target: PostgreSQL 14+
-- =====================================================================
-- This file is the system-of-record schema. Object storage (S3) holds
-- large blobs (code, stdout) and is referenced by *_s3_key columns.
-- =====================================================================

BEGIN;

-- =====================================================================
-- 0. Extensions
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- for trigram search on problems

-- =====================================================================
-- 1. Users
-- =====================================================================
CREATE TABLE users (
    user_id         BIGSERIAL    PRIMARY KEY,
    username        VARCHAR(50)  UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user','setter','admin')),
    rating          INT          NOT NULL DEFAULT 1200,
    is_banned       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_login_at   TIMESTAMPTZ
);

CREATE INDEX idx_users_rating ON users (rating DESC) WHERE is_banned = FALSE;

-- =====================================================================
-- 2. Languages (lookup)
-- =====================================================================
CREATE TABLE languages (
    language_code   VARCHAR(20)  PRIMARY KEY,
    display_name    VARCHAR(50)  NOT NULL,
    docker_image    VARCHAR(255) NOT NULL,
    compile_cmd     TEXT,                                 -- NULL => interpreted
    run_cmd         TEXT         NOT NULL,
    file_extension  VARCHAR(10)  NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE
);

-- =====================================================================
-- 3. Problems
-- =====================================================================
CREATE TABLE problems (
    problem_id        BIGSERIAL    PRIMARY KEY,
    slug              VARCHAR(120) UNIQUE NOT NULL,
    title             VARCHAR(255) NOT NULL,
    description_md    TEXT         NOT NULL,
    difficulty        VARCHAR(10)  NOT NULL
                      CHECK (difficulty IN ('Easy','Medium','Hard')),
    time_limit_ms     INT          NOT NULL DEFAULT 2000
                      CHECK (time_limit_ms BETWEEN 100 AND 30000),
    memory_limit_mb   INT          NOT NULL DEFAULT 256
                      CHECK (memory_limit_mb BETWEEN 16 AND 1024),
    checker_type      VARCHAR(20)  NOT NULL DEFAULT 'trimmed'
                      CHECK (checker_type IN ('exact','trimmed','numeric_eps','custom_checker')),
    checker_eps       DOUBLE PRECISION,
    created_by        BIGINT       REFERENCES users(user_id),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    is_public         BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_problems_difficulty ON problems (difficulty) WHERE is_public;
CREATE INDEX idx_problems_title_trgm ON problems USING GIN (title gin_trgm_ops);

-- =====================================================================
-- 4. Test Cases  (one row per case; payload in S3)
-- =====================================================================
CREATE TABLE test_cases (
    test_case_id    BIGSERIAL    PRIMARY KEY,
    problem_id      BIGINT       NOT NULL REFERENCES problems(problem_id) ON DELETE CASCADE,
    seq             INT          NOT NULL,
    input_s3_key    VARCHAR(255) NOT NULL,
    expected_s3_key VARCHAR(255) NOT NULL,
    is_sample       BOOLEAN      NOT NULL DEFAULT FALSE,
    weight          INT          NOT NULL DEFAULT 1
                    CHECK (weight > 0),
    UNIQUE (problem_id, seq)
);

CREATE INDEX idx_testcases_problem ON test_cases (problem_id, is_sample, seq);

-- =====================================================================
-- 5. Submissions  (partitioned by submitted_at)
-- =====================================================================
CREATE TABLE submissions (
    submission_id   BIGSERIAL    NOT NULL,
    user_id         BIGINT       NOT NULL REFERENCES users(user_id),
    problem_id      BIGINT       NOT NULL REFERENCES problems(problem_id),
    language_code   VARCHAR(20)  NOT NULL REFERENCES languages(language_code),
    code_s3_key     VARCHAR(255) NOT NULL,
    code_hash       CHAR(64)     NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED','COMPILING','RUNNING','JUDGED','ERRORED')),
    verdict         VARCHAR(20)
                    CHECK (verdict IS NULL OR verdict IN
                          ('AC','WA','TLE','MLE','RE','CE','SE')),
    runtime_ms      INT,
    memory_kb       INT,
    failed_test_seq INT,                                 -- which test failed first
    submitted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    judged_at       TIMESTAMPTZ,
    PRIMARY KEY (submission_id, submitted_at)
) PARTITION BY RANGE (submitted_at);

-- Create rolling monthly partitions.  Add new ones via a cron job.
CREATE TABLE submissions_2026_06 PARTITION OF submissions
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE submissions_2026_07 PARTITION OF submissions
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE submissions_2026_08 PARTITION OF submissions
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');

CREATE INDEX idx_sub_user_date    ON submissions (user_id, submitted_at DESC);
CREATE INDEX idx_sub_problem_user ON submissions (problem_id, user_id);
CREATE INDEX idx_sub_problem_ac   ON submissions (problem_id, runtime_ms)
                                   WHERE verdict = 'AC';
CREATE INDEX idx_sub_status_open  ON submissions (status, submitted_at)
                                   WHERE status <> 'JUDGED';
CREATE INDEX idx_sub_codehash     ON submissions (user_id, code_hash);

-- =====================================================================
-- 6. Submission Results  (one row per (submission, test_case))
-- =====================================================================
CREATE TABLE submission_results (
    result_id           BIGSERIAL    PRIMARY KEY,
    submission_id       BIGINT       NOT NULL,
    test_case_id        BIGINT       NOT NULL REFERENCES test_cases(test_case_id),
    verdict             VARCHAR(20)  NOT NULL,
    runtime_ms          INT,
    memory_kb           INT,
    actual_output_s3_key VARCHAR(255),                    -- only stored on WA
    UNIQUE (submission_id, test_case_id)
);

CREATE INDEX idx_results_submission ON submission_results (submission_id);

-- =====================================================================
-- 7. Contests (optional but listed in case study)
-- =====================================================================
CREATE TABLE contests (
    contest_id   BIGSERIAL    PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    starts_at    TIMESTAMPTZ  NOT NULL,
    ends_at      TIMESTAMPTZ  NOT NULL,
    is_rated     BOOLEAN      NOT NULL DEFAULT TRUE,
    CHECK (ends_at > starts_at)
);

CREATE TABLE contest_problems (
    contest_id   BIGINT REFERENCES contests(contest_id) ON DELETE CASCADE,
    problem_id   BIGINT REFERENCES problems(problem_id) ON DELETE CASCADE,
    label        CHAR(1)      NOT NULL,                    -- 'A','B','C',...
    PRIMARY KEY (contest_id, problem_id)
);

-- =====================================================================
-- 8. Helper views
-- =====================================================================

-- Best runtime per (user, problem) — used by per-problem leaderboards.
CREATE OR REPLACE VIEW v_best_runtime AS
SELECT user_id,
       problem_id,
       MIN(runtime_ms) AS best_runtime_ms,
       MIN(memory_kb)  AS best_memory_kb
FROM   submissions
WHERE  verdict = 'AC'
GROUP BY user_id, problem_id;

-- Per-user solve count (overall) — for profile pages.
CREATE OR REPLACE VIEW v_user_solve_count AS
SELECT user_id, COUNT(DISTINCT problem_id) AS solved_count
FROM   submissions
WHERE  verdict = 'AC'
GROUP BY user_id;

COMMIT;
