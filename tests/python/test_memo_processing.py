# ruff: noqa: RUF001
"""Isolated real HTTP flow, permissions, mandatory order and immutable memorandum."""

import asyncio
import hashlib
from datetime import date
from io import BytesIO
from uuid import UUID

import pytest
from pypdf import PdfReader, PdfWriter
from sqlalchemy import select, update

from test_chairman_memos import PREFIX, make, scenario
from yuksalish_api.chairman_memo_pdf import memo_pdf
from yuksalish_api.chairman_memo_tables import memoranda
from yuksalish_api.memo_document_text import document_text
from yuksalish_api.tables import hr_settings, workspace_notifications


def order_pdf():
    stream = BytesIO()
    writer = PdfWriter()
    writer.add_blank_page(595, 842)
    writer.write(stream)
    return stream.getvalue()


def test_hr_order_and_accountant_completion_are_separate_atomic_stages():
    async def run():
        async with scenario() as (client, headers, engine, _people, _):
            memo, _ = await make(client, headers)
            path = PREFIX + "/" + memo["id"]
            assert (
                await client.post(
                    path + "/submit", headers=headers["deputy"], json={"expectedRevision": 1}
                )
            ).status_code == 200
            approved = await client.post(
                path + "/decision",
                headers=headers["chair"],
                json={"expectedRevision": 2, "decision": "approve"},
            )
            assert approved.status_code == 200, approved.text
            assert approved.json()["status"] == "hr_pending" and not approved.json()["canEdit"]
            assert (await client.get(path, headers=headers["accountant"])).status_code == 404
            assert (await client.get(path, headers=headers["admin"])).status_code == 404
            hr = (await client.get(path, headers=headers["hr"])).json()
            assert hr["canAttachOrder"] and not hr["canComplete"]
            assert (
                await client.post(
                    path + "/hr-complete", headers=headers["hr"], json={"expectedRevision": 3}
                )
            ).status_code == 422
            assert (
                await client.post(
                    path + "/complete", headers=headers["chair"], json={"expectedRevision": 3}
                )
            ).status_code == 403
            original = (await client.get(path + "/pdf", headers=headers["deputy"])).content
            for actor in ["deputy", "chair", "admin", "accountant"]:
                assert (
                    await client.post(
                        path + "/order",
                        headers=headers[actor],
                        data={"expected_revision": "3"},
                        files={"file": ("order.pdf", order_pdf(), "application/pdf")},
                    )
                ).status_code in {403, 404}
            invalid = await client.post(
                path + "/order",
                headers=headers["hr"],
                data={"expected_revision": "3"},
                files={"file": ("order.pdf", b"%PDF-broken", "application/pdf")},
            )
            assert invalid.status_code == 422
            uploaded = await client.post(
                path + "/order",
                headers=headers["hr"],
                data={"expected_revision": "3"},
                files={"file": ("order.pdf", order_pdf(), "application/pdf")},
            )
            assert uploaded.status_code == 200, uploaded.text
            assert (
                uploaded.json()["revision"] == 4 and uploaded.json()["orderFileName"] == "order.pdf"
            )
            assert (
                await client.post(
                    path + "/order",
                    headers=headers["hr"],
                    data={"expected_revision": "3"},
                    files={"file": ("order.pdf", order_pdf(), "application/pdf")},
                )
            ).status_code == 409
            assert (
                await client.post(
                    path + "/hr-complete", headers=headers["hr"], json={"expectedRevision": 4}
                )
            ).json()["status"] == "accountant_pending"
            accountant = (await client.get(path, headers=headers["accountant"])).json()
            assert accountant["canComplete"] and not accountant["canAttachOrder"]
            assert (
                await client.get(path + "/order", headers=headers["accountant"])
            ).content == order_pdf()
            assert (
                await client.post(
                    path + "/complete", headers=headers["hr"], json={"expectedRevision": 5}
                )
            ).status_code == 403
            done = await client.post(
                path + "/complete", headers=headers["accountant"], json={"expectedRevision": 5}
            )
            assert (
                done.status_code == 200
                and done.json()["status"] == "completed"
                and done.json()["completedAt"]
            )
            assert (
                await client.post(
                    path + "/complete", headers=headers["accountant"], json={"expectedRevision": 5}
                )
            ).status_code == 409
            assert (await client.get(path + "/pdf", headers=headers["deputy"])).content == original
            async with engine.connect() as c:
                notes = (
                    (
                        await c.execute(
                            select(workspace_notifications).where(
                                workspace_notifications.c.entity_id == UUID(memo["id"])
                            )
                        )
                    )
                    .mappings()
                    .all()
                )
                assert sum(n["title"] == "Ваша билдирги выполнена" for n in notes) == 1
                assert not any(n["requires_action"] and n["resolved_at"] is None for n in notes)

    asyncio.run(run())


