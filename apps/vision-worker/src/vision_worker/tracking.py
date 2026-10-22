"""Multi-object tracking: persistent ids for players, single-target tracking for the ball.

Trackers expose one tiny interface — ``update(person_detections) -> track ids aligned with
the input rows`` (``-1`` = not confirmed this frame) — so the pipeline doesn't care whether
ids come from supervision's ByteTrack or the dependency-free ``IouTracker`` fallback.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
import structlog

from .detection import FrameDetections

log = structlog.get_logger(__name__)

Point2 = tuple[float, float]


class PlayerTracker(Protocol):
    def update(self, persons: FrameDetections) -> np.ndarray:
        """Return int track ids aligned with ``persons`` rows; -1 where untracked."""
        ...


TrackerFactory = Callable[[float], PlayerTracker]  # fps -> fresh tracker (one per job)


def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), dtype=np.float32)
    x1 = np.maximum(a[:, None, 0], b[None, :, 0])
    y1 = np.maximum(a[:, None, 1], b[None, :, 1])
    x2 = np.minimum(a[:, None, 2], b[None, :, 2])
    y2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(x2 - x1, 0, None) * np.clip(y2 - y1, 0, None)
    area_a = (a[:, 2] - a[:, 0]) * (a[:, 3] - a[:, 1])
    area_b = (b[:, 2] - b[:, 0]) * (b[:, 3] - b[:, 1])
    return inter / np.maximum(area_a[:, None] + area_b[None, :] - inter, 1e-9)


class ByteTrackPlayerTracker:
    """supervision's ByteTrack (Kalman + two-stage association on high/low-conf boxes)."""

    def __init__(self, fps: float, lost_track_buffer_s: float = 2.0) -> None:
        import supervision as sv

        self._sv = sv
        frame_rate = max(1, round(fps))
        buffer = max(1, round(lost_track_buffer_s * fps))
        try:
            self._bt = sv.ByteTrack(frame_rate=frame_rate, lost_track_buffer=buffer)
        except TypeError:  # older supervision API
            self._bt = sv.ByteTrack(frame_rate=frame_rate, track_buffer=buffer)

    def update(self, persons: FrameDetections) -> np.ndarray:
        n = len(persons)
        ids = np.full(n, -1, dtype=np.int64)
        dets = self._sv.Detections(
            xyxy=persons.xyxy.astype(np.float32),
            confidence=persons.conf.astype(np.float32),
            class_id=np.zeros(n, dtype=int),
            data={"det_idx": np.arange(n)},
        )
        tracked = self._bt.update_with_detections(dets)
        if len(tracked) == 0 or tracked.tracker_id is None:
            return ids
        if "det_idx" in tracked.data:
            idx = np.asarray(tracked.data["det_idx"], dtype=int)
        else:  # fall back to IoU re-association if the version drops custom data
            idx = iou_matrix(tracked.xyxy, persons.xyxy).argmax(axis=1)
        ids[idx] = tracked.tracker_id
        return ids


class IouTracker:
    """Greedy IoU tracker. No motion model: used when supervision isn't installed and in tests."""

    def __init__(self, fps: float = 5.0, iou_threshold: float = 0.3, max_age_s: float = 1.0):
        self._thr = iou_threshold
        self._max_age = max(1, round(max_age_s * fps))
        self._next_id = 1
        self._tracks: dict[int, tuple[np.ndarray, int]] = {}  # id -> (box, age)

    def update(self, persons: FrameDetections) -> np.ndarray:
        ids = np.full(len(persons), -1, dtype=np.int64)
        track_ids = list(self._tracks)
        boxes = (
            np.stack([self._tracks[t][0] for t in track_ids])
            if track_ids
            else np.zeros((0, 4), dtype=np.float32)
        )
        iou = iou_matrix(persons.xyxy, boxes)
        used: set[int] = set()
        # Greedy assignment in descending IoU.
        for flat in np.argsort(-iou, axis=None):
            d, t = divmod(int(flat), max(1, len(track_ids)))
            if iou.size == 0 or iou[d, t] < self._thr:
                break
            if ids[d] != -1 or t in used:
                continue
            ids[d] = track_ids[t]
            used.add(t)
        new_tracks: dict[int, tuple[np.ndarray, int]] = {}
        for d in range(len(ids)):
            if ids[d] == -1:
                ids[d] = self._next_id
                self._next_id += 1
            new_tracks[int(ids[d])] = (persons.xyxy[d].copy(), 0)
        for i, tid in enumerate(track_ids):
            if i not in used:
                box, age = self._tracks[tid]
                if age + 1 <= self._max_age:
                    new_tracks[tid] = (box, age + 1)
        self._tracks = new_tracks
        return ids


def default_tracker_factory(fps: float) -> PlayerTracker:
    try:
        return ByteTrackPlayerTracker(fps)
    except ImportError:
        log.warning("supervision_unavailable_using_iou_tracker")
        return IouTracker(fps)


# ── ball ───────────────────────────────────────────────────────────────


def box_center(xyxy: np.ndarray) -> np.ndarray:
    return np.stack([(xyxy[:, 0] + xyxy[:, 2]) / 2, (xyxy[:, 1] + xyxy[:, 3]) / 2], axis=1)


@dataclass
class BallTracker:
    """Single-target ball tracker in pixel space.

    Picks the candidate closest to the last known position (within ``max_jump_px`` per
    missed frame) to suppress false positives such as heads or penalty spots; otherwise
    the most confident candidate. Gaps are filled later, in pitch space, by
    :func:`interpolate_gaps`.
    """

    max_jump_px: float = 120.0
    max_coast_frames: int = 10
    _last: np.ndarray | None = None
    _missed: int = 0

    def update(self, balls: FrameDetections) -> Point2 | None:
        if len(balls) == 0:
            self._missed += 1
            if self._missed > self.max_coast_frames:
                self._last = None
            return None
        centers = box_center(balls.xyxy)
        choice: int | None = None
        if self._last is not None:
            dist = np.linalg.norm(centers - self._last, axis=1)
            j = int(dist.argmin())
            if dist[j] <= self.max_jump_px * (self._missed + 1):
                choice = j
        if choice is None:
            if self._last is not None and self._missed == 0:
                # Confident lock but every candidate is implausibly far: treat as noise.
                self._missed += 1
                return None
            choice = int(balls.conf.argmax())
        self._last = centers[choice]
        self._missed = 0
        return float(centers[choice][0]), float(centers[choice][1])


def interpolate_gaps(seq: Sequence[Point2 | None], max_gap: int) -> list[Point2 | None]:
    """Linearly interpolate interior ``None`` runs of length <= ``max_gap``.

    Leading/trailing gaps and longer gaps (ball genuinely out of view) stay ``None``.
    """
    out: list[Point2 | None] = list(seq)
    n = len(out)
    i = 0
    while i < n:
        if out[i] is not None:
            i += 1
            continue
        start = i
        while i < n and out[i] is None:
            i += 1
        gap = i - start
        if start == 0 or i == n or gap > max_gap:
            continue
        a, b = out[start - 1], out[i]
        assert a is not None and b is not None
        for k in range(gap):
            f = (k + 1) / (gap + 1)
            out[start + k] = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
    return out
