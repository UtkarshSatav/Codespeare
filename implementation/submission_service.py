"""
submission_service.py
=====================

Producer half of the pipeline.  Validates an incoming submission,
persists it to the (in-memory) submissions table + S3 stand-in, and
publishes the job onto the worker queue.

Mirrors the production Submission Service from docs/02_system_architecture.md.
"""

from __future__ import annotations

import hashlib
import itertools
import queue
from dataclasses import dataclass, field
from typing import Dict

from sandbox_worker import Problem, Submission, Verdict


# ---------------------------------------------------------------------------
# Stores (stand-ins for Postgres + S3 + Kafka)
# ---------------------------------------------------------------------------

@dataclass
class InMemoryStores:
    users:       Dict[int, str]              = field(default_factory=dict)
    problems:    Dict[int, Problem]          = field(default_factory=dict)
    code_blobs:  Dict[str, str]              = field(default_factory=dict)  # "s3"
    submissions: Dict[int, Submission]       = field(default_factory=dict)
    verdicts:    Dict[int, Verdict]          = field(default_factory=dict)


class SubmissionService:
    MAX_SOURCE_BYTES = 64 * 1024            # NFR — source size cap
    SUPPORTED_LANGS  = {"python3", "cpp17"}

    def __init__(
        self,
        stores: InMemoryStores,
        job_queue: "queue.Queue[tuple[Submission, Problem]]",
    ):
        self.stores = stores
        self.job_queue = job_queue
        self._id = itertools.count(start=1)

    # ------------------------------------------------------------------
    # The single "POST /submissions" entrypoint.
    # ------------------------------------------------------------------

    def submit(self, user_id: int, problem_id: int,
               language: str, source: str) -> int:

        # ---- 1. Validate (would normally be done by API Gateway) -----
        if user_id not in self.stores.users:
            raise PermissionError("unknown user")
        if problem_id not in self.stores.problems:
            raise LookupError("unknown problem")
        if language not in self.SUPPORTED_LANGS:
            raise ValueError(f"unsupported language: {language}")
        if len(source.encode()) > self.MAX_SOURCE_BYTES:
            raise ValueError("source too large")

        # ---- 2. Persist code to "S3" --------------------------------
        submission_id = next(self._id)
        s3_key = f"code/{submission_id}"
        self.stores.code_blobs[s3_key] = source
        code_hash = hashlib.sha256(source.encode()).hexdigest()

        # ---- 3. Persist row to "Postgres" (status = QUEUED) ---------
        submission = Submission(
            submission_id=submission_id,
            user_id=user_id,
            problem_id=problem_id,
            language=language,
            source=source,
        )
        self.stores.submissions[submission_id] = submission

        # ---- 4. Publish to "Kafka" ----------------------------------
        # In production we'd push a small message with submission_id +
        # s3 key.  Here we hand the worker the full Submission + Problem
        # directly, since both live in the same process.
        problem = self.stores.problems[problem_id]
        self.job_queue.put((submission, problem))

        # Silence "unused" warning on code_hash — in production it goes
        # into the submissions row for dedup / plagiarism heuristics.
        _ = code_hash

        # ---- 5. Return 202 Accepted ---------------------------------
        return submission_id
