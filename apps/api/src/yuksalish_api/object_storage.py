import asyncio
from io import BytesIO
from typing import Protocol

from minio import Minio

from .settings import Settings


class ObjectStorageError(RuntimeError):
    pass


class ObjectStorage(Protocol):
    async def ensure_ready(self) -> None: ...

    async def put(self, key: str, content: bytes, content_type: str) -> None: ...

    async def get(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...


class MinioObjectStorage:
    def __init__(self, settings: Settings) -> None:
        self._bucket = settings.s3_bucket
        self._client = Minio(
            settings.s3_endpoint,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key.get_secret_value(),
            secure=settings.s3_secure,
        )

    async def ensure_ready(self) -> None:
        def ensure() -> None:
            if not self._client.bucket_exists(self._bucket):
                self._client.make_bucket(self._bucket)

        try:
            await asyncio.to_thread(ensure)
        except Exception as error:
            raise ObjectStorageError("Object storage is unavailable") from error

    async def put(self, key: str, content: bytes, content_type: str) -> None:
        try:
            await asyncio.to_thread(
                self._client.put_object,
                self._bucket,
                key,
                BytesIO(content),
                len(content),
                content_type=content_type,
            )
        except Exception as error:
            raise ObjectStorageError("File could not be stored") from error

    async def get(self, key: str) -> bytes:
        def read() -> bytes:
            response = self._client.get_object(self._bucket, key)
            try:
                return response.read()
            finally:
                response.close()
                response.release_conn()

        try:
            return await asyncio.to_thread(read)
        except Exception as error:
            raise ObjectStorageError("File could not be read") from error

    async def delete(self, key: str) -> None:
        try:
            await asyncio.to_thread(self._client.remove_object, self._bucket, key)
        except Exception as error:
            raise ObjectStorageError("File could not be deleted") from error


class InMemoryObjectStorage:
    def __init__(self) -> None:
        self._objects: dict[str, bytes] = {}

    async def ensure_ready(self) -> None:
        return None

    async def put(self, key: str, content: bytes, content_type: str) -> None:
        del content_type
        self._objects[key] = content

    async def get(self, key: str) -> bytes:
        try:
            return self._objects[key]
        except KeyError as error:
            raise ObjectStorageError("File was not found in object storage") from error

    async def delete(self, key: str) -> None:
        self._objects.pop(key, None)
