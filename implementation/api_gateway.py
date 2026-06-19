"""
api_gateway.py
==============

A trivial in-process stand-in for the production API Gateway.  It does:

  * (Mock) JWT-style authentication via a {token -> user_id} map.
  * Per-user submission rate limiting (token bucket).
  * Routing to the Submission Service.
  * Result polling endpoint (would be a WebSocket in production).

In a real deployment this would be Kong / AWS API Gateway in front of a
fleet of FastAPI / Express services.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque
from typing import Deque, Dict

from sandbox_worker import Verdict
from submission_service import InMemoryStores, SubmissionService


class APIGateway:
    RATE_LIMIT_WINDOW_S = 60.0
    RATE_LIMIT_MAX      = 12               # 12 submissions per minute per user

    def __init__(
        self,
        stores: InMemoryStores,
        submission_service: SubmissionService,
    ):
        self.stores = stores
        self.submission_service = submission_service
        self._tokens: Dict[str, int] = {}                       # "JWT" -> user_id
        self._hits:   Dict[int, Deque[float]] = defaultdict(deque)

    # ------------------------------------------------------------------
    # "Auth"
    # ------------------------------------------------------------------

    def login_mock(self, user_id: int) -> str:
        token = f"jwt-{user_id}"
        self._tokens[token] = user_id
        return token

    def _auth(self, token: str) -> int:
        if token not in self._tokens:
            raise PermissionError("invalid token")
        return self._tokens[token]

    # ------------------------------------------------------------------
    # Rate limit (token-bucket via sliding window)
    # ------------------------------------------------------------------

    def _check_rate_limit(self, user_id: int) -> None:
        now = time.monotonic()
        bucket = self._hits[user_id]
        cutoff = now - self.RATE_LIMIT_WINDOW_S
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= self.RATE_LIMIT_MAX:
            raise PermissionError("rate limit exceeded")
        bucket.append(now)

    # ------------------------------------------------------------------
    # REST-equivalents
    # ------------------------------------------------------------------

    def post_submission(self, token: str, problem_id: int,
                        language: str, source: str) -> int:
        """POST /api/v1/submissions  →  returns submission_id."""
        user_id = self._auth(token)
        self._check_rate_limit(user_id)
        return self.submission_service.submit(
            user_id=user_id,
            problem_id=problem_id,
            language=language,
            source=source,
        )

    def get_verdict(self, token: str, submission_id: int) -> Verdict | None:
        """GET /api/v1/submissions/{id}  →  verdict or None if still pending."""
        self._auth(token)
        return self.stores.verdicts.get(submission_id)
