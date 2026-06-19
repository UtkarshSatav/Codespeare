"""
code_executor.py
================

Sandboxed code execution primitive.

In production this would shell out to `docker run` with seccomp / cgroup
flags (see docs/03_execution_flow.md).  For a portable case-study demo we
use the closest equivalent the Python standard library offers:

  * `subprocess.Popen` to run the user program in its own process.
  * `resource.setrlimit` (via `preexec_fn`) to cap CPU time, memory,
    file size, and process count inside that child process.
  * An external wall-clock timer that SIGKILLs the entire process group
    if the program hangs.

The class returns an `ExecutionResult` carrying enough information for
`test_validator.py` to turn it into one of the standard verdicts:
AC / WA / TLE / MLE / RE / CE.
"""

from __future__ import annotations

import os
import resource
import signal
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Result objects
# ---------------------------------------------------------------------------

@dataclass
class ExecutionResult:
    stdout: str
    stderr: str
    exit_code: int
    runtime_ms: int
    memory_kb: int
    timed_out: bool
    out_of_memory: bool
    signal: Optional[int]

    @property
    def runtime_error(self) -> bool:
        # Non-zero exit, no timeout, no OOM => runtime error.
        return (
            not self.timed_out
            and not self.out_of_memory
            and self.exit_code != 0
        )


@dataclass
class CompilationResult:
    success: bool
    stderr: str


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

