"""Pure orchestration of the CV pipeline.

    ingest ─▶ detect ─▶ track (+ teams, homography, document, upload, hand-off)

Every collaborator (object store, detector, tracker, video decoder, analytics enqueue,
progress sink) is injected, so the whole flow is unit-testable with fakes and no models,
network or GPU. ``main.py`` wires the real implementations.

The pipeline is synchronous and CPU/GPU-bound; the worker runs it in a thread so the
asyncio loop stays free to renew the BullMQ job lock.
"""

from __future__ import annotations

import tempfile
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import structlog

from .contracts import (
    EventsJobPayload,
    JobStage,
    TrackingBall,
    TrackingDocument,
    TrackingFrame,
    TrackingMeta,
    TrackingPlayer,
    VisionJobPayload,
)
from .detection import BALL, PERSON, Detector, FrameDetections
from .homography import Homography, clamp_to_pitch, foot_points, on_pitch_mask
from .progress import ProgressReporter
from .storage import ObjectStore, serialise_tracking, tracking_key
from .teams import assign_teams, home_cluster, torso_color
from .tracking import BallTracker, Point2, TrackerFactory, interpolate_gaps
from .video import VideoSource

if TYPE_CHECKING:
    from .config import Settings

log = structlog.get_logger(__name__)

VideoOpener = Callable[[Path, float], VideoSource]
EnqueueFn = Callable[[EventsJobPayload], None]

HOME, AWAY = 0, 1


class JobCancelledError(RuntimeError):
    """Raised when the worker is shutting down mid-job; BullMQ will retry the job."""


@dataclass(frozen=True)
class PipelineConfig:
    target_fps: float = 5.0
    batch_size: int = 8
    ball_max_gap_s: float = 1.0
    min_track_frames: int = 3
    offpitch_margin_m: float = 5.0
    home_kit: str = "darker"
    period_split_min: float = 50.0
    work_dir: Path | None = None

    @classmethod
    def from_settings(cls, s: Settings) -> PipelineConfig:
        return cls(
            target_fps=s.vision_fps,
            batch_size=s.vision_batch,
            ball_max_gap_s=s.vision_ball_max_gap_s,
            min_track_frames=s.vision_min_track_frames,
            offpitch_margin_m=s.vision_offpitch_margin_m,
            home_kit=s.vision_home_kit,
            period_split_min=s.vision_period_split_min,
            work_dir=s.vision_work_dir,
        )


@dataclass(frozen=True)
class PipelineResult:
    tracking_key: str
    frame_count: int
    fps: float
    player_ids: int
    calibrated: bool


@dataclass
class _FrameObs:
    t: float
    persons: FrameDetections
    colors: np.ndarray  # (n_persons, 3) Lab; NaN rows where crop unusable
    balls: FrameDetections


# ── pure helpers (unit-tested directly) ────────────────────────────────


def assign_periods(times: Sequence[float], fps: float, split_after_min: float) -> list[int]:
    """Single period, unless the footage is longer than ``split_after_min`` minutes, in which
    case it's assumed to be a full match and split at the midpoint.
    TODO: detect half-time from a long gap / scene cut instead of the midpoint."""
    if not times:
        return []
    duration = times[-1] + 1.0 / fps
    if duration <= split_after_min * 60.0:
        return [1] * len(times)
    mid = duration / 2.0
    return [1 if t < mid else 2 for t in times]


def infer_home_attacks_right(
    periods: Sequence[int],
    times: Sequence[float],
    home_x: Sequence[list[float]],
    away_x: Sequence[list[float]],
    window_s: float = 60.0,
) -> list[bool]:
    """Per period: at kick-off each side stands in its own half, so the team with the smaller
    mean x in the period's first minute defends the left goal, i.e. attacks right."""
    n_periods = max(periods) if periods else 1
    result: list[bool] = []
    for p in range(1, n_periods + 1):
        idx = [i for i, q in enumerate(periods) if q == p]
        start = times[idx[0]] if idx else 0.0
        decided: bool | None = None
        for window in (window_s, float("inf")):  # first minute; fall back to whole period
            hx = [x for i in idx if times[i] - start < window for x in home_x[i]]
            ax = [x for i in idx if times[i] - start < window for x in away_x[i]]
            if hx and ax:
                decided = float(np.mean(hx)) < float(np.mean(ax))
                break
        if decided is None:  # no evidence: default, sides switch at half-time
            decided = True if p == 1 else not result[-1]
        result.append(decided)
    return result


def project_players(
    hom: Homography,
    xyxy: np.ndarray,
    track_ids: np.ndarray,
    side_of: dict[int, int],
    margin_m: float,
) -> list[tuple[int, int, float, float]]:
    """Team-assigned tracks -> ``(track_id, side, x, y)`` in pitch metres. Points projected
    more than ``margin_m`` off the pitch are dropped (bench, staff, crowd); the rest are
    clamped onto the pitch."""
    keep = np.array([int(t) in side_of for t in track_ids], dtype=bool)
    if not keep.any():
        return []
    xy = hom.project(foot_points(xyxy[keep]))
    ok = on_pitch_mask(xy, margin_m)
    xy = clamp_to_pitch(xy)
    return [
        (int(tid), side_of[int(tid)], float(p[0]), float(p[1]))
        for tid, p, good in zip(track_ids[keep], xy, ok, strict=True)
        if good
    ]


