"""Identical bytes must not make a letter's attachment batch fail halfway."""

import asyncio
import hashlib
import os
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_zoom_postgres import zoom_settings
from yuksalish_api.auth import issue_access_token
from yuksalish_api.main import create_app
from yuksalish_api.repository import find_active_user_by_username
from yuksalish_api.tables import attachments


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_identical_letter_attachments_roles_retries_and_legacy_keys() -> None:
    database_url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    settings = zoom_settings(database_url)
    settings.seed_demo_data = True
    app = create_app(settings)
    engine = create_async_engine(database_url)
    try:
        async with (
            app.router.lifespan_context(app),
            AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client,
        ):
            async with engine.connect() as connection:
                author = await find_active_user_by_username(connection, "dilshod")
                peer = await find_active_user_by_username(connection, "baxtiyor")
            assert author is not None and peer is not None
            headers = {
                "Authorization": "Bearer " + issue_access_token(
                    author["id"], settings.auth_signing_key,
                ),
            }
            created = await client.post(
                "/api/v1/ai-referent/letters", headers=headers,
                json={"subject": "Attachment batch regression", "route": "exat"},
            )
            assert created.status_code == 201, created.text
            letter = created.json()
            letter_url = f"/api/v1/ai-referent/letters/{letter['id']}"
            upload_url = f"/api/v1/attachments/ai_referent_letter/{letter['id']}"
            content = b"%PDF-1.4 identical attachment regression fixture"
            uploaded_ids = []
            # One primary and four additional files deliberately have the same bytes.
            for index in range(5):
                uploaded = await client.put(
                    upload_url, headers=headers, content=content,
                    params={
                        "fileName": f"document-{index}.pdf",
                        "documentRole": "primary" if index == 0 else "additional",
                        "expectedRevision": letter["revision"] + index,
                    },
                )
                assert uploaded.status_code == 201, uploaded.text
                uploaded_ids.append(uploaded.json()["id"])
            assert len(set(uploaded_ids)) == 5
            current = (await client.get(letter_url, headers=headers)).json()
            assert current["revision"] == letter["revision"] + 5
            assert len(current["attachments"]) == 5
            async with engine.connect() as connection:
                keys = list((await connection.execute(select(attachments.c.storage_key).where(
                    attachments.c.owner_id == UUID(letter["id"]),
                    attachments.c.owner_type == "ai_referent_letter",
                ))).scalars())
            assert len(set(keys)) == 5

            params = {"fileName": "document-4.pdf", "documentRole": "additional"}
            retried = await asyncio.gather(*(
                client.put(upload_url, headers=headers, content=content, params=params)
                for _ in range(2)
            ))
            assert all(response.status_code == 201 for response in retried)
            assert all(response.json()["id"] == uploaded_ids[4] for response in retried)
            after_retry = (await client.get(letter_url, headers=headers)).json()
            assert after_retry["revision"] == current["revision"]
            assert len(after_retry["attachments"]) == 5

            # An upload from before the fix still uses its original content-only key.
            legacy_key = f"ai_referent_letter/{letter['id']}/{hashlib.sha256(content).hexdigest()}"
            await app.state.object_storage.put(legacy_key, content, "application/pdf")
            async with engine.begin() as connection:
                await connection.execute(update(attachments).where(
                    attachments.c.id == UUID(uploaded_ids[4]),
                ).values(storage_key=legacy_key))
            legacy_retry = await client.put(
                upload_url, headers=headers, content=content, params=params,
            )
            assert legacy_retry.status_code == 201, legacy_retry.text
            assert legacy_retry.json()["id"] == uploaded_ids[4]
            renamed = await client.put(
                upload_url, headers=headers, content=content,
                params={**params, "fileName": "renamed.pdf"},
            )
            assert renamed.status_code == 201, renamed.text
            assert renamed.json()["id"] not in uploaded_ids

            stale = await client.put(
                upload_url, headers=headers, content=content,
                params={**params, "expectedRevision": letter["revision"]},
            )
            assert stale.status_code == 409, stale.text
            forbidden = await client.put(
                upload_url, content=content, params=params,
                headers={"Authorization": "Bearer " + issue_access_token(
                    peer["id"], settings.auth_signing_key,
                )},
            )
            assert forbidden.status_code == 404, forbidden.text

            # Replacing a primary then restoring it must not collide with its old role.
            for body in (b"%PDF-1.4 replacement fixture", content):
                restored = await client.put(
                    upload_url, headers=headers, content=body,
                    params={"fileName": "document-0.pdf", "documentRole": "primary"},
                )
                assert restored.status_code == 201, restored.text
            final = (await client.get(letter_url, headers=headers)).json()
            assert sum(item["documentRole"] == "primary" for item in final["attachments"]) == 1
            for attachment in final["attachments"]:
                downloaded = await client.get(
                    f"/api/v1/attachments/{attachment['id']}", headers=headers,
                )
                assert downloaded.status_code == 200, downloaded.text
                assert downloaded.content in (content, b"%PDF-1.4 replacement fixture")
    finally:
        await engine.dispose()
