"""Image-plane -> pitch-plane projection (metres on a 105 x 68 pitch).

Pitch frame (matches libs/contracts/src/lib/common.ts):

    (0,68) ┌──────────────────────┐ (105,68)      far touchline  = top of the image
           │                      │
     (0,0) └──────────────────────┘ (105,0)       near touchline = bottom of the image

Two modes:

* **Calibrated** — the job payload carries 4 pixel->pitch correspondences; we solve the
  exact planar homography with ``cv2.findHomography``. Correct for a *static* camera.
* **Heuristic fallback** — no calibration: assume a static, centred, broadcast "main
  camera" wide shot that shows the full pitch length, with the far touchline ~30% down the
  frame and the near touchline at the bottom edge. This is a crude prior: absolute positions
  can be off by 10+ metres, and any pan/zoom invalidates it. It keeps the pipeline end-to-end
  for demo footage; real deployments must calibrate (see README "Next steps": pitch keypoint
  model for per-frame automatic calibration).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from .contracts import PITCH_LENGTH, PITCH_WIDTH, CalibrationPoint


@dataclass(frozen=True)
class Homography:
    matrix: np.ndarray  # 3x3, pixel -> pitch metres
    calibrated: bool

    @classmethod
    def from_correspondences(
        cls, pixels: np.ndarray, pitch: np.ndarray, calibrated: bool = True
    ) -> Homography:
        import cv2

        src = np.asarray(pixels, dtype=np.float64).reshape(-1, 2)
        dst = np.asarray(pitch, dtype=np.float64).reshape(-1, 2)
        if len(src) < 4:
            raise ValueError("need at least 4 point correspondences")
        if _has_collinear_triple(src) or _has_collinear_triple(dst):
            raise ValueError("degenerate calibration: 3 or more points are collinear")
        # Exactly 4 points: direct solve (method 0). More: RANSAC for robustness.
        method = 0 if len(src) == 4 else cv2.RANSAC
        h, _ = cv2.findHomography(src, dst, method)
        if h is None or not np.all(np.isfinite(h)):
            raise ValueError("degenerate calibration (collinear points?)")
        return cls(h, calibrated)

    @classmethod
    def from_calibration(cls, points: Sequence[CalibrationPoint]) -> Homography:
        px = np.array([[p.px, p.py] for p in points])
        pitch = np.array([[p.x, p.y] for p in points])
        return cls.from_correspondences(px, pitch, calibrated=True)

    @classmethod
    def broadcast_heuristic(cls, width: int, height: int) -> Homography:
        w, h = float(width), float(height)
        pixels = np.array(
            [
                [0.15 * w, 0.30 * h],  # far-left corner
                [0.85 * w, 0.30 * h],  # far-right corner
                [-0.25 * w, 1.00 * h],  # near-left corner (outside the frame: perspective)
                [1.25 * w, 1.00 * h],  # near-right corner
            ]
        )
        pitch = np.array(
            [[0.0, PITCH_WIDTH], [PITCH_LENGTH, PITCH_WIDTH], [0.0, 0.0], [PITCH_LENGTH, 0.0]]
        )
        return cls.from_correspondences(pixels, pitch, calibrated=False)

    def project(self, pts: np.ndarray) -> np.ndarray:
        """Project Nx2 pixel points to Nx2 pitch metres (unclamped)."""
        pts = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
        if len(pts) == 0:
            return np.zeros((0, 2))
        homog = np.hstack([pts, np.ones((len(pts), 1))]) @ self.matrix.T
        w = homog[:, 2:3]
        w = np.where(np.abs(w) < 1e-12, 1e-12, w)
        return homog[:, :2] / w


def _has_collinear_triple(pts: np.ndarray, rel_eps: float = 1e-3) -> bool:
    """True if any 3 points are (nearly) collinear — a homography is then ill-posed."""
    from itertools import combinations

    scale = max(float(np.ptp(pts, axis=0).max()), 1e-9) ** 2
    for a, b, c in combinations(pts[:4], 3):
        area2 = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        if area2 < rel_eps * scale:
            return True
    return False


def foot_points(xyxy: np.ndarray) -> np.ndarray:
    """Bottom-centre of each box: the ground-contact point, which lies on the pitch plane."""
    xyxy = np.asarray(xyxy, dtype=np.float64).reshape(-1, 4)
    return np.stack([(xyxy[:, 0] + xyxy[:, 2]) / 2, xyxy[:, 3]], axis=1)


def on_pitch_mask(xy: np.ndarray, margin: float) -> np.ndarray:
    """True for points within ``margin`` metres of the pitch (others: crowd, bench, staff)."""
    return (
        (xy[:, 0] >= -margin)
        & (xy[:, 0] <= PITCH_LENGTH + margin)
        & (xy[:, 1] >= -margin)
        & (xy[:, 1] <= PITCH_WIDTH + margin)
    )


def clamp_to_pitch(xy: np.ndarray) -> np.ndarray:
    out = np.array(xy, dtype=np.float64, copy=True).reshape(-1, 2)
    out[:, 0] = np.clip(out[:, 0], 0.0, PITCH_LENGTH)
    out[:, 1] = np.clip(out[:, 1], 0.0, PITCH_WIDTH)
    return out
