import numpy as np

from vision_worker.detection import BALL, PERSON, FrameDetections
from vision_worker.tracking import BallTracker, IouTracker, interpolate_gaps


def test_interpolates_short_interior_gaps_only():
    seq = [(0.0, 0.0), None, None, (3.0, 6.0), None, (5.0, 6.0)]
    out = interpolate_gaps(seq, max_gap=2)
    assert out[1] == (1.0, 2.0)
    assert out[2] == (2.0, 4.0)
    assert out[4] == (4.0, 6.0)


def test_long_and_edge_gaps_left_empty():
    seq = [None, (0.0, 0.0), None, None, None, (4.0, 0.0), None]
    out = interpolate_gaps(seq, max_gap=2)
    assert out[0] is None and out[-1] is None
    assert out[2:5] == [None, None, None]


def _dets(boxes, cls=PERSON, conf=0.9):
    xyxy = np.array(boxes, dtype=np.float32).reshape(-1, 4)
    return FrameDetections(
        xyxy, np.full(len(xyxy), conf, np.float32), np.full(len(xyxy), cls, np.int32)
    )


def test_iou_tracker_keeps_ids_across_frames():
    tr = IouTracker(fps=5)
    a = tr.update(_dets([[0, 0, 10, 20], [100, 0, 110, 20]]))
    b = tr.update(_dets([[101, 1, 111, 21], [1, 1, 11, 21]]))  # order swapped, small motion
    assert a[0] == b[1] and a[1] == b[0]
    c = tr.update(_dets([[300, 0, 310, 20]]))  # new player
    assert c[0] not in set(a)


def test_ball_tracker_prefers_continuity_over_confidence():
    bt = BallTracker(max_jump_px=50)
    assert bt.update(_dets([[100, 100, 110, 110]], BALL)) == (105.0, 105.0)
    # A far-away, more confident false positive vs a nearby true ball.
    balls = FrameDetections(
        np.array([[500, 500, 510, 510], [120, 100, 130, 110]], np.float32),
        np.array([0.9, 0.3], np.float32),
        np.array([BALL, BALL], np.int32),
    )
    assert bt.update(balls) == (125.0, 105.0)
    assert bt.update(_dets([], BALL)) is None
