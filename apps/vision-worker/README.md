# vision-worker

Python computer-vision worker for Soccalytics. Consumes the BullMQ queue
`soccalytics.vision`, turns a match video into a `TrackingDocument` (player + ball positions
in pitch metres), stores it at `tracking/{matchId}.json.gz` and hands off to the Node
analytics worker with an `events` job on `soccalytics.analytics`.

```
VisionJobPayload ─▶ ingest ─▶ detect ─────────▶ track ───────────────────────────────▶ events job
   (BullMQ)        S3 GET    YOLO @ VISION_FPS  ByteTrack ids · jersey k-means teams ·   (BullMQ,
                             + torso colours    homography · ball gap interpolation ·    attempts 3,
                                                periods · document → S3 PUT              exp. backoff)
        └──── JobStreamEvent {jobId, stage, status, progress, message} on soccalytics:job:{jobId}
```

Contracts are defined in `libs/contracts/src/lib/{jobs,tracking}.ts`; `src/vision_worker/contracts.py`
mirrors them in pydantic and **must be kept in sync** (tests pin the JSON shapes).

## Layout

| Module | Responsibility |
|---|---|
| `config.py` | pydantic-settings; all env vars below |
| `contracts.py` | pydantic mirrors of the zod contracts |
| `storage.py` | boto3 S3 store (path-style), deterministic gzip serialisation |
| `video.py` | OpenCV decode with down-sampling to `VISION_FPS` (skipped frames are `grab()`-ed) |
| `detection.py` | ultralytics YOLO (person + sports ball), lazy model load, cuda → mps → cpu |
| `tracking.py` | `sv.ByteTrack` player ids (pure-numpy IoU fallback), ball single-target tracker + gap interpolation |
| `teams.py` | torso Lab colour (grass masked), weighted k-means (k=2), referee/outlier rejection |
| `homography.py` | `cv2.findHomography` from 4-point calibration, or broadcast-shot heuristic; foot-point projection |
| `pipeline.py` | pure orchestration, every collaborator injected (tested with fakes) |
| `progress.py` | throttled, best-effort JobStreamEvent publisher |
| `main.py` | BullMQ worker: concurrency 1, pipeline in a thread (lock renewal keeps working), graceful SIGTERM |

## Running

Via Nx (from the repo root):

```bash
pnpm nx run vision-worker:install   # uv sync if uv is present, else venv + pip install -e .[dev]
pnpm nx run vision-worker:serve     # needs Redis + S3 from docker-compose
pnpm nx run vision-worker:test
pnpm nx run vision-worker:lint
```

Directly:

```bash
cd apps/vision-worker
uv sync --extra dev              # or: python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/python -m vision_worker
```

Docker (GPU-less image; the compose service is behind the `cv` profile):

```bash
docker compose --profile cv up --build vision-worker
```

Model weights are downloaded by ultralytics on the first job into `VISION_WEIGHTS_DIR`
(mount a volume there to avoid re-downloading).

### Environment

| Var | Default | Notes |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6380` | queues + pub/sub |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | `http://localhost:8333` / `us-east-1` / `soccalytics` | path-style addressing |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | – | |
| `VISION_MODEL` | `yolo11n.pt` | any ultralytics checkpoint name or path |
| `VISION_WEIGHTS_DIR` | `~/.cache/soccalytics/weights` | weight + ultralytics config cache |
| `VISION_DEVICE` | `auto` | `auto` / `cpu` / `cuda` / `mps` |
| `VISION_FPS` | `5` | sampling rate of the output tracking |
| `VISION_IMGSZ` / `VISION_BATCH` | `1280` / `8` | inference resolution / frames per forward pass |
| `VISION_PERSON_CONF` / `VISION_BALL_CONF` | `0.3` / `0.15` | per-class thresholds |
| `VISION_BALL_MAX_GAP_S` | `1.0` | longest ball gap filled by interpolation |
| `VISION_MIN_TRACK_FRAMES` | `3` | shorter tracks are discarded |
| `VISION_OFFPITCH_MARGIN_M` | `5` | detections projected further off-pitch are dropped |
| `VISION_HOME_KIT` | `darker` | which colour cluster is home (see limitations) |
| `VISION_PERIOD_SPLIT_MIN` | `50` | longer videos are split into two halves at the midpoint |
| `VISION_SHUTDOWN_GRACE_S` | `25` | time an in-flight job gets on SIGTERM before cooperative cancel |
| `LOG_LEVEL` / `LOG_JSON` | `INFO` / `true` | structlog |

## Output semantics

* `frames[i].t` — seconds since the start of its period (same clock as `MatchEvent.t`); `period` is 1, or 1/2 for videos
  longer than `VISION_PERIOD_SPLIT_MIN`.
* `playerId` — synthetic `{teamId}-trk-{n}`, numbered per team by first appearance.
* `ball.z` is always 0; `ball` is `null` when not seen (gaps ≤ `VISION_BALL_MAX_GAP_S` are interpolated).
* `homeAttacksRight[p-1]` — the home side's mean x in the first minute of period p is smaller
  than the away side's.
* Re-running a job is idempotent: same S3 key, deterministic gzip bytes, and the analytics job
  uses `jobId = events-{jobId}` so a retry doesn't enqueue twice.

## Limitations (honest list)

* **Identity**: no jersey OCR yet, so ids are track ids. Occlusions / leaving the frame split one
  player into several `-trk-n` ids, which dilutes per-player metrics. Extension point:
  `build_tracking_document` in `pipeline.py` (TODO(identity)).
* **Calibration**: without `payload.calibration`, the homography is a fixed prior for a static,
  centred broadcast wide shot showing the whole pitch. Absolute positions can be off by 10+ m,
  and camera pans/zooms are not compensated. A calibration is a *single* static homography too.
* **Home vs away**: jersey colour separates the two teams but can't say which one is home;
  `VISION_HOME_KIT` is a convention. Goalkeepers and referees are rejected as colour outliers,
  so keepers are currently missing from the tracking.
* **Ball**: assumed on the ground (`z=0`); lofted balls project too far from the camera.
  The stock COCO "sports ball" class misses small/blurred balls in wide shots.
* **Periods**: half-time is the video midpoint, not detected.
* Detection runs on decoded frames batch by batch on one device; no TensorRT/ONNX export.

## Next steps

1. **Jersey-number OCR** (crop torso back → digit recogniser, vote over a track) + roster matching
   for real player ids and track re-stitching.
2. **Pitch keypoint model** (line/landmark detection) for per-frame automatic calibration,
   which also handles camera motion.
3. **Action-recognition model** (passes, shots, tackles) to feed events directly instead of
   inferring them from tracking.
4. **GPU throughput**: larger async batches with decode on a separate thread, FP16/TensorRT
   export, a fine-tuned football detector (players/goalkeepers/referees/ball as separate classes).
5. Goalkeeper handling (third/fourth colour cluster near each goal) and ball height estimation.
