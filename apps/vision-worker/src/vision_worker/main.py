"""Worker entrypoint: BullMQ consumer for ``soccalytics.vision``.

* concurrency 1 — one video at a time per process saturates a GPU; scale out with replicas.
* The detector is built once per process and loads weights lazily on the first job.
* The CPU/GPU-bound pipeline runs in a thread so the asyncio loop keeps renewing the
  BullMQ job lock (otherwise long videos would be flagged as stalled).
* SIGTERM/SIGINT: stop taking jobs, give the in-flight job ``VISION_SHUTDOWN_GRACE_S`` to
  finish, then cancel it cooperatively; it fails this attempt and BullMQ retries it.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
import threading
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from typing import Any

import structlog
from pydantic import ValidationError

from .config import Settings, get_settings
from .contracts import EventsJobPayload, VisionJobPayload
from .detection import YoloDetector
from .pipeline import PipelineConfig, VisionPipeline
from .progress import RedisProgressPublisher
from .storage import S3ObjectStore
from .tracking import default_tracker_factory
from .video import OpenCVVideoSource

log = structlog.get_logger("vision_worker")

ANALYTICS_JOB_OPTS: dict[str, Any] = {
    "attempts": 3,
    "backoff": {"type": "exponential", "delay": 5000},
    "removeOnComplete": 1000,
    "removeOnFail": 5000,
}


def configure_logging(settings: Settings) -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    logging.basicConfig(level=level, stream=sys.stdout, format="%(message)s")
    renderer = (
        structlog.processors.JSONRenderer()
        if settings.log_json
        else structlog.dev.ConsoleRenderer()
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        cache_logger_on_first_use=True,
    )


def make_processor(
    *,
    loop: asyncio.AbstractEventLoop,
    detector: YoloDetector,
    store: S3ObjectStore,
    pubsub: Any,
    analytics_q: Any,
    pipeline_cfg: PipelineConfig,
    cancel: threading.Event,
) -> Callable[[Any, str], Awaitable[dict[str, Any]]]:
    """BullMQ processor closure over the process-wide singletons."""
    from bullmq import UnrecoverableError

    def enqueue_events(evt: EventsJobPayload) -> None:
        """Called from the pipeline thread; hops onto the event loop for the async client."""
        opts = {**ANALYTICS_JOB_OPTS, "jobId": f"events-{evt.jobId}"}  # idempotent on retry
        fut = asyncio.run_coroutine_threadsafe(
            analytics_q.add("events", evt.model_dump(mode="json"), opts), loop
        )
        fut.result(timeout=30)

    async def process(job: Any, token: str) -> dict[str, Any]:
        try:
            payload = VisionJobPayload.model_validate(job.data)
        except ValidationError as exc:
            log.error("invalid_payload", bull_job_id=job.id, error=str(exc))
            raise UnrecoverableError(f"invalid VisionJobPayload: {exc}") from exc

        structlog.contextvars.bind_contextvars(job_id=payload.jobId, match_id=payload.matchId)
        try:
            log.info("job_started", attempt=job.attemptsMade + 1, video=payload.videoKey)
            pipeline = VisionPipeline(
                store=store,
                detector=detector,
                tracker_factory=default_tracker_factory,
                video_opener=OpenCVVideoSource,
                enqueue=enqueue_events,
                config=pipeline_cfg,
                cancel=cancel,
            )
            progress = RedisProgressPublisher(pubsub, payload.jobId)
            # Failures publish a 'failed' JobStreamEvent inside the pipeline, then re-raise
            # here so BullMQ records the attempt and retries per the job's options.
            result = await asyncio.to_thread(pipeline.run, payload, progress)
            log.info("job_completed", **asdict(result))
            return asdict(result)
        except Exception:
            log.exception("job_failed")
            raise
        finally:
            structlog.contextvars.clear_contextvars()

    return process


async def amain() -> None:
    import redis
    from bullmq import Queue, Worker

    settings = get_settings()
    configure_logging(settings)
    loop = asyncio.get_running_loop()

    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    cancel = threading.Event()

    # Process-wide singletons.
    detector = YoloDetector(
        model=settings.vision_model,
        weights_dir=settings.vision_weights_dir,
        device=settings.vision_device,
        imgsz=settings.vision_imgsz,
        person_conf=settings.vision_person_conf,
        ball_conf=settings.vision_ball_conf,
    )
    store = S3ObjectStore(settings)
    pubsub = redis.Redis.from_url(settings.redis_url)
    analytics_q = Queue(settings.analytics_queue, {"connection": settings.redis_url})

    process = make_processor(
        loop=loop,
        detector=detector,
        store=store,
        pubsub=pubsub,
        analytics_q=analytics_q,
        pipeline_cfg=PipelineConfig.from_settings(settings),
        cancel=cancel,
    )

    worker = Worker(
        settings.vision_queue,
        process,
        {
            "connection": settings.redis_url,
            "concurrency": 1,
            "lockDuration": 60_000,
            "name": "vision-worker",
        },
    )
    log.info(
        "worker_started",
        queue=settings.vision_queue,
        redis=settings.redis_url,
        model=settings.vision_model,
        fps=settings.vision_fps,
    )

    await stop.wait()
    log.info("shutdown_requested", grace_s=settings.vision_shutdown_grace_s)
    close_task = asyncio.ensure_future(worker.close())
    try:
        await asyncio.wait_for(asyncio.shield(close_task), settings.vision_shutdown_grace_s)
    except TimeoutError:
        log.warning("grace_period_exceeded_cancelling_job")
        cancel.set()
        await close_task
    await analytics_q.close()
    pubsub.close()
    log.info("worker_stopped")


def run() -> None:
    asyncio.run(amain())


if __name__ == "__main__":
    run()
