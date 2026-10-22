import numpy as np
import pytest

from vision_worker.contracts import CalibrationPoint
from vision_worker.homography import (
    Homography,
    clamp_to_pitch,
    foot_points,
    on_pitch_mask,
)


def _calib() -> list[CalibrationPoint]:
    # A synthetic camera: pitch corners seen as a trapezoid in a 1920x1080 frame.
    return [
        CalibrationPoint(px=400, py=300, x=0, y=68),
        CalibrationPoint(px=1520, py=300, x=105, y=68),
        CalibrationPoint(px=0, py=1000, x=0, y=0),
        CalibrationPoint(px=1920, py=1000, x=105, y=0),
    ]


def test_calibration_points_map_exactly():
    h = Homography.from_calibration(_calib())
    px = np.array([[p.px, p.py] for p in _calib()])
    expected = np.array([[p.x, p.y] for p in _calib()])
    np.testing.assert_allclose(h.project(px), expected, atol=1e-6)
    assert h.calibrated


def test_projection_preserves_straight_lines_and_centre():
    h = Homography.from_calibration(_calib())
    # Projective maps preserve incidence: the intersection of the image diagonals of the
    # pitch trapezoid must land on the pitch centre.
    a1, a2 = np.array([400, 300.0]), np.array([1920, 1000.0])
    b1, b2 = np.array([1520, 300.0]), np.array([0, 1000.0])

    def cross(u, v):
        return u[0] * v[1] - u[1] * v[0]

    t = cross(b1 - a1, b2 - b1) / cross(a2 - a1, b2 - b1)
    centre_px = (a1 + t * (a2 - a1))[None, :]
    np.testing.assert_allclose(h.project(centre_px), [[52.5, 34.0]], atol=1e-6)


def test_degenerate_calibration_rejected():
    pts = [CalibrationPoint(px=i * 10, py=i * 10, x=i, y=i) for i in range(4)]  # collinear
    with pytest.raises(ValueError):
        Homography.from_calibration(pts)


def test_broadcast_heuristic_maps_frame_into_pitch():
    h = Homography.broadcast_heuristic(1920, 1080)
    assert not h.calibrated
    # Bottom-centre of the frame -> near touchline, halfway line.
    np.testing.assert_allclose(h.project(np.array([[960, 1080]])), [[52.5, 0.0]], atol=1e-6)
    # A point in the middle of the visible grass lands on the pitch.
    xy = h.project(np.array([[960, 700]]))
    assert on_pitch_mask(xy, 0.0).all()
    # Above the far touchline (stands) is off-pitch.
    assert not on_pitch_mask(h.project(np.array([[960, 100]])), 5.0).any()


def test_foot_points_and_clamp():
    fp = foot_points(np.array([[10, 20, 30, 80]]))
    np.testing.assert_allclose(fp, [[20, 80]])
    np.testing.assert_allclose(clamp_to_pitch(np.array([[-3, 70], [50, 30]])), [[0, 68], [50, 30]])
