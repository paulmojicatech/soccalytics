"""Pydantic mirrors of the TypeScript zod contracts.

!! KEEP IN SYNC with:
   - libs/contracts/src/lib/jobs.ts      (QUEUES, VisionJobPayload, AnalyticsJobPayload,
                                          JobStreamEvent, jobChannel)
   - libs/contracts/src/lib/tracking.ts  (TrackingFrame, TrackingMeta, TrackingDocument)
   - libs/contracts/src/lib/common.ts    (Id, PITCH)

Field names are camelCase on purpose so ``model_dump()`` produces JSON byte-compatible
with what the Node side parses with zod. Any change in the TS contracts must be reflected
here (and vice versa); tests/test_contracts.py pins the shapes.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Id = Annotated[str, StringConstraints(min_length=1)]

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0

QUEUES = {"vision": "soccalytics.vision", "analytics": "soccalytics.analytics"}

JobStage = Literal["ingest", "detect", "track", "events", "metrics", "report"]
JobStatus = Literal["queued", "running", "completed", "failed"]


def job_channel(job_id: str) -> str:
    """Redis pub/sub channel for JobStreamEvents (mirrors ``jobChannel`` in jobs.ts)."""
    return f"soccalytics:job:{job_id}"


class _Inbound(BaseModel):
    # Be lenient with extra keys from producers, strict on the ones we use.
    model_config = ConfigDict(extra="ignore", frozen=True)


class _Outbound(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ── queue payloads ─────────────────────────────────────────────────────


class CalibrationPoint(_Inbound):
    px: float
    py: float
    x: float
    y: float


class VisionJobPayload(_Inbound):
    jobId: Id
    matchId: Id
    videoKey: str
    homeTeamId: Id
    awayTeamId: Id
    calibration: Annotated[list[CalibrationPoint], Field(min_length=4, max_length=4)] | None


class EventsJobPayload(_Outbound):
    """The ``{task: 'events'}`` arm of AnalyticsJobPayload."""

    task: Literal["events"] = "events"
    jobId: Id
    matchId: Id
    trackingKey: str


class JobStreamEvent(_Outbound):
    jobId: Id
    stage: JobStage
    status: JobStatus
    progress: float
    message: str | None


# ── tracking document ──────────────────────────────────────────────────


class TrackingBall(_Outbound):
    x: float
    y: float
    z: float = 0.0


class TrackingPlayer(_Outbound):
    playerId: Id
    teamId: Id
    x: float
    y: float


class TrackingFrame(_Outbound):
    period: int
    t: float
    ball: TrackingBall | None
    players: list[TrackingPlayer]


class TrackingMeta(_Outbound):
    matchId: Id
    fps: float
    frameCount: int
    homeTeamId: Id
    awayTeamId: Id
    homeAttacksRight: list[bool]  # index = period - 1
    source: Literal["cv", "simulation", "gps"]


class TrackingDocument(_Outbound):
    meta: TrackingMeta
    frames: list[TrackingFrame]
