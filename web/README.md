# CodeSphere — Web Frontend (Next.js)

A Next.js 14 + TypeScript + Tailwind frontend for the CodeSphere case study.
It mirrors the production API surface (`POST /api/submissions`,
`GET /api/submissions/[id]`) but, instead of producing to Kafka and waiting
for a Docker-based worker, the API routes invoke the existing Python judge
as a subprocess (`../implementation/judge_single.py`).

## Run

```bash
cd web
npm install
npm run dev          # → http://localhost:3000
```

Requires:
- Node 18+
- Python 3.9+ (the judge subprocess)

## Pages

| Route                        | Purpose                                                |
|------------------------------|--------------------------------------------------------|
| `/`                          | Problem list — search, filter (difficulty/tag/company/status), sortable columns, random pick, progress + streak |
| `/lists`                     | Study plans — curated problem collections with progress |
| `/problems/[slug]`           | Statement + Monaco editor + tabs (Description / Editorial / **Solution** / Submissions / **Notes** / Discussion) |
| `/submissions`               | Submission history (auto-refreshing)                   |
| `/submissions/[id]`          | Verdict detail with per-test breakdown                 |
| `/profile/[username]`        | Stats, difficulty breakdown, activity heatmap, streaks |
| `/leaderboard`               | Global ranking                                         |
| `/daily`                     | Redirect to the rotating daily problem                 |

## Features (LeetCode parity)

- **Genuine starter stubs.** The editor opens to an input-scaffold + `TODO`,
  never the answer. The worked solution lives behind the gated **Solution** tab.
- **Verified test suites.** Every problem has 10–13 cases (samples + hidden
  edge/boundary/duplicate/stress). All `expected` outputs were produced by
  running the reference solution under Python, so the judge returns `AC` for the
  reference and `WA` for the stub (checked end-to-end via `judge_single.py`).
- **Run vs. Submit.** *Run* checks the visible sample cases and shows your
  output vs. expected per case (`TestResultPanel`); *Submit* grades against all
  hidden tests and records a Firestore submission.
- **Editor UX.** Per-(problem, language) autosave, **Reset to stub**, **Copy**,
  **Fullscreen**, font-size + theme toggle, and `⌘/Ctrl+↵` run / `⌘/Ctrl+Shift+↵`
  submit shortcuts.
- **Metadata.** Company tags, frequency bar, related problems, complexity, and a
  markdown-rendered approach write-up.
- **Engagement.** Private per-problem **notes**, likes, bookmarks, progress
  tracker, daily streak, and study-plan tracks.

## API

| Method · Path        | Description                                                  |
|----------------------|-------------------------------------------------------------|
| `POST /api/judge`    | Grade code against a problem's tests → verdict JSON          |
| `POST /api/run`      | Execute code against custom stdin → stdout/stderr            |

Data (submissions, profiles, notes, likes, bookmarks, discussions) is read and
written **client-direct to Firestore** via the Web SDK; the only server-side
endpoints are the two stateless Python-execution wrappers above.

## How the async flow works (mirrors the docs)

```
client  ──►  POST /api/submissions
                  │
                  ▼  (synchronous validation, create row)
              store.ts   (in-memory Map, stand-in for Postgres)
                  │
                  ▼  (fire-and-forget)
              dispatchJudge()  ─►  spawn python3 judge_single.py
                                       │
                                       ▼  (sandboxed execution)
                                   verdict JSON on stdout
                                       │
                                       ▼
                                   updateSubmission()
                  ┌────────────────────┘
                  ▼
client polls  ──►  GET /api/submissions/[id]  ─►  verdict
```

The `202 Accepted` response shape and the polling pattern match the
production design described in `docs/02_system_architecture.md`. The only
substitutions are the queue (in-memory vs. Kafka) and the sandbox
(subprocess + rlimit vs. Docker).
