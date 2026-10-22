"""Object storage (S3-compatible: SeaweedFS locally, any S3 in prod) + tracking serialisation."""

from __future__ import annotations

import gzip
import json
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from .contracts import TrackingDocument

if TYPE_CHECKING:
    from .config import Settings


def tracking_key(match_id: str) -> str:
    return f"tracking/{match_id}.json.gz"


def serialise_tracking(doc: TrackingDocument) -> bytes:
    """Compact JSON, gzipped. ``mtime=0`` makes output deterministic (idempotent re-runs)."""
    raw = json.dumps(doc.model_dump(mode="json"), separators=(",", ":")).encode()
    return gzip.compress(raw, compresslevel=6, mtime=0)


def deserialise_tracking(blob: bytes) -> TrackingDocument:
    return TrackingDocument.model_validate_json(gzip.decompress(blob))


class ObjectStore(Protocol):
    def download(self, key: str, dest: Path) -> None: ...
    def upload(self, key: str, data: bytes, content_type: str) -> None: ...


class S3ObjectStore:
    """boto3-backed store. boto3 is imported lazily so unit tests don't need it."""

    def __init__(self, settings: Settings) -> None:
        import boto3
        from botocore.config import Config

        self.bucket = settings.s3_bucket
        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key_id,
            aws_secret_access_key=settings.s3_secret_access_key,
            config=Config(
                s3={"addressing_style": "path"},
                retries={"max_attempts": 5, "mode": "standard"},
            ),
        )

    def download(self, key: str, dest: Path) -> None:
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(self.bucket, key, str(dest))

    def upload(self, key: str, data: bytes, content_type: str) -> None:
        # Deliberately NOT setting Content-Encoding: gzip — some HTTP clients would then
        # transparently decompress, and the Node worker expects to gunzip itself.
        self._client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)
