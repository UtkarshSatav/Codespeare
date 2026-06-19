-- =====================================================================
-- CodeSphere — Sample seed data
-- Run AFTER schema.sql.
-- =====================================================================

BEGIN;

-- 1. Languages -----------------------------------------------------------
INSERT INTO languages (language_code, display_name, docker_image,
                       compile_cmd, run_cmd, file_extension) VALUES
 ('python3', 'Python 3.11', 'codesphere/python311:1.0',
        NULL,
        'python3 /tmp/sol.py', '.py'),
 ('cpp17',   'C++17 (g++)', 'codesphere/cpp17:1.0',
        'g++ -O2 -std=c++17 -o /tmp/sol /tmp/sol.cpp',
        '/tmp/sol', '.cpp'),
 ('java17',  'Java 17',     'codesphere/java17:1.0',
        'javac -d /tmp /tmp/Sol.java',
        'java -cp /tmp Sol', '.java'),
 ('node18',  'Node.js 18',  'codesphere/node18:1.0',
        NULL,
        'node /tmp/sol.js', '.js'),
 ('go121',   'Go 1.21',     'codesphere/go121:1.0',
        'go build -o /tmp/sol /tmp/sol.go',
        '/tmp/sol', '.go');

-- 2. Users ---------------------------------------------------------------
INSERT INTO users (username, email, password_hash, role, rating) VALUES
 ('alice',     'alice@example.com',  '$argon2id$hash1', 'user',  1450),
 ('bob',       'bob@example.com',    '$argon2id$hash2', 'user',  1187),
 ('charlie',   'charlie@example.com','$argon2id$hash3', 'user',  1600),
 ('setter01',  'setter@codesphere.io','$argon2id$hash4','setter', 1700),
 ('admin',     'admin@codesphere.io', '$argon2id$hash5','admin',  2000);

-- 3. Problems ------------------------------------------------------------
INSERT INTO problems (slug, title, description_md, difficulty,
                      time_limit_ms, memory_limit_mb, checker_type, created_by)
VALUES
 ('two-sum-int', 'Two Sum (Integers)',
  E'## Two Sum\n\nGiven two integers `a` and `b` on a single line, print their sum.\n\n### Input\nA single line containing two integers separated by space.\n\n### Output\nOne integer — the sum.',
  'Easy', 1000, 128, 'exact',
  (SELECT user_id FROM users WHERE username='setter01')),

 ('reverse-string', 'Reverse a String',
  E'Reverse the given string.\n\n### Input\nA single line containing a string (no spaces).\n\n### Output\nThe reversed string.',
  'Easy', 1000, 128, 'trimmed',
  (SELECT user_id FROM users WHERE username='setter01')),

 ('pi-decimal',    'Compute Pi to N Places',
  E'Print pi to the requested number of decimal places.\n\n### Input\nAn integer N (1..6).\n\n### Output\nA single line with the value of pi to N decimal places (numeric tolerance 1e-6 applies).',
  'Medium', 2000, 256, 'numeric_eps',
  (SELECT user_id FROM users WHERE username='setter01'));

-- Set epsilon for the numeric-eps problem.
UPDATE problems SET checker_eps = 1e-6 WHERE slug = 'pi-decimal';

-- 4. Test cases ----------------------------------------------------------
-- Test data in production is stored in S3; we just store the s3 keys.
INSERT INTO test_cases (problem_id, seq, input_s3_key, expected_s3_key,
                        is_sample, weight)
VALUES
 -- Two Sum (3 cases)
 ((SELECT problem_id FROM problems WHERE slug='two-sum-int'), 1,
        'testcases/1/1/in.txt','testcases/1/1/out.txt', TRUE,  1),
 ((SELECT problem_id FROM problems WHERE slug='two-sum-int'), 2,
        'testcases/1/2/in.txt','testcases/1/2/out.txt', FALSE, 1),
 ((SELECT problem_id FROM problems WHERE slug='two-sum-int'), 3,
        'testcases/1/3/in.txt','testcases/1/3/out.txt', FALSE, 1),

 -- Reverse String (2 cases)
 ((SELECT problem_id FROM problems WHERE slug='reverse-string'), 1,
        'testcases/2/1/in.txt','testcases/2/1/out.txt', TRUE,  1),
 ((SELECT problem_id FROM problems WHERE slug='reverse-string'), 2,
        'testcases/2/2/in.txt','testcases/2/2/out.txt', FALSE, 1),

 -- Pi (2 cases)
 ((SELECT problem_id FROM problems WHERE slug='pi-decimal'), 1,
        'testcases/3/1/in.txt','testcases/3/1/out.txt', TRUE,  1),
 ((SELECT problem_id FROM problems WHERE slug='pi-decimal'), 2,
        'testcases/3/2/in.txt','testcases/3/2/out.txt', FALSE, 1);

-- 5. A judged submission for demo purposes -------------------------------
INSERT INTO submissions (user_id, problem_id, language_code, code_s3_key,
                         code_hash, status, verdict, runtime_ms, memory_kb,
                         submitted_at, judged_at)
VALUES
 ((SELECT user_id FROM users WHERE username='alice'),
  (SELECT problem_id FROM problems WHERE slug='two-sum-int'),
  'python3', 'code/seed-1',
  REPEAT('a',64), 'JUDGED', 'AC', 14, 5120,
  '2026-06-10 14:30:00+00', '2026-06-10 14:30:02+00');

COMMIT;
