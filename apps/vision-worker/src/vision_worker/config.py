"""Runtime configuration, read from environment variables (and an optional .env file)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # ── infrastructure ────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6380"
    s3_endpoint: str = "http://localhost:8333"
    s3_region: str = "us-east-1"
    s3_bucket: str = "soccalytics"
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None

    vision_queue: str = "soccalytics.vision"
    analytics_queue: str = "soccalytics.analytics"

    # ── model / inference ─────────────────────────────────────────────
    vision_model: str = "yolo11n.pt"
    vision_weights_dir: Path = Path.home() / ".cache" / "soccalytics" / "weights"
    vision_device: Literal["auto", "cpu", "cuda", "mps"] = "auto"
    vision_fps: float = Field(5.0, gt=0, le=60)
    vision_imgsz: int = 1280  # players are small in wide shots; 640 loses the ball
    vision_batch: int = Field(8, ge=1)
    vision_person_conf: float = 0.3
    vision_ball_conf: float = 0.15

    # ── tracking / post-processing ────────────────────────────────────
    vision_ball_max_gap_s: float = 1.0  # interpolate ball gaps up to this long
    vision_min_track_frames: int = 3  # drop tracks seen in fewer sampled frames
    vision_offpitch_margin_m: float = 5.0  # drop detections projected this far off the pitch
    vision_home_kit: Literal["darker", "lighter"] = "darker"  # see README "Limitations"
    vision_period_split_min: float = 50.0  # videos longer than this are split into 2 halves

    # ── process ───────────────────────────────────────────────────────
    vision_work_dir: Path | None = None  # temp dir for downloaded videos (None = system tmp)
    vision_shutdown_grace_s: float = 25.0
    log_level: str = "INFO"
    log_json: bool = True


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