def project_ball(hom: Homography, b: Point2 | None, margin_m: float) -> Point2 | None:
    """Assumes the ball is on the ground (z=0): lofted balls project too far from camera.
    TODO: estimate height from apparent size / parabolic fit to fill ``ball.z``."""
    if b is None:
        return None
    p = hom.project(np.array([b]))
    if not on_pitch_mask(p, margin_m)[0]:
        return None
    c = clamp_to_pitch(p)[0]
    return float(c[0]), float(c[1])


def build_tracking_document(
    *,
    match_id: str,
    home_team_id: str,
    away_team_id: str,
    fps: float,
    times: Sequence[float],
    players: Sequence[Sequence[tuple[int, int, float, float]]],
    ball: Sequence[Point2 | None],
    period_split_min: float = 50.0,
) -> TrackingDocument:
    """Assemble the contract document.

    ``players[i]`` = ``[(track_id, side, x, y), ...]`` for frame i, side ∈ {HOME, AWAY},
    coordinates already in pitch metres.

    Identity: track ids become synthetic ``{teamId}-trk-{n}`` ids, numbered per team by
    first appearance. TODO(identity): replace with jersey-number OCR + roster matching so
    ids are real player ids and survive track fragmentation.
    """
    team_ids = {HOME: home_team_id, AWAY: away_team_id}
    synthetic: dict[int, str] = {}
    counters = {HOME: 0, AWAY: 0}
    periods = assign_periods(times, fps, period_split_min)
    # Frame `t` is seconds since the start of its period (matches MatchEvent.t).
    period_start: dict[int, float] = {}
    for t, p in zip(times, periods, strict=True):
        period_start.setdefault(p, float(t))

    frames: list[TrackingFrame] = []
    home_x: list[list[float]] = []
    away_x: list[list[float]] = []
    for i, t in enumerate(times):
        out_players: list[TrackingPlayer] = []
        hx: list[float] = []
        ax: list[float] = []
        for track_id, side, x, y in players[i]:
            pid = synthetic.get(track_id)
            if pid is None:
                counters[side] += 1
                pid = f"{team_ids[side]}-trk-{counters[side]}"
                synthetic[track_id] = pid
            out_players.append(
                TrackingPlayer(playerId=pid, teamId=team_ids[side], x=round(x, 2), y=round(y, 2))
            )
            (hx if side == HOME else ax).append(x)
        home_x.append(hx)
        away_x.append(ax)
        b = ball[i]
        frames.append(
            TrackingFrame(
                period=periods[i],
                t=round(float(t) - period_start[periods[i]], 3),
                ball=TrackingBall(x=round(b[0], 2), y=round(b[1], 2), z=0.0) if b else None,
                players=out_players,
            )
        )

    meta = TrackingMeta(
        matchId=match_id,
        fps=round(float(fps), 4),
        frameCount=len(frames),
        homeTeamId=home_team_id,
        awayTeamId=away_team_id,
        homeAttacksRight=infer_home_attacks_right(periods, times, home_x, away_x),
        source="cv",
    )
    return TrackingDocument(meta=meta, frames=frames)


# ── orchestration ──────────────────────────────────────────────────────


