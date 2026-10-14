"""Synthetic trip documents only; no personnel records or real signatures."""

import asyncio
from datetime import date
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader

from yuksalish_api import trip_document_service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import _trip_allowed_actions
from yuksalish_api.trip_document_service import validate_attachment
from yuksalish_api.trip_order_pdf import brief_pdf, order_pdf
from yuksalish_api.workspace_schemas import CreateTripRequest


def signature() -> bytes:
    image = Image.new("RGBA", (300, 90), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(12, 65), (80, 10), (170, 70), (280, 25)], fill="blue", width=4)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def text_of(content: bytes) -> str:
    return " ".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)


def test_employee_cover_and_chair_order_keep_separate_signatures() -> None:
    employee_signature = signature()
    cover = brief_pdf(
        requester="Testova Zebo", chair="Testov Rais",
        purpose="Учрашув", destination="Нукус",
        start=date(2026, 10, 15), end=date(2026, 10, 16),
        employees=["Testova Zebo", "Testov Ali"],
        expense_source="лойиҳа маблағлари", brief_text="Сафарга рухсат сўрайман.",
        attachment_name="original.pdf", signature=employee_signature,
        signed_on=date(2026, 10, 14),
    )
    preview = order_pdf(
        order_number="000-WS", issued=date(2026, 10, 14), purpose="Учрашув",
        destination="Нукус", start=date(2026, 10, 15), end=date(2026, 10, 16),
        employees=[("Testova Zebo", "мутахассис"), ("Testov Ali", "директор")],
        expense_source="лойиҳа маблағлари", requester="Testova Zebo",
        chair="Testov Rais", signature=None,
    )
    issued = order_pdf(
        order_number="001-WS", issued=date(2026, 10, 14), purpose="Учрашув",
        destination="Нукус", start=date(2026, 10, 15), end=date(2026, 10, 16),
        employees=[("Testova Zebo", "мутахассис"), ("Testov Ali", "директор")],
        expense_source="лойиҳа маблағлари", requester="Testova Zebo",
        chair="Testov Rais", signature=employee_signature,
    )
    assert all(content.startswith(b"%PDF-") for content in (cover, preview, issued))
    assert len(PdfReader(BytesIO(cover)).pages) == 1
    assert len(PdfReader(BytesIO(issued)).pages) == 1
    assert "original.pdf" in text_of(cover)
    assert "001-WS-сон а/ф" in text_of(issued)  # noqa: RUF001
    assert "Нукус" in text_of(issued) and "лойиҳа маблағлари" in text_of(issued)
    assert len(PdfReader(BytesIO(cover)).pages[0].images) == 2  # logo + employee mark
    assert len(PdfReader(BytesIO(preview)).pages[0].images) == 1  # logo, no chair mark
    assert len(PdfReader(BytesIO(issued)).pages[0].images) == 2  # logo + chair mark


def test_generated_text_is_not_interpreted_as_markup() -> None:
    content = order_pdf(
        order_number="002-WS", issued=date(2026, 10, 14),
        purpose="<b>Чиқиш</b> & учрашув", destination="Навои",
        start=date(2026, 10, 15), end=date(2026, 10, 15),
        employees=[("Тест <i>Али</i>", "мутахассис")],
        expense_source="лойиҳа", requester="Testova Zebo",
        chair="Testov Rais", signature=signature(),
    )
    assert "<b>Чиқиш</b> & учрашув" in text_of(content)
    assert "Тест <i>Али</i>" in text_of(content)


def test_trip_without_purpose_or_expense_source_keeps_documents_factual() -> None:
    payload = CreateTripRequest(
        destination="Нукус", start_date=date(2026, 10, 15),
        end_date=date(2026, 10, 16), employee_ids=[str(uuid4())],
    )
    assert payload.purpose == ""
    assert payload.expense_source == ""
    cover = brief_pdf(
        requester="Testova Zebo", chair="Testov Rais",
        purpose=payload.purpose, destination=payload.destination,
        start=payload.start_date, end=payload.end_date,
        employees=["Testova Zebo"], expense_source=payload.expense_source,
        brief_text="Сафарга рухсат сўрайман.", attachment_name=None,
        signature=signature(), signed_on=date(2026, 10, 14),
    )
    order = order_pdf(
        order_number="001-WS", issued=date(2026, 10, 14),
        purpose=payload.purpose, destination=payload.destination,
        start=payload.start_date, end=payload.end_date,
        employees=[("Testova Zebo", "мутахассис")],
        expense_source=payload.expense_source, requester="Testova Zebo",
        chair="Testov Rais", signature=signature(),
    )
    assert "Нукус" in text_of(cover) and "Нукус" in text_of(order)
    assert "Мақсад:" not in text_of(cover)
    assert "Харажатлар манбаи:" not in text_of(cover)
    assert "Хизмат сафари билан боғлиқ харажатлар" not in text_of(order)