class CodeExecutor:
    """
    Runs source code in an isolated subprocess with resource limits.

    Parameters
    ----------
    cpu_limit_s : float
        Hard CPU-time limit per execution (RLIMIT_CPU).
    wall_limit_s : float
        Wall-clock limit; external timer SIGKILLs the process group if
        exceeded.  Normally 2× cpu_limit_s.
    memory_limit_mb : int
        Address-space limit (RLIMIT_AS).
    pids_limit : int
        Max processes the child may create (RLIMIT_NPROC).
    """

    LANGUAGES = {
        "python3": {
            "source_name": "sol.py",
            # Pre-compile to catch SyntaxError as a CE verdict (rather than
            # letting it surface as a runtime exception → RE).
            "compile_cmd": ["python3", "-m", "py_compile", "sol.py"],
            "run_cmd": ["python3", "sol.py"],
        },
        # In real deployment the run command for compiled langs would be
        # the produced binary; we still support them at the case-study
        # level so the structure is visible:
        "cpp17": {
            "source_name": "sol.cpp",
            "compile_cmd": ["g++", "-O2", "-std=c++17", "-o", "sol", "sol.cpp"],
            "run_cmd": ["./sol"],
        },
    }

    def __init__(
        self,
        cpu_limit_s: float = 2.0,
        wall_limit_s: float = 4.0,
        memory_limit_mb: int = 256,
        pids_limit: int = 64,
    ):
        self.cpu_limit_s = cpu_limit_s
        self.wall_limit_s = wall_limit_s
        self.memory_limit_mb = memory_limit_mb
        self.pids_limit = pids_limit

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def compile(self, workdir: Path, language: str) -> CompilationResult:
        """Compile if the language requires it; return success + stderr."""
        spec = self._lang(language)
        cmd = spec["compile_cmd"]
        if cmd is None:
            return CompilationResult(success=True, stderr="")
        try:
            cp = subprocess.run(
                cmd,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=10.0,
            )
            return CompilationResult(
                success=cp.returncode == 0,
                stderr=cp.stderr,
            )
        except subprocess.TimeoutExpired as e:
            return CompilationResult(
                success=False, stderr=f"compile timeout: {e}"
            )
        except FileNotFoundError as e:
            return CompilationResult(
                success=False, stderr=f"toolchain missing: {e}"
            )

    def run(
        self,
        workdir: Path,
        language: str,
        stdin_data: str,
    ) -> ExecutionResult:
        """Run the (already compiled / interpreted) program once."""
        spec = self._lang(language)
        cmd = spec["run_cmd"]

        start = time.perf_counter()
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=workdir,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                preexec_fn=self._apply_rlimits,
                start_new_session=True,  # own process group; clean SIGKILL
            )
        except FileNotFoundError as e:
            return ExecutionResult(
                stdout="", stderr=f"interpreter missing: {e}",
                exit_code=127, runtime_ms=0, memory_kb=0,
                timed_out=False, out_of_memory=False, signal=None,
            )

        timed_out = False
        try:
            stdout, stderr = proc.communicate(
                input=stdin_data,
                timeout=self.wall_limit_s,
            )
        except subprocess.TimeoutExpired:
            timed_out = True
            self._kill_group(proc.pid)
            stdout, stderr = proc.communicate()

        runtime_ms = int((time.perf_counter() - start) * 1000)

        # `getrusage` returns memory of children since the last call.
        # On Linux it's in KB; on macOS it's in bytes.  Normalize.
        rusage = resource.getrusage(resource.RUSAGE_CHILDREN)
        mem_kb = int(rusage.ru_maxrss)
        if os.uname().sysname == "Darwin":
            mem_kb = mem_kb // 1024

        sig = None
        if proc.returncode is not None and proc.returncode < 0:
            sig = -proc.returncode

        # RLIMIT_CPU fires SIGXCPU then SIGKILL once cpu seconds exhausted —
        # treat that as TLE rather than RE.
        cpu_killed = (
            sig in (signal.SIGKILL, signal.SIGXCPU)
            and runtime_ms >= int(self.cpu_limit_s * 1000 * 0.9)
        )
        if cpu_killed:
            timed_out = True

        # Memory verdict — two ways to detect it:
        #   (a) Linux: RLIMIT_AS kills the process at the cap → SIGKILL
        #       with mem near limit.
        #   (b) macOS: RLIMIT_AS is not reliably enforced; instead we
        #       compare peak RSS against the cap post-hoc.  In a real
        #       cgroup-based sandbox the kernel hard-kills before this
        #       point — here we just translate "exceeded" into MLE.
        out_of_memory = (
            (
                not timed_out
                and sig == signal.SIGKILL
                and mem_kb >= self.memory_limit_mb * 1024 * 0.9
            )
            or mem_kb > self.memory_limit_mb * 1024
        )

        return ExecutionResult(
            stdout=stdout,
            stderr=stderr,
            exit_code=proc.returncode if proc.returncode is not None else -1,
            runtime_ms=runtime_ms,
            memory_kb=mem_kb,
            timed_out=timed_out,
            out_of_memory=out_of_memory,
            signal=sig,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _lang(self, language: str):
        if language not in self.LANGUAGES:
            raise ValueError(f"unsupported language: {language}")
        return self.LANGUAGES[language]

    def _apply_rlimits(self) -> None:
        """Runs in the *child* before exec(); installs all rlimits."""
        # CPU seconds — hard kill via SIGKILL when exceeded.
        cpu = int(self.cpu_limit_s) + 1
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        # Virtual memory.
        mem_bytes = self.memory_limit_mb * 1024 * 1024
        try:
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
        except (ValueError, OSError):
            pass  # macOS may refuse very small AS limits; skip silently.
        # Output file size — 4 MB.
        resource.setrlimit(resource.RLIMIT_FSIZE,
                           (4 * 1024 * 1024, 4 * 1024 * 1024))
        # Process count — block fork bombs.
        try:
            resource.setrlimit(resource.RLIMIT_NPROC,
                               (self.pids_limit, self.pids_limit))
        except (ValueError, OSError):
            pass
        # Open files.
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))

    @staticmethod
    def _kill_group(pid: int) -> None:
        """SIGKILL the entire process group, in case the user code forked."""
        try:
            os.killpg(os.getpgid(pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


# ---------------------------------------------------------------------------
# Convenience: prepare a workdir with the source code written out.
# ---------------------------------------------------------------------------

def prepare_workdir(source: str, language: str) -> tempfile.TemporaryDirectory:
    spec = CodeExecutor.LANGUAGES[language]
    tmp = tempfile.TemporaryDirectory(prefix="codesphere-")
    (Path(tmp.name) / spec["source_name"]).write_text(source)
    return tmp
