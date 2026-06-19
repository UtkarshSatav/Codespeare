"""
test_validator.py
=================

Validates the actual stdout produced by a user program against the
expected output of a test case.  Four comparison modes:

  * exact          — byte-for-byte equality
  * trimmed        — trim trailing whitespace per line, ignore CR/LF
  * numeric_eps    — tokenize both sides; abs(a-b) <= eps + eps*|b|
  * custom_checker — invoke a problem-supplied judge binary (stub here)
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class CompareResult:
    passed: bool
    reason: str = ""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _normalize(text: str) -> str:
    """Strip trailing whitespace per line; ignore final newline."""
    lines = text.replace("\r\n", "\n").split("\n")
    while lines and lines[-1].strip() == "":
        lines.pop()
    return "\n".join(line.rstrip() for line in lines)


def _numeric_close(actual: str, expected: str, eps: float) -> CompareResult:
    a_toks = actual.split()
    e_toks = expected.split()
    if len(a_toks) != len(e_toks):
        return CompareResult(False, f"token count {len(a_toks)} != {len(e_toks)}")
    for i, (a, e) in enumerate(zip(a_toks, e_toks)):
        try:
            fa, fe = float(a), float(e)
        except ValueError:
            if a != e:
                return CompareResult(False, f"token {i}: {a!r} != {e!r}")
            continue
        if not (math.isclose(fa, fe, rel_tol=eps, abs_tol=eps)
                or (math.isnan(fa) and math.isnan(fe))):
            return CompareResult(False,
                f"token {i}: {fa} vs {fe} (eps={eps})")
    return CompareResult(True)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compare(
    actual: str,
    expected: str,
    mode: str = "trimmed",
    eps: float = 1e-6,
) -> CompareResult:
    """
    Compare actual output to expected.  See module docstring for modes.
    """
    if mode == "exact":
        if actual == expected:
            return CompareResult(True)
        return CompareResult(False, "exact mismatch")

    if mode == "trimmed":
        if _normalize(actual) == _normalize(expected):
            return CompareResult(True)
        return CompareResult(False, "trimmed mismatch")

    if mode == "numeric_eps":
        return _numeric_close(actual, expected, eps)

    if mode == "custom_checker":
        # In production: spawn a problem-supplied checker binary with
        # (input, expected, actual) as args and read its exit code.
        raise NotImplementedError("custom_checker not implemented in demo")

    raise ValueError(f"unknown compare mode: {mode}")
