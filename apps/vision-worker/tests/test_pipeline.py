"""End-to-end orchestration with fakes: no model, no network, no GPU."""

from __future__ import annotations

import threading
from collections.abc import Iterator, Sequence
from pathlib import Path

import numpy as np
import pytest

from vision_worker.contracts import (
    PITCH_LENGTH,
    PITCH_WIDTH,
    EventsJobPayload,
    VisionJobPayload,
)
from vision_worker.detection import BALL, PERSON, FrameDetections
from vision_worker.pipeline import JobCancelledError, PipelineConfig, VisionPipeline
from vision_worker.progress import RecordingProgress
from vision_worker.storage import deserialise_tracking
from vision_worker.tracking import IouTracker
from vision_worker.video import SampledFrame

W, H = 1050, 680  # 10 px per metre, top-down camera
N_FRAMES = 40
FPS = 5.0
RED, BLUE, YELLOW = (30, 30, 200), (200, 60, 20), (0, 230, 230)  # BGR kits


def _px(x_m: float, y_m: float) -> tuple[float, float]:
    """Pitch metres -> pixel for the synthetic top-down camera (y up on the pitch)."""
    return x_m * 10.0, (PITCH_WIDTH - y_m) * 10.0


def _scene(i: int) -> list[tuple[str, float, float, tuple[int, int, int]]]:
    """Ground-truth people: (label, x_m, y_m, colour). Home=red on the left, away=blue."""
    drift = i * 0.2
    people = []
    for k in range(5):
        people.append((f"r{k}", 15.0 + k * 6 + drift, 10.0 + k * 11, RED))
        people.append((f"b{k}", 60.0 + k * 6 - drift, 10.0 + k * 11, BLUE))
    people.append(("ref", 52.0, 60.0, YELLOW))
    return people


def _box(x_m: float, y_m: float) -> list[float]:
    fx, fy = _px(x_m, y_m)
    return [fx - 15, fy - 80, fx + 15, fy]  # 30x80 px person, feet at (fx, fy)


class FakeVideo:
    def __init__(self, path: Path, target_fps: float) -> None:
        assert path.exists()
        self.closed = False

    fps = FPS
    size = (W, H)
    expected_frames = N_FRAMES

    def frames(self) -> Iterator[SampledFrame]:
        for i in range(N_FRAMES):
            img = np.full((H, W, 3), (40, 160, 40), dtype=np.uint8)
            for _, x, y, colour in _scene(i):
                x1, y1, x2, y2 = (int(v) for v in _box(x, y))
                img[max(0, y1) : y2, max(0, x1) : x2] = colour
            # frame index is encoded in the corner so the fake detector stays stateless
            img[0, 0, 0] = i
            yield SampledFrame(index=i, t=i / FPS, image=img)

    def close(self) -> None:
        self.closed = True


class FakeDetector:
    def __init__(self) -> None:
        self.calls = 0

    def detect(self, images: Sequence[np.ndarray]) -> list[FrameDetections]:
        self.calls += 1
        out = []
        for img in images:
            i = int(img[0, 0, 0])
            boxes = [_box(x, y) for _, x, y, _ in _scene(i)]
            cls = [PERSON] * len(boxes)
            if i % 4 != 1:  # ball missing every 4th frame -> exercised by interpolation
                bx, by = _px(30.0 + i, 34.0)
                boxes.append([bx - 5, by - 5, bx + 5, by + 5])
                cls.append(BALL)
            out.append(
                FrameDetections(
                    np.array(boxes, np.float32),
                    np.full(len(boxes), 0.9, np.float32),
                    np.array(cls, np.int32),
                )
            )
        return out


class FakeStore:
    def __init__(self) -> None:
        self.uploads: dict[str, tuple[bytes, str]] = {}

    def download(self, key: str, dest: Path) -> None:
        dest.write_bytes(b"fake video")

    def upload(self, key: str, data: bytes, content_type: str) -> None:
        self.uploads[key] = (data, content_type)


def _calibration():
    # Exact calibration for the synthetic top-down camera.
    corners = [(0.0, 0.0), (PITCH_LENGTH, 0.0), (0.0, PITCH_WIDTH), (PITCH_LENGTH, PITCH_WIDTH)]
    return [{"px": _px(x, y)[0], "py": _px(x, y)[1], "x": x, "y": y} for x, y in corners]


def _payload(calibration=True) -> VisionJobPayload:
    return VisionJobPayload.model_validate(
        {
            "jobId": "job-1",
            "matchId": "m-1",
            "videoKey": "videos/m-1.mp4",
            "homeTeamId": "home",
            "awayTeamId": "away",
            "calibration": _calibration() if calibration else None,
        }
    )