def test_missing_configuration_does_not_partially_approve_and_legacy_is_opt_in():
    async def run():
        async with scenario() as (client, headers, engine, people, _):
            memo, _ = await make(client, headers)
            path = PREFIX + "/" + memo["id"]
            await client.post(
                path + "/submit", headers=headers["deputy"], json={"expectedRevision": 1}
            )
            async with engine.begin() as c:
                await c.execute(
                    update(hr_settings).where(hr_settings.c.id == 1).values(accountant_user_id=None)
                )
            assert (
                await client.post(
                    path + "/decision",
                    headers=headers["chair"],
                    json={"expectedRevision": 2, "decision": "approve"},
                )
            ).status_code == 409
            still = (await client.get(path, headers=headers["chair"])).json()
            assert still["status"] == "pending" and still["revision"] == 2
            async with engine.begin() as c:
                await c.execute(
                    update(hr_settings)
                    .where(hr_settings.c.id == 1)
                    .values(accountant_user_id=people["accountant"])
                )
                await c.execute(
                    update(memoranda)
                    .where(memoranda.c.id == UUID(memo["id"]))
                    .values(status="approved", document_script=None)
                )
            before = (await client.get(path + "/pdf", headers=headers["chair"])).content
            assert (
                await client.post(
                    path + "/start-processing",
                    headers=headers["deputy"],
                    json={"expectedRevision": 2},
                )
            ).status_code == 403
            result = await client.post(
                path + "/start-processing", headers=headers["chair"], json={"expectedRevision": 2}
            )
            assert result.status_code == 200 and result.json()["status"] == "hr_pending"
            assert (
                hashlib.sha256(
                    (await client.get(path + "/pdf", headers=headers["hr"])).content
                ).digest()
                == hashlib.sha256(before).digest()
            )

    asyncio.run(run())


@pytest.mark.parametrize(
    "script,heading,body,expected",
    [
        (
            "latin",
            "BILDIRGI",
            "Ходимларни рағбатлантириш.\nЎзбекистонда яхши ишлаш.",
            "Xodimlarni rag'batlantirish.",
        ),
        (
            "cyrillic",
            "БИЛДИРГИ",
            "Xodimlarni rag'batlantirish.\nO'zbekistonda yaxshi ishlash.",
            "Ходимларни рағбатлантириш.",
        ),
    ],
)
def test_entire_document_has_one_alphabet_and_paragraphs(script, heading, body, expected):
    content = memo_pdf(
        chair="Бекмуродов Бобур",
        requester="Самугов Бахтиёр ўғли",
        job_title="Hududiy bo'linmalar bilan ishlash bo'limi boshlig'i",
        body=body,
        dated=date(2026, 11, 3),
        script=script,
    )
    text = "\n".join(p.extract_text() for p in PdfReader(BytesIO(content)).pages)
    assert heading in text and expected in text
    assert ("Самугов" if script == "cyrillic" else "Samugov") in text
    assert ("Ҳудудий" if script == "cyrillic" else "Hududiy") in text
    assert document_text("Shavkat Yulduz", "cyrillic") == "Шавкат Юлдуз"
