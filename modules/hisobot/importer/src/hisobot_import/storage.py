from __future__ import annotations

import mimetypes
from typing import Protocol

from minio import Minio
from minio.error import S3Error

from .source import ArchiveFile


class ObjectStore(Protocol):
    def ensure_object(self, object_key: str, source: ArchiveFile) -> None: ...


class MinioObjectStore:
    def __init__(
        self,
        endpoint: str,
        access_key: str,
        secret_key: str,
        bucket: str,
        *,
        secure: bool,
    ) -> None:
        self._client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
        )
        self._bucket = bucket

    def ensure_bucket(self) -> None:
        if not self._client.bucket_exists(self._bucket):
            self._client.make_bucket(self._bucket)

    def ensure_object(self, object_key: str, source: ArchiveFile) -> None:
        try:
            existing = self._client.stat_object(self._bucket, object_key)
        except S3Error as error:
            if error.code not in {"NoSuchKey", "NoSuchObject"}:
                raise
        else:
            if existing.size != source.size:
                raise ValueError(f"Existing object size mismatch for {object_key}")
            return

        content_type = mimetypes.guess_type(source.path.name)[0] or "application/octet-stream"
        self._client.fput_object(
            self._bucket,
            object_key,
            str(source.path),
            content_type=content_type,
            metadata={"sha256": source.sha256},
        )