def _pipeline(store, enqueued, cancel=None, detector=None):
    return VisionPipeline(
        store=store,
        detector=detector or FakeDetector(),
        tracker_factory=IouTracker,
        video_opener=FakeVideo,
        enqueue=enqueued.append,
        config=PipelineConfig(target_fps=FPS, batch_size=8, home_kit="lighter"),
        cancel=cancel,
    )


def test_pipeline_produces_contract_document_and_enqueues_events():
    store, enqueued, progress = FakeStore(), [], RecordingProgress()
    result = _pipeline(store, enqueued).run(_payload(), progress)

    # upload
    assert result.tracking_key == "tracking/m-1.json.gz"
    blob, ctype = store.uploads["tracking/m-1.json.gz"]
    assert ctype == "application/gzip"
    doc = deserialise_tracking(blob)

    # meta
    assert doc.meta.matchId == "m-1"
    assert doc.meta.source == "cv"
    assert doc.meta.frameCount == N_FRAMES == len(doc.frames)
    assert doc.meta.fps == FPS
    assert doc.meta.homeAttacksRight == [True]  # home (red) starts on the left
    assert result.calibrated

    # teams: red is lighter in L* than navy-ish blue here -> home_kit="lighter" picks red.
    f0 = doc.frames[0]
    assert len(f0.players) == 10  # referee filtered as colour outlier
    home = [p for p in f0.players if p.teamId == "home"]
    away = [p for p in f0.players if p.teamId == "away"]
    assert len(home) == 5 and len(away) == 5
    assert all(p.x < 52.5 for p in home) and all(p.x > 52.5 for p in away)
    assert all(p.playerId.startswith("home-trk-") for p in home)

    # positions: calibrated homography recovers ground truth within a pixel (0.1 m)
    gt = sorted((x, y) for lbl, x, y, _ in _scene(0) if lbl.startswith("r") and lbl != "ref")
    got = sorted((p.x, p.y) for p in home)
    np.testing.assert_allclose(got, gt, atol=0.11)

    # identities are stable across frames
    ids_first = {p.playerId for p in doc.frames[0].players}
    ids_last = {p.playerId for p in doc.frames[-1].players}
    assert ids_first == ids_last

    # ball gaps (every 4th frame) are interpolated
    assert all(f.ball is not None for f in doc.frames[:-1])
    assert doc.frames[1].ball.x == pytest.approx(31.0, abs=0.11)

    # hand-off + progress
    assert enqueued == [
        EventsJobPayload(jobId="job-1", matchId="m-1", trackingKey=result.tracking_key)
    ]
    stages = [(s, st) for s, st, _, _ in progress.events]
    for stage in ("ingest", "detect", "track"):
        assert (stage, "running") in stages
        assert (stage, "completed") in stages
    assert stages[-1] == ("track", "completed")
    assert all(0.0 <= p <= 1.0 for _, _, p, _ in progress.events)


def test_pipeline_uncalibrated_uses_heuristic_and_still_validates():
    store, enqueued, progress = FakeStore(), [], RecordingProgress()
    result = _pipeline(store, enqueued).run(_payload(calibration=False), progress)
    assert not result.calibrated
    doc = deserialise_tracking(store.uploads[result.tracking_key][0])
    for f in doc.frames:
        for p in f.players:
            assert 0 <= p.x <= PITCH_LENGTH and 0 <= p.y <= PITCH_WIDTH
    assert "uncalibrated" in (progress.events[-1][3] or "")


def test_pipeline_failure_publishes_failed_and_reraises():
    class Boom:
        def detect(self, images):
            raise RuntimeError("cuda oom")

    store, enqueued, progress = FakeStore(), [], RecordingProgress()
    with pytest.raises(RuntimeError, match="cuda oom"):
        _pipeline(store, enqueued, detector=Boom()).run(_payload(), progress)
    stage, status, _, msg = progress.events[-1]
    assert (stage, status) == ("detect", "failed")
    assert "cuda oom" in msg
    assert not store.uploads and not enqueued


def test_pipeline_honours_cancellation():
    cancel = threading.Event()
    cancel.set()
    store, enqueued, progress = FakeStore(), [], RecordingProgress()
    with pytest.raises(JobCancelledError):
        _pipeline(store, enqueued, cancel=cancel).run(_payload(), progress)
    assert progress.events[-1][1] == "failed"
