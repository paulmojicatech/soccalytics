"""Object detection (players + ball).

``YoloDetector`` wraps ultralytics; the model is loaded lazily on first use and cached for
the life of the process (the worker builds exactly one detector). ultralytics/torch are
imported lazily so the rest of the package (and the unit tests) work without them.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import numpy as np
import structlog

log = structlog.get_logger(__name__)

# Local class ids used throughout the pipeline (independent of the model's label map).
PERSON = 0
BALL = 1

# COCO ids in the stock YOLO checkpoints.
COCO_PERSON = 0
COCO_SPORTS_BALL = 32


@dataclass
class FrameDetections:
    """Detections for one frame. Arrays are aligned: ``xyxy[i]`` has ``conf[i]``/``cls[i]``."""

    xyxy: np.ndarray = field(default_factory=lambda: np.zeros((0, 4), dtype=np.float32))
    conf: np.ndarray = field(default_factory=lambda: np.zeros((0,), dtype=np.float32))
    cls: np.ndarray = field(default_factory=lambda: np.zeros((0,), dtype=np.int32))

    def of_class(self, c: int) -> FrameDetections:
        m = self.cls == c
        return FrameDetections(self.xyxy[m], self.conf[m], self.cls[m])

    def __len__(self) -> int:
        return len(self.conf)


class Detector(Protocol):
    def detect(self, images: Sequence[np.ndarray]) -> list[FrameDetections]:
        """Batch-detect persons and balls in BGR images."""
        ...


def select_device(preference: str = "auto") -> str:
    """cuda > mps > cpu, unless explicitly configured."""
    if preference != "auto":
        return "cuda:0" if preference == "cuda" else preference
    try:
        import torch
    except ImportError:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda:0"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def resolve_weights(model: str, weights_dir: Path) -> str:
    """Bare checkpoint names (``yolo11n.pt``) resolve into the cache dir; ultralytics
    downloads official assets to that exact path on first use. Explicit paths pass through."""
    p = Path(model)
    if p.is_absolute() or p.parent != Path(".") or p.exists():
        return str(p)
    weights_dir.mkdir(parents=True, exist_ok=True)
    return str(weights_dir / p.name)


class YoloDetector:
    def __init__(
        self,
        *,
        model: str,
        weights_dir: Path,
        device: str = "auto",
        imgsz: int = 1280,
        person_conf: float = 0.3,
        ball_conf: float = 0.15,
    ) -> None:
        self._model_name = model
        self._weights_dir = weights_dir
        self._device_pref = device
        self._imgsz = imgsz
        self._person_conf = person_conf
        self._ball_conf = ball_conf
        self._model = None
        self._device = "cpu"
        self._lock = threading.Lock()
        self._class_map: dict[int, int] = {}

    def _ensure_loaded(self):
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is None:
                # Keep ultralytics' settings/cache inside our writable cache dir (non-root image).
                os.environ.setdefault("YOLO_CONFIG_DIR", str(self._weights_dir))
                from ultralytics import YOLO

                weights = resolve_weights(self._model_name, self._weights_dir)
                self._device = select_device(self._device_pref)
                log.info("loading_model", weights=weights, device=self._device)
                model = YOLO(weights)
                names = {int(k): str(v).lower() for k, v in model.names.items()}
                self._class_map = {
                    k: (PERSON if v == "person" else BALL)
                    for k, v in names.items()
                    if v in ("person", "sports ball", "ball")
                }
                if not self._class_map:  # unexpected label map: assume COCO
                    self._class_map = {COCO_PERSON: PERSON, COCO_SPORTS_BALL: BALL}
                self._model = model
        return self._model

    def detect(self, images: Sequence[np.ndarray]) -> list[FrameDetections]:
        if not images:
            return []
        model = self._ensure_loaded()
        results = model.predict(
            list(images),
            classes=list(self._class_map),
            conf=min(self._person_conf, self._ball_conf),
            imgsz=self._imgsz,
            device=self._device,
            half=self._device.startswith("cuda"),
            verbose=False,
        )
        out: list[FrameDetections] = []
        for r in results:
            boxes = r.boxes
            xyxy = boxes.xyxy.cpu().numpy().astype(np.float32)
            conf = boxes.conf.cpu().numpy().astype(np.float32)
            raw_cls = boxes.cls.cpu().numpy().astype(np.int32)
            cls = np.array([self._class_map.get(int(c), -1) for c in raw_cls], dtype=np.int32)
            thr = np.where(cls == BALL, self._ball_conf, self._person_conf)
            keep = (cls >= 0) & (conf >= thr)
            out.append(FrameDetections(xyxy[keep], conf[keep], cls[keep]))
        return out
