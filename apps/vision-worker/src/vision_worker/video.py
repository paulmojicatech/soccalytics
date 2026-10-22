"""Video decoding with temporal down-sampling to a target fps."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np


@dataclass(frozen=True)
class SampledFrame:
    index: int  # index among *sampled* frames (0..n-1)
    t: float  # seconds since start of video
    image: np.ndarray  # BGR, HxWx3 uint8


class VideoSource(Protocol):
    @property
    def fps(self) -> float:
        """Effective (sampled) frame rate."""
        ...

    @property
    def size(self) -> tuple[int, int]:
        """(width, height) in pixels."""
        ...

    @property
    def expected_frames(self) -> int:
        """Best-effort estimate of sampled frame count (for progress)."""
        ...

    def frames(self) -> Iterator[SampledFrame]: ...

    def close(self) -> None: ...


def sampling_stride(source_fps: float, target_fps: float) -> int:
    if source_fps <= 0:
        return 1
    return max(1, round(source_fps / target_fps))


class OpenCVVideoSource:
    """Decodes with OpenCV; skipped frames are ``grab()``-ed (no colour conversion = cheap)."""

    def __init__(self, path: Path, target_fps: float) -> None:
        import cv2

        self._cv2 = cv2
        self._cap = cv2.VideoCapture(str(path))
        if not self._cap.isOpened():
            raise ValueError(f"cannot open video: {path}")
        src_fps = float(self._cap.get(cv2.CAP_PROP_FPS) or 0.0)
        self._src_fps = src_fps if src_fps > 0 else 25.0
        self._stride = sampling_stride(self._src_fps, target_fps)
        self._total = int(self._cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        self._size = (
            int(self._cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(self._cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        )

    @property
    def fps(self) -> float:
        return self._src_fps / self._stride

    @property
    def size(self) -> tuple[int, int]:
        return self._size

    @property
    def expected_frames(self) -> int:
        return max(1, self._total // self._stride)

    def frames(self) -> Iterator[SampledFrame]:
        raw_idx = 0
        out_idx = 0
        while True:
            if raw_idx % self._stride == 0:
                ok, img = self._cap.read()
                if not ok:
                    return
                yield SampledFrame(index=out_idx, t=raw_idx / self._src_fps, image=img)
                out_idx += 1
            elif not self._cap.grab():
                return
            raw_idx += 1

    def close(self) -> None:
        self._cap.release()
