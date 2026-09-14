"""File storage must preserve bytes and turn backend failures into stable API errors."""

from io import BytesIO

import pytest

from yuksalish_api import object_storage
from yuksalish_api.settings import Settings


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeResponse:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.closed = False
        self.released = False

    def read(self) -> bytes:
        return self.content

    def close(self) -> None:
        self.closed = True

    def release_conn(self) -> None:
        self.released = True


class FakeMinio:
    def __init__(self) -> None:
        self.bucket_created = False
        self.objects: dict[str, bytes] = {}
        self.last_response: FakeResponse | None = None
        self.fail_on: str | None = None

    def _check(self, operation: str) -> None:
        if self.fail_on == operation:
            raise OSError("simulated storage failure")

    def bucket_exists(self, bucket: str) -> bool:
        self._check("bucket_exists")
        assert bucket == "workspace-files"
        return self.bucket_created

    def make_bucket(self, bucket: str) -> None:
        self._check("make_bucket")
        assert bucket == "workspace-files"
        self.bucket_created = True

    def put_object(
        self, bucket: str, key: str, data: BytesIO, length: int, *, content_type: str,
    ) -> None:
        self._check("put_object")
        assert bucket == "workspace-files" and content_type == "text/plain"
        content = data.read()
        assert len(content) == length
        self.objects[key] = content

    def get_object(self, bucket: str, key: str) -> FakeResponse:
        self._check("get_object")
        assert bucket == "workspace-files"
        self.last_response = FakeResponse(self.objects[key])
        return self.last_response

    def remove_object(self, bucket: str, key: str) -> None:
        self._check("remove_object")
        assert bucket == "workspace-files"
        self.objects.pop(key, None)


@pytest.mark.anyio
async def test_minio_storage_round_trip_and_failure_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeMinio()
    monkeypatch.setattr(object_storage, "Minio", lambda *args, **kwargs: fake)
    storage = object_storage.MinioObjectStorage(Settings(s3_bucket="workspace-files"))

    await storage.ensure_ready()
    assert fake.bucket_created
    await storage.ensure_ready()
    await storage.put("handoff/file.txt", b"preserved bytes", "text/plain")
    assert await storage.get("handoff/file.txt") == b"preserved bytes"
    assert fake.last_response is not None
    assert fake.last_response.closed and fake.last_response.released
    await storage.delete("handoff/file.txt")
    assert "handoff/file.txt" not in fake.objects

    for operation, call, message in (
        ("bucket_exists", storage.ensure_ready, "Object storage is unavailable"),
        ("put_object", lambda: storage.put("x", b"x", "text/plain"), "File could not be stored"),
        ("get_object", lambda: storage.get("x"), "File could not be read"),
        ("remove_object", lambda: storage.delete("x"), "File could not be deleted"),
    ):
        fake.fail_on = operation
        with pytest.raises(object_storage.ObjectStorageError, match=message):
            await call()