def test_source_upload_rejects_invalid_type_and_mismatched_extension() -> None:
    with pytest.raises(WorkspaceRepositoryError):
        validate_attachment(b"bad", "original.pdf")
    with pytest.raises(WorkspaceRepositoryError):
        validate_attachment(signature(), "original.jpg")
    with pytest.raises(WorkspaceRepositoryError):
        validate_attachment(signature(), "../original.png")


def test_employee_can_sign_brief_without_expense_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    user = AuthenticatedUser(user_id, "requester", "Requester", None, None, "employee")
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "requester_user_id": user_id, "workflow_version": 2,
        "stage": "launch", "status": "draft",
        "brief_text": "Сафарга рухсат сўрайман.", "brief_attachment_key": None,
        "expense_source": "",
    }))
    connection, storage = AsyncMock(), AsyncMock()
    asyncio.run(trip_document_service.put_employee_signature(
        connection, user, storage, uuid4(), signature(),
    ))
    storage.put.assert_awaited_once()
    connection.execute.assert_awaited_once()


def test_signed_brief_is_prepared_without_expense_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    user = AuthenticatedUser(user_id, "requester", "Requester", None, None, "employee")
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "requester_user_id": user_id, "workflow_version": 2,
        "stage": "launch", "status": "draft",
        "brief_text": "Сафарга рухсат сўрайман.", "brief_attachment_key": None,
        "employee_signature_key": "signature.png", "employee_signature_sha256": "sha256",
        "purpose": "", "destination": "Нукус", "start_date": date(2026, 10, 15),
        "end_date": date(2026, 10, 16), "expense_source": "",
        "brief_attachment_name": None,
    }))
    monkeypatch.setattr(trip_document_service, "_verified", AsyncMock(return_value=signature()))
    monkeypatch.setattr(trip_document_service, "_appointed_chair", AsyncMock(
        return_value=uuid4(),
    ))
    monkeypatch.setattr(trip_document_service, "_people", AsyncMock(return_value=[
        ("Testova Zebo", "мутахассис"),
    ]))
    connection, storage = AsyncMock(), AsyncMock()
    connection.scalar.side_effect = ["Testova Zebo", "Testov Rais"]
    asyncio.run(trip_document_service.prepare_signed_brief(
        connection, user, storage, uuid4(),
    ))
    storage.put.assert_awaited_once()
    assert "Харажатлар манбаи:" not in text_of(storage.put.await_args.args[1])


def test_only_appointed_chair_can_decide_new_trip_and_legacy_route_remains() -> None:
    requester_id, chair_id, admin_id = uuid4(), uuid4(), uuid4()
    chair = AuthenticatedUser(chair_id, "chair", "Chair", None, None, "employee")
    admin = AuthenticatedUser(admin_id, "admin", "Admin", None, None, "admin")
    row = {
        "requester_user_id": requester_id,
        "workflow_version": 2,
        "stage": "manager_approval",
        "status": "running",
    }
    assert _trip_allowed_actions(row, chair, chair_id) == ["approve", "return", "reject"]
    assert _trip_allowed_actions(row, admin, chair_id) == []
    assert _trip_allowed_actions(row | {"workflow_version": 1}, admin, chair_id) == [
        "approve", "return", "reject",
    ]
    assert _trip_allowed_actions(row | {"stage": "hr"}, admin, chair_id) == []


def test_non_chair_cannot_issue_order_before_number_is_allocated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    chair_id, other_id = uuid4(), uuid4()
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "workflow_version": 2, "stage": "manager_approval",
    }))
    connection = AsyncMock()
    connection.scalar.return_value = chair_id
    user = AuthenticatedUser(other_id, "other", "Other", None, None, "admin")
    with pytest.raises(WorkspaceRepositoryError, match="только назначенный председатель"):
        asyncio.run(trip_document_service.issue_order(connection, user, AsyncMock(), uuid4()))
    assert connection.execute.await_count == 0


def test_order_is_not_generated_without_registered_number(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    chair_id = uuid4()
    user = AuthenticatedUser(chair_id, "chair", "Chair", None, None, "employee")
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "workflow_version": 2,
        "stage": "manager_approval",
        "signed_brief_key": "brief.pdf",
        "signed_brief_sha256": "brief-hash",
        "requester_user_id": uuid4(),
    }))
    monkeypatch.setattr(trip_document_service, "_appointed_chair", AsyncMock(
        return_value=chair_id,
    ))
    monkeypatch.setattr(trip_document_service, "_verified", AsyncMock(return_value=b"image"))
    monkeypatch.setattr(trip_document_service, "_people", AsyncMock(return_value=[]))
    connection = AsyncMock()
    connection.execute.return_value = MagicMock()
    connection.execute.return_value.mappings.return_value.first.return_value = {
        "storage_key": "signature.png", "sha256": "signature-hash",
    }
    connection.scalar.side_effect = ["Requester", "Chair", None]
    storage = AsyncMock()

    with pytest.raises(WorkspaceRepositoryError, match="Сбой регистрации приказа"):
        asyncio.run(trip_document_service.issue_order(connection, user, storage, uuid4()))

    storage.put.assert_not_awaited()
