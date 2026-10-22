# syntax=docker/dockerfile:1.7
# CPU image. For GPU, base on an nvidia/cuda runtime image and install the CUDA torch wheel.
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    VISION_WEIGHTS_DIR=/home/app/.cache/soccalytics/weights \
    YOLO_CONFIG_DIR=/home/app/.cache/soccalytics/weights

# libGL/glib for OpenCV/ultralytics, ffmpeg for broad codec support.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 10001 app
WORKDIR /app

# CPU-only torch wheel keeps the image ~1.5 GB smaller than the default CUDA build.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision

# Dependencies first, resolved from pyproject.toml, so source edits don't bust this layer.
COPY pyproject.toml README.md ./
RUN python -c "import subprocess, sys, tomllib; \
deps = tomllib.load(open('pyproject.toml', 'rb'))['project']['dependencies']; \
subprocess.check_call([sys.executable, '-m', 'pip', 'install', *deps])"

COPY src ./src
RUN pip install --no-deps .

USER app
RUN mkdir -p "$VISION_WEIGHTS_DIR"
VOLUME ["/home/app/.cache/soccalytics/weights"]

# Exec form so SIGTERM reaches the worker directly (graceful shutdown).
CMD ["python", "-m", "vision_worker"]