class VisionPipeline:
    def __init__(
        self,
        *,
        store: ObjectStore,
        detector: Detector,
        tracker_factory: TrackerFactory,
        video_opener: VideoOpener,
        enqueue: EnqueueFn,
        config: PipelineConfig | None = None,
        cancel: threading.Event | None = None,
    ) -> None:
        self.store = store
        self.detector = detector
        self.tracker_factory = tracker_factory
        self.video_opener = video_opener
        self.enqueue = enqueue
        self.config = config or PipelineConfig()
        self.cancel = cancel or threading.Event()

    def _check_cancel(self) -> None:
        if self.cancel.is_set():
            raise JobCancelledError("worker shutting down")

    def run(self, payload: VisionJobPayload, progress: ProgressReporter) -> PipelineResult:
        stage: JobStage = "ingest"
        log_ = log.bind(job_id=payload.jobId, match_id=payload.matchId)
        try:
            with tempfile.TemporaryDirectory(dir=self.config.work_dir) as tmp:
                # 1. ingest
                progress.report("ingest", "running", 0.0, f"downloading {payload.videoKey}")
                video_path = Path(tmp) / Path(payload.videoKey).name
                self.store.download(payload.videoKey, video_path)
                progress.report("ingest", "completed", 1.0, None)
                log_.info("ingested", key=payload.videoKey)

                # 2. detect
                stage = "detect"
                progress.report("detect", "running", 0.0, None)
                source = self.video_opener(video_path, self.config.target_fps)
                try:
                    obs = self._detect(source, progress)
                    fps, (width, height) = source.fps, source.size
                finally:
                    source.close()
                if not obs:
                    raise ValueError("video contains no decodable frames")
                progress.report("detect", "completed", 1.0, f"{len(obs)} frames @ {fps:.2f} fps")
                log_.info("detected", frames=len(obs), fps=fps)

            # 3. track (+ teams, homography, document, upload, hand-off)
            stage = "track"
            progress.report("track", "running", 0.0, None)
            doc, calibrated = self._track(payload, obs, fps, (width, height), progress)
            key = tracking_key(payload.matchId)
            self.store.upload(key, serialise_tracking(doc), "application/gzip")
            progress.report("track", "running", 0.95, f"uploaded {key}")
            self.enqueue(
                EventsJobPayload(jobId=payload.jobId, matchId=payload.matchId, trackingKey=key)
            )
            n_ids = len({p.playerId for f in doc.frames for p in f.players})
            msg = f"{doc.meta.frameCount} frames, {n_ids} player tracks" + (
                "" if calibrated else " (uncalibrated: heuristic homography)"
            )
            progress.report("track", "completed", 1.0, msg)
            log_.info("tracked", key=key, frames=doc.meta.frameCount, ids=n_ids)
            return PipelineResult(key, doc.meta.frameCount, fps, n_ids, calibrated)
        except Exception as exc:
            progress.report(stage, "failed", 0.0, f"{type(exc).__name__}: {exc}"[:500])
            raise

    def _detect(self, source: VideoSource, progress: ProgressReporter) -> list[_FrameObs]:
        obs: list[_FrameObs] = []
        expected = max(1, source.expected_frames)
        batch: list[tuple[float, np.ndarray]] = []

        def flush() -> None:
            dets = self.detector.detect([img for _, img in batch])
            for (t, img), d in zip(batch, dets, strict=True):
                persons = d.of_class(PERSON)
                colors = np.full((len(persons), 3), np.nan, dtype=np.float32)
                for k, box in enumerate(persons.xyxy):
                    c = torso_color(img, box)
                    if c is not None:
                        colors[k] = c
                obs.append(_FrameObs(t, persons, colors, d.of_class(BALL)))
            batch.clear()
            progress.report("detect", "running", min(0.99, len(obs) / expected), None)

        for frame in source.frames():
            self._check_cancel()
            batch.append((frame.t, frame.image))
            if len(batch) >= self.config.batch_size:
                flush()
        if batch:
            flush()
        return obs

    def _track(
        self,
        payload: VisionJobPayload,
        obs: list[_FrameObs],
        fps: float,
        size: tuple[int, int],
        progress: ProgressReporter,
    ) -> tuple[TrackingDocument, bool]:
        cfg = self.config
        n = len(obs)

        # 3a. tracking in pixel space
        tracker = self.tracker_factory(fps)
        ball_tracker = BallTracker()
        frame_ids: list[np.ndarray] = []
        ball_px: list[Point2 | None] = []
        track_colors: dict[int, list[np.ndarray]] = {}
        for i, o in enumerate(obs):
            if i % 50 == 0:
                self._check_cancel()
                progress.report("track", "running", 0.5 * i / n, None)
            ids = tracker.update(o.persons)
            frame_ids.append(ids)
            for k, tid in enumerate(ids):
                if tid >= 0 and not np.isnan(o.colors[k, 0]):
                    track_colors.setdefault(int(tid), []).append(o.colors[k])
            ball_px.append(ball_tracker.update(o.balls))

        # 3b. team assignment over tracks seen long enough
        median_colors = {
            tid: np.median(np.stack(cs), axis=0)
            for tid, cs in track_colors.items()
            if len(cs) >= cfg.min_track_frames
        }
        teams = assign_teams(median_colors, {t: len(track_colors[t]) for t in median_colors})
        home_c = home_cluster(teams.centroids, cfg.home_kit)
        side_of = {tid: HOME if c == home_c else AWAY for tid, c in teams.labels.items()}
        progress.report(
            "track",
            "running",
            0.6,
            f"{len(side_of)} tracks assigned, {len(teams.outliers)} outliers (refs/keepers)",
        )

        # 3c. homography + projection
        calibrated = payload.calibration is not None
        if payload.calibration is not None:
            hom = Homography.from_calibration(payload.calibration)
        else:
            hom = Homography.broadcast_heuristic(*size)
            log.warning("no_calibration_using_broadcast_heuristic", job_id=payload.jobId)

        players = [
            project_players(hom, o.persons.xyxy, ids, side_of, cfg.offpitch_margin_m)
            for o, ids in zip(obs, frame_ids, strict=True)
        ]
        ball_xy = [project_ball(hom, b, cfg.offpitch_margin_m) for b in ball_px]
        ball_xy = interpolate_gaps(ball_xy, max_gap=max(0, round(cfg.ball_max_gap_s * fps)))
        progress.report("track", "running", 0.8, None)

        doc = build_tracking_document(
            match_id=payload.matchId,
            home_team_id=payload.homeTeamId,
            away_team_id=payload.awayTeamId,
            fps=fps,
            times=[o.t for o in obs],
            players=players,
            ball=ball_xy,
            period_split_min=cfg.period_split_min,
        )
        return doc, calibrated
