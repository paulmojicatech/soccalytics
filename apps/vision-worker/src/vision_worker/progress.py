"""Job progress: JobStreamEvents on Redis pub/sub ``soccalytics:job:{jobId}``.

The API relays these as SSE. Publishing is best-effort (a Redis blip must never fail a
multi-minute CV job) and throttled so per-frame updates don't flood the channel.
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Protocol

import structlog

from .contracts import JobStage, JobStatus, JobStreamEvent, job_channel

if TYPE_CHECKING:
    import redis

log = structlog.get_logger(__name__)


class ProgressReporter(Protocol):
    def report(
        self,
        stage: JobStage,
        status: JobStatus,
        progress: float,
        message: str | None = None,
    ) -> None: ...


class RedisProgressPublisher:
    """Synchronous publisher — safe to call from the pipeline's worker thread."""

    def __init__(
        self,
        client: redis.Redis,
        job_id: str,
        min_interval_s: float = 1.0,
        min_delta: float = 0.05,
    ) -> None:
        self._client = client
        self._job_id = job_id
        self._channel = job_channel(job_id)
        self._min_interval = min_interval_s
        self._min_delta = min_delta
        self._last: dict[str, tuple[str, float, float]] = {}  # stage -> (status, progress, ts)

    def _should_send(self, stage: str, status: str, progress: float) -> bool:
        prev = self._last.get(stage)
        if prev is None or prev[0] != status or status != "running":
            return True
        _, p, ts = prev
        return (time.monotonic() - ts) >= self._min_interval or abs(progress - p) >= self._min_delta

    def report(
        self,
        stage: JobStage,
        status: JobStatus,
        progress: float,
        message: str | None = None,
    ) -> None:
        progress = min(1.0, max(0.0, float(progress)))
        if not self._should_send(stage, status, progress):
            return
        evt = JobStreamEvent(
            jobId=self._job_id, stage=stage, status=status, progress=progress, message=message
        )
        try:
            self._client.publish(self._channel, evt.model_dump_json())
            self._last[stage] = (status, progress, time.monotonic())
        except Exception as exc:
            log.warning("progress_publish_failed", error=str(exc), stage=stage, status=status)


class RecordingProgress:
    """In-memory reporter for tests and dry runs."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str, float, str | None]] = []

    def report(
        self,
        stage: JobStage,
        status: JobStatus,
        progress: float,
        message: str | None = None,
    ) -> None:
        self.events.append((stage, status, progress, message))
