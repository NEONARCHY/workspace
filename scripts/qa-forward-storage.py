"""Verify private object copies using only two disposable, uniquely named objects."""

import asyncio
from uuid import uuid4

from yuksalish_api.object_storage import MinioObjectStorage
from yuksalish_api.settings import Settings


async def main() -> None:
    storage = MinioObjectStorage(Settings())
    prefix = f"qa-forward-copy/{uuid4()}"
    source, target = f"{prefix}/source", f"{prefix}/target"
    content = b"isolated forwarding storage verification"
    try:
        await storage.put(source, content, "application/octet-stream")
        await storage.copy(source, target)
        await storage.delete(source)
        assert await storage.get(target) == content
        print("Private MinIO copy remains readable after source removal.")
    finally:
        await storage.delete(source)
        await storage.delete(target)


asyncio.run(main())
