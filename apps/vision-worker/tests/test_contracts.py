import gzip
import json

import pytest
from pydantic import ValidationError

from vision_worker.contracts import (
    EventsJobPayload,
    JobStreamEvent,
    TrackingDocument,
    VisionJobPayload,
    job_channel,
)
from vision_worker.pipeline import (
    AWAY,
    HOME,
    assign_periods,
    build_tracking_document,
    infer_home_attacks_right,
)
from vision_worker.storage import deserialise_tracking, serialise_tracking, tracking_key


def _payload(**kw):
    base = {
        "jobId": "job-1",
        "matchId": "m-1",
        "videoKey": "videos/m-1.mp4",
        "homeTeamId": "home",
        "awayTeamId": "away",
        "calibration": None,
    }
    return {**base, **kw}


def test_vision_payload_parses_and_validates_calibration_length():
    assert VisionJobPayload.model_validate(_payload()).calibration is None
    pts = [{"px": 0, "py": 0, "x": 0, "y": 0}] * 4
    assert len(VisionJobPayload.model_validate(_payload(calibration=pts)).calibration) == 4
    with pytest.raises(ValidationError):
        VisionJobPayload.model_validate(_payload(calibration=pts[:3]))
    with pytest.raises(ValidationError):
        VisionJobPayload.model_validate(_payload(jobId=""))


def test_outbound_shapes_match_ts_contracts():
    assert EventsJobPayload(jobId="j", matchId="m", trackingKey="k").model_dump() == {
        "task": "events",
        "jobId": "j",
        "matchId": "m",
        "trackingKey": "k",
    }
    evt = JobStreamEvent(jobId="j", stage="detect", status="running", progress=0.5, message=None)
    assert json.loads(evt.model_dump_json()) == {
        "jobId": "j",
        "stage": "detect",
        "status": "running",
        "progress": 0.5,
        "message": None,
    }
    assert job_channel("j") == "soccalytics:job:j"
    assert tracking_key("m") == "tracking/m.json.gz"


def _doc(times, players, ball):
    return build_tracking_document(
        match_id="m-1",
        home_team_id="home",
        away_team_id="away",
        fps=5.0,
        times=times,
        players=players,
        ball=ball,
    )


def test_build_document_ids_and_serialisation_roundtrip():
    times = [0.0, 0.2, 0.4]
    players = [
        [(7, HOME, 20.0, 30.0), (3, AWAY, 80.0, 30.0)],
        [(7, HOME, 21.0, 30.0), (3, AWAY, 79.0, 31.0), (11, AWAY, 70.0, 10.0)],
        [(7, HOME, 22.0, 30.0)],
    ]
    doc = _doc(times, players, [(50.0, 34.0), None, (51.0, 34.5)])

    assert doc.meta.source == "cv"
    assert doc.meta.frameCount == 3
    assert doc.meta.homeAttacksRight == [True]  # home starts on the left
    ids = {p.playerId: p.teamId for f in doc.frames for p in f.players}
    assert ids == {"home-trk-1": "home", "away-trk-1": "away", "away-trk-2": "away"}
    assert doc.frames[1].ball is None
    assert doc.frames[0].ball.z == 0

    blob = serialise_tracking(doc)
    assert blob == serialise_tracking(doc)  # deterministic bytes (mtime=0)
    raw = json.loads(gzip.decompress(blob))
    assert set(raw) == {"meta", "frames"}
    assert set(raw["frames"][0]) == {"period", "t", "ball", "players"}
    assert set(raw["frames"][0]["players"][0]) == {"playerId", "teamId", "x", "y"}
    assert deserialise_tracking(blob) == doc
    TrackingDocument.model_validate(raw)  # strict validation of the on-wire JSON


def test_periods_split_only_for_long_videos():
    assert set(assign_periods([0.0, 600.0, 1200.0], 5.0, 50)) == {1}
    times = [i * 60.0 for i in range(96)]  # 95 min
    periods = assign_periods(times, 1 / 60, 50)
    assert periods[0] == 1 and periods[-1] == 2
    assert periods.index(2) == 48  # midpoint of 96 minutes


def test_home_attacks_right_flips_at_half_time():
    periods = [1, 1, 2, 2]
    times = [0.0, 10.0, 3000.0, 3010.0]
    home_x = [[20.0], [25.0], [80.0], [85.0]]
    away_x = [[80.0], [75.0], [20.0], [25.0]]
    assert infer_home_attacks_right(periods, times, home_x, away_x) == [True, False]
    # No evidence at all: default True, then switch.
    assert infer_home_attacks_right(periods, times, [[]] * 4, [[]] * 4) == [True, False]


def test_document_rejects_extra_keys():
    with pytest.raises(ValidationError):
        TrackingDocument.model_validate(
            {
                "meta": {
                    "matchId": "m",
                    "fps": 5,
                    "frameCount": 0,
                    "homeTeamId": "h",
                    "awayTeamId": "a",
                    "homeAttacksRight": [True],
                    "source": "cv",
                    "bogus": 1,
                },
                "frames": [],
            }
        )
