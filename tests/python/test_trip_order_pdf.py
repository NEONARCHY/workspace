"""Synthetic trip documents only; no personnel records or real signatures."""

import asyncio
import re
from datetime import UTC, date, datetime
from io import BytesIO
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from PIL import Image, ImageDraw
from pypdf import PdfReader

from yuksalish_api import repository, trip_document_service
from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.repository import (
    _can_delete_trip,
    _trip_allowed_actions,
    _trip_deputy_user_id,
    act_on_trip_request,
    delete_trip_request,
)
from yuksalish_api.trip_document_service import validate_attachment
from yuksalish_api.trip_document_text import trip_destination_text
from yuksalish_api.trip_order_pdf import _signature_image, brief_pdf, order_pdf
from yuksalish_api.workspace_schemas import CreateTripRequest, TripActionRequest, TripWriteRequest


def signature() -> bytes:
    image = Image.new("RGBA", (300, 90), (0, 0, 0, 0))
    ImageDraw.Draw(image).line([(12, 65), (80, 10), (170, 70), (280, 25)], fill="blue", width=4)
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def text_of(content: bytes) -> str:
    return " ".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)


@pytest.mark.parametrize("size", [(90, 240), (300, 90), (600, 40)])
def test_signature_preserves_ink_proportions_inside_the_signature_cell(
    size: tuple[int, int],
) -> None:
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(image).rectangle((10, 10, size[0] - 11, size[1] - 11), fill="blue")
    output = BytesIO()
    image.save(output, "PNG")
    placed = _signature_image(output.getvalue())
    assert placed.drawWidth <= 122 and placed.drawHeight <= 55
    assert placed.drawWidth / placed.drawHeight == pytest.approx(
        (size[0] - 20) / (size[1] - 20),
    )


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
    assert "000-WS" not in text_of(preview)
    assert "Raqam tasdiqlangandan so'ng beriladi" in text_of(preview)
    assert "LOYIHA" in text_of(preview)
    assert "001-WS-son a/f" in text_of(issued)
    assert "Nukus" in text_of(issued) and "loyiha mablagʻlari" in text_of(issued)  # noqa: RUF001
    assert "B U Y U R A M A N" in text_of(issued)
    assert "Asos: Testova Zeboning bildirgisi." in text_of(issued)
    assert "Rais" in text_of(issued) and "Testov Rais" in text_of(issued)
    assert "БУЙРУҚ" not in text_of(issued)
    assert re.search(r"[\u0400-\u04FF]", text_of(issued)) is None
    assert len(PdfReader(BytesIO(cover)).pages[0].images) == 2  # logo + employee mark
    assert len(PdfReader(BytesIO(preview)).pages[0].images) == 1  # logo, no chair mark
    assert len(PdfReader(BytesIO(issued)).pages[0].images) == 2  # logo + chair mark


def test_written_brief_needs_no_employee_signature_and_keeps_resolution_space() -> None:
    content = brief_pdf(
        requester="Testova Zebo", chair="Testov Rais", purpose="", destination="Nukus",
        start=date(2026, 10, 15), end=date(2026, 10, 16),
        employees=["Testova Zebo"], expense_source="",
        brief_text="Safarga ruxsat berishingizni soʻraymiz.",  # noqa: RUF001
        attachment_name=None, signature=None, signed_on=date(2026, 10, 14),
    )
    text = text_of(content)
    assert "BILDIRGI" in text and "Testov Raisga" in text
    assert "Safarga ruxsat" in text
    assert "Manzil" not in text
    assert len(PdfReader(BytesIO(content)).pages[0].images) == 1  # logo only


def test_brief_typography_is_bounded_and_changes_the_authored_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from yuksalish_api import trip_order_pdf

    original_style = trip_order_pdf._style
    calls: list[tuple[str, float, bool]] = []

    def record_style(name: str, *, size: float = 11, leading: float = 17,
                     bold: bool = False) -> object:
        calls.append((name, size, bold))
        return original_style(name, size=size, leading=leading, bold=bold)

    monkeypatch.setattr(trip_order_pdf, "_style", record_style)
    values = dict(
        requester="Testova Zebo", chair="Testov Rais", purpose="", destination="Nukus",
        start=date(2026, 10, 15), end=date(2026, 10, 16), employees=["Testova Zebo"],
        expense_source="", brief_text="Safarga ruxsat berishingizni soʻraymiz.",  # noqa: RUF001
        attachment_name=None, signature=None, signed_on=date(2026, 10, 14),
    )
    content = brief_pdf(**values, brief_font_size=14, brief_font_weight="bold")
    assert content.startswith(b"%PDF-")
    assert ("brief-authored-body", 14, True) in calls
    with pytest.raises(ValueError, match="оформление"):
        brief_pdf(**values, brief_font_size=20)
    with pytest.raises(ValueError, match="оформление"):
        brief_pdf(**values, brief_font_weight="other")
    with pytest.raises(ValueError):
        TripWriteRequest(
            destination="Nukus", start_date=date(2026, 10, 15),
            end_date=date(2026, 10, 16), employee_ids=["user"], brief_font_size=20,
        )


def test_legacy_brief_does_not_transliterate_russian_purpose_before_authored_text() -> None:
    content = brief_pdf(
        requester="Testova Zebo", chair="Testov Rais",
        purpose="Проведение консультаций в рамках юридической клиники",
        destination="Qashqadaryo", start=date(2026, 10, 22),
        end=date(2026, 10, 22), employees=["Testova Zebo"],
        expense_source="", brief_text="Yuridik klinika doirasida sayyor qabul o'tkaziladi.",
        attachment_name=None, signature=None, signed_on=date(2026, 10, 20),
    )
    text = text_of(content)
    assert "Yuridik klinika doirasida sayyor qabul o'tkaziladi." in text
    assert "Safar maqsadi:" not in text
    assert "Provedenie konsultatsiy" not in text


@pytest.mark.parametrize("number", [None, "", "000-WS"])
def test_order_preview_has_no_fictitious_number_or_duplicate_purpose(number: str | None) -> None:
    values = dict(
        order_number=number, issued=date(2026, 10, 22),
        purpose="Проведение консультаций в рамках юридической клиники",
        destination="Кашкадарьинская область", start=date(2026, 10, 22),
        end=date(2026, 10, 22), employees=[("Testova Zebo", "mutaxassis")],
        expense_source="", requester="Testova Zebo", chair="Testov Rais",
    )
    text = text_of(order_pdf(**values, signature=None))
    assert "Raqam tasdiqlangandan so'ng beriladi" in text
    assert "000-WS" not in text
    assert "Provedenie" not in text and "Проведение" not in text
    assert "Qashqadaryo viloyatiga xizmat safariga yuborilsin" in " ".join(text.split())
    assert "Kashkadar" not in text
    assert "Asos: Testova Zeboning bildirgisi" in text
    with pytest.raises(ValueError, match="зарегистрированного номера"):
        order_pdf(**values, signature=signature())


@pytest.mark.parametrize(("value", "expected"), [
    ("Кашкадарьинская область", "Qashqadaryo viloyati"),
    ("  КАШКАДАРЬИНСКАЯ   ОБЛАСТЬ  ", "Qashqadaryo viloyati"),
    ("Kashkadarinskaya oblast", "Qashqadaryo viloyati"),
    ("Қашқадарё вилояти, Деҳқонобод тумани", "Qashqadaryo viloyati, Dehqonobod tumani"),
    ("Ташкентская область", "Toshkent viloyati"),
    ("город Ташкент", "Toshkent shahri"),
    ("Surxondaryo viloyati", "Surxondaryo viloyati"),
    ("Фергана, Узбекистан", "Ferghana, Uzbekistan"),
    ("Fergana, Uzbekistan", "Ferghana, Uzbekistan"),
    ("Ferghana, Uzbekistan", "Ferghana, Uzbekistan"),
    ("Fergana, Узбекистан", "Ferghana, Uzbekistan"),
    ("Ферганская область", "Farg\u02bbona viloyati"),
    ("Unknown place, district 17", "Unknown place, district 17"),
    ("Kashkadarİnskaya oblast", "Kashkadarİnskaya oblast"),
])
def test_trip_destination_uses_known_names_without_guessing_unknown_places(
    value: str, expected: str,
) -> None:
    assert trip_destination_text(value) == expected


def test_brief_normalizes_saved_place_alias_and_every_person_name() -> None:
    saved_text = "2026-yil 28-29-oktabr kunlari Fergana, Uzbekistan hududiga xizmat safari."
    content = brief_pdf(
        requester="Testov Xodim Anvar угли", chair="Testov Rais Vali ўғли",
        purpose="Tekshirilgan loyiha doirasida monitoring o'tkazish",
        destination="Фергана, Узбекистан",
        start=date(2026, 10, 28), end=date(2026, 10, 29),
        employees=["Testov Hamroh Ali ugli"], expense_source="Loyiha mablag'lari",
        brief_text=saved_text, attachment_name=None, signature=None,
        signed_on=date(2026, 10, 28),
    )
    text = " ".join(text_of(content).split())
    assert "Ferghana, Uzbekistan" in text and "Fergana, Uzbekistan" not in text
    assert "Testov Xodim Anvar o'g'li" in text
    assert "Testov Rais Vali o'g'liga" in text
    assert "Testov Hamroh Ali o'g'li" in text
    assert "ugli" not in text


def test_order_uses_same_name_and_place_rules_for_all_parties() -> None:
    content = order_pdf(
        order_number=None, issued=date(2026, 10, 28), purpose="Monitoring",
        destination="Фергана, Узбекистан", start=date(2026, 10, 28), end=date(2026, 10, 29),
        employees=[("Testov Xodim Ali угли", "mutaxassis"), ("Testov Hamroh Vali ўғли", "")],
        expense_source="Loyiha mablag'lari", requester="Testov Tashabbus Anvar ugli",
        chair="Testov Rais Karim ugli", signature=None,
    )
    text = " ".join(text_of(content).split())
    assert "Ferghana, Uzbekistanga" in text
    for name in ["Xodim Ali", "Hamroh Vali", "Tashabbus Anvar", "Rais Karim"]:
        assert f"Testov {name} o'g'li" in text
    assert "ugli" not in text


def test_order_preview_read_does_not_register_or_sign_a_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requester_id, chair_id = uuid4(), uuid4()
    row = {
        "requester_user_id": requester_id, "workflow_version": 3,
        "stage": "manager_approval", "status": "running",
        "deputy_approver_user_id": uuid4(),
        "purpose": "Проведение консультаций в рамках юридической клиники",
        "destination": "Кашкадарьинская область", "start_date": date(2026, 10, 22),
        "end_date": date(2026, 10, 22), "expense_source": "",
    }
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value=row))
    monkeypatch.setattr(trip_document_service, "_people", AsyncMock(return_value=[
        ("Testova Zebo", "mutaxassis"),
    ]))
    connection, storage = AsyncMock(), AsyncMock()
    connection.scalar.side_effect = [chair_id, "Testova Zebo", "Testov Rais"]
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    connection.execute.return_value = result
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    content, media_type, name = asyncio.run(trip_document_service.read_document(
        connection, requester, storage, uuid4(), "order-preview",
    ))
    assert (media_type, name) == ("application/pdf", "trip-order-preview.pdf")
    assert "Qashqadaryo viloyatiga" in text_of(content)
    assert "000-WS" not in text_of(content)
    assert connection.execute.await_count == 1  # participants lookup only, no writes/counter
    storage.put.assert_not_awaited()
    connection.scalar.side_effect = [chair_id]
    stranger = AuthenticatedUser(uuid4(), "other", "Other", None, None, "employee")
    with pytest.raises(WorkspaceRepositoryError) as denied:
        asyncio.run(trip_document_service.read_document(
            connection, stranger, storage, uuid4(), "order-preview",
        ))
    assert denied.value.status_code == 404


def test_new_trip_needs_deputy_then_chair_without_hr_access() -> None:
    requester_id, deputy_id, chair_id = uuid4(), uuid4(), uuid4()
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    deputy = AuthenticatedUser(deputy_id, "deputy", "Deputy", None, None, "employee")
    chair = AuthenticatedUser(chair_id, "chair", "Chair", None, None, "manager")
    row = {"stage": "deputy_approval", "status": "running", "workflow_version": 3,
           "requester_user_id": requester_id}
    assert _trip_allowed_actions(row, deputy, chair_id, deputy_id) == [
        "approve", "return", "reject",
    ]
    assert _trip_allowed_actions(row, chair, chair_id, deputy_id) == []
    assert _trip_allowed_actions(row, requester, chair_id, deputy_id) == ["withdraw"]
    row["stage"] = "manager_approval"
    assert _trip_allowed_actions(row, deputy, chair_id, deputy_id) == []
    assert _trip_allowed_actions(row, chair, chair_id, deputy_id) == [
        "approve", "return", "reject",
    ]


def test_published_trip_approver_overrides_directory_and_pinned_request_stays_assigned() -> None:
    requester_id, published_id, later_id = uuid4(), uuid4(), uuid4()
    connection = AsyncMock()
    connection.scalar.side_effect = [{"approverUserId": str(published_id)}, published_id]
    assert asyncio.run(_trip_deputy_user_id(connection)) == published_id
    row = {
        "stage": "deputy_approval", "status": "running", "workflow_version": 3,
        "requester_user_id": requester_id, "deputy_approver_user_id": published_id,
    }
    assigned = AuthenticatedUser(published_id, "assigned", "Assigned", None, None, "employee")
    later = AuthenticatedUser(later_id, "later", "Later", None, None, "employee")
    assert _trip_allowed_actions(row, assigned, None, later_id) == [
        "approve", "return", "reject",
    ]
    assert _trip_allowed_actions(row, later, None, later_id) == []


def test_published_trip_position_requires_exactly_one_active_holder() -> None:
    position_id, first_id, second_id = uuid4(), uuid4(), uuid4()
    connection = AsyncMock()
    connection.scalar.return_value = {"approverPositionId": str(position_id)}
    candidates = MagicMock()
    candidates.scalars.return_value.all.return_value = [first_id, second_id]
    connection.execute.return_value = candidates
    assert asyncio.run(_trip_deputy_user_id(connection)) is None
    candidates.scalars.return_value.all.return_value = [first_id]
    assert asyncio.run(_trip_deputy_user_id(connection)) == first_id


def test_requester_and_superadmin_can_withdraw_or_annul_but_others_cannot() -> None:
    requester_id, superadmin_id, stranger_id = uuid4(), uuid4(), uuid4()
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    superadmin = AuthenticatedUser(
        superadmin_id, "root", "Root", None, None, "superadmin",
    )
    stranger = AuthenticatedUser(stranger_id, "other", "Other", None, None, "employee")
    row = {
        "stage": "deputy_approval", "status": "running", "workflow_version": 3,
        "requester_user_id": requester_id,
    }
    assert _trip_allowed_actions(row, requester) == ["withdraw"]
    assert _trip_allowed_actions(row, superadmin) == ["withdraw"]
    assert _trip_allowed_actions(row, stranger) == []
    approved = row | {"stage": "approved", "status": "approved"}
    assert _trip_allowed_actions(approved, requester) == ["annul"]
    assert _trip_allowed_actions(approved, superadmin) == ["annul"]
    assert _trip_allowed_actions(approved, stranger) == []
    assert _trip_allowed_actions(approved | {"status": "annulled"}, superadmin) == []
    assert _trip_allowed_actions(row | {"order_pdf_key": "orders/signed.pdf"}, requester) == []
    legacy = row | {"workflow_version": 1}
    assert _trip_allowed_actions(legacy, requester) == []
    assert _trip_allowed_actions(legacy, superadmin) == ["withdraw"]


def test_superadmin_can_archive_rejected_or_annulled_trip_after_the_decision() -> None:
    request_id, requester_id, superadmin_id = uuid4(), uuid4(), uuid4()
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    superadmin = AuthenticatedUser(
        superadmin_id, "root", "Root", None, None, "superadmin",
    )
    for status, stage in (("rejected", "rejected"), ("annulled", "approved")):
        row = {
            "id": request_id, "requester_user_id": requester_id,
            "stage": stage, "status": status,
        }
        assert _can_delete_trip(row, superadmin)
        assert not _can_delete_trip(row, requester)
        connection = AsyncMock()
        result = MagicMock()
        result.mappings.return_value.first.return_value = row
        connection.execute.return_value = result
        asyncio.run(delete_trip_request(connection, superadmin, request_id))
        assert connection.execute.await_count == 4
    assert not _can_delete_trip(
        {"requester_user_id": requester_id, "stage": "approved", "status": "approved"},
        superadmin,
    )


def test_delete_trip_is_soft_and_requires_editable_stage() -> None:
    request_id, requester_id, stranger_id = uuid4(), uuid4(), uuid4()
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    stranger = AuthenticatedUser(stranger_id, "other", "Other", None, None, "employee")
    row = {
        "id": request_id, "requester_user_id": requester_id,
        "stage": "launch", "status": "draft",
    }
    connection = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    connection.execute.return_value = result
    with pytest.raises(WorkspaceRepositoryError) as denied:
        asyncio.run(delete_trip_request(connection, stranger, request_id))
    assert denied.value.status_code == 403
    row["stage"] = "manager_approval"
    with pytest.raises(WorkspaceRepositoryError) as running:
        asyncio.run(delete_trip_request(connection, requester, request_id))
    assert running.value.status_code == 409
    row["stage"] = "launch"
    asyncio.run(delete_trip_request(connection, requester, request_id))
    assert connection.execute.await_count == 6  # three attempts, plus row/chat/audit writes
    request_update = connection.execute.await_args_list[-3].args[0].compile().params
    assert request_update["deleted_at"] is not None


def test_withdraw_clears_signature_and_releases_pinned_approver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_id, requester_id, deputy_id, chair_id = uuid4(), uuid4(), uuid4(), uuid4()
    row = {
        "id": request_id, "requester_user_id": requester_id,
        "workflow_version": 3, "stage": "deputy_approval", "status": "running",
        "deputy_approver_user_id": deputy_id, "order_pdf_key": None,
    }
    connection = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    connection.execute.return_value = result
    connection.scalar.return_value = chair_id
    monkeypatch.setattr(repository, "_trip_deputy_user_id", AsyncMock(return_value=deputy_id))
    monkeypatch.setattr(repository, "_trip_response", AsyncMock(return_value="updated"))
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    assert asyncio.run(act_on_trip_request(
        connection, requester, request_id,
        TripActionRequest(action="withdraw", comment="Нужно изменить даты"),
    )) == "updated"
    changed = connection.execute.await_args_list[1].args[0].compile().params
    assert changed["stage"] == "launch"
    assert changed["status"] == "needs_revision"
    assert changed["deputy_approver_user_id"] is None
    assert changed["employee_signature_key"] is None
    assert changed["signed_brief_key"] is None


def test_annul_requires_reason_and_keeps_issued_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_id, requester_id, deputy_id, chair_id = uuid4(), uuid4(), uuid4(), uuid4()
    row = {
        "id": request_id, "requester_user_id": requester_id,
        "workflow_version": 3, "stage": "approved", "status": "approved",
        "deputy_approver_user_id": deputy_id, "order_pdf_key": "issued.pdf",
        "destination": "Термиз",
    }
    connection = AsyncMock()
    result = MagicMock()
    result.mappings.return_value.first.return_value = row
    result.scalars.return_value.all.return_value = []
    connection.execute.return_value = result
    connection.scalar.return_value = chair_id
    monkeypatch.setattr(repository, "_trip_deputy_user_id", AsyncMock(return_value=deputy_id))
    monkeypatch.setattr(repository, "_trip_response", AsyncMock(return_value="updated"))
    requester = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    with pytest.raises(WorkspaceRepositoryError) as missing_reason:
        asyncio.run(act_on_trip_request(
            connection, requester, request_id, TripActionRequest(action="annul"),
        ))
    assert missing_reason.value.status_code == 422
    assert asyncio.run(act_on_trip_request(
        connection, requester, request_id,
        TripActionRequest(action="annul", comment="Поездка отменена"),
    )) == "updated"
    changed = connection.execute.await_args_list[2].args[0].compile().params
    assert changed["status"] == "annulled"
    assert "order_pdf_key" not in changed


def test_deputy_approval_moves_to_chair_without_issuing_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_id, requester_id, deputy_id, chair_id = (
        uuid4(), uuid4(), uuid4(), uuid4()
    )
    row = {
        "id": request_id, "requester_user_id": requester_id,
        "workflow_version": 3, "stage": "deputy_approval", "status": "running",
    }
    connection = AsyncMock()
    result_row = MagicMock()
    result_row.mappings.return_value.first.return_value = row
    connection.execute.return_value = result_row
    connection.scalar.return_value = chair_id
    monkeypatch.setattr(repository, "_trip_deputy_user_id", AsyncMock(return_value=deputy_id))
    monkeypatch.setattr(repository, "_trip_directory_deputy_id", AsyncMock(return_value=deputy_id))
    monkeypatch.setattr(repository, "_trip_response", AsyncMock(return_value="updated"))
    deputy = AuthenticatedUser(deputy_id, "deputy", "Deputy", None, None, "employee")
    result = asyncio.run(act_on_trip_request(
        connection, deputy, request_id, TripActionRequest(action="approve"),
    ))
    assert result == "updated"
    updated = connection.execute.await_args_list[1].args[0].compile().params
    assert updated["stage"] == "manager_approval"
    assert updated["status"] == "running"
    assert updated["finished_at"] is None
    assert connection.execute.await_count == 3  # locked row, update, audit


def test_generated_text_is_not_interpreted_as_markup() -> None:
    content = order_pdf(
        order_number="002-WS", issued=date(2026, 10, 14),
        purpose="<b>Чиқиш</b> & учрашув", destination="Навои",
        start=date(2026, 10, 15), end=date(2026, 10, 15),
        employees=[("Тест <i>Али</i>", "мутахассис")],
        expense_source="<b>лойиҳа</b> & манба", requester="Testova Zebo",
        chair="Testov Rais", signature=signature(),
    )
    assert "<b>Chiqish</b> & uchrashuv" not in text_of(content)  # purpose is not duplicated
    assert "<b>loyiha</b> & manba" in text_of(content)
    assert "Test <i>Ali</i>" in text_of(content)


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
    assert "Nukus" in text_of(order)
    assert "Safar maqsadi:" not in text_of(cover)
    assert "Xarajatlar manbai:" not in text_of(cover)
    assert "Xizmat safari bilan bogʻliq xarajatlar" not in text_of(order)  # noqa: RUF001


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
        "requester_user_id": user_id, "workflow_version": 3,
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


def test_only_requester_can_confirm_an_attached_signed_original(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requester_id = uuid4()
    user = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    row = {
        "requester_user_id": requester_id, "workflow_version": 2,
        "stage": "launch", "status": "draft", "brief_attachment_key": "original.pdf",
        "employee_signature_key": "drawn.png", "employee_signature_sha256": "old-hash",
    }
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value=row))
    connection = AsyncMock()
    asyncio.run(trip_document_service.confirm_original_signature(
        connection, user, uuid4(), confirmed=True,
    ))
    values = connection.execute.await_args.args[0].compile().params
    assert values["original_signature_confirmed_at"].tzinfo == UTC
    assert values["employee_signature_key"] is None
    assert values["signed_brief_key"] is None
    row["brief_attachment_key"] = None
    with pytest.raises(WorkspaceRepositoryError, match="прикрепите"):
        asyncio.run(trip_document_service.confirm_original_signature(
            connection, user, uuid4(), confirmed=True,
        ))
    other = AuthenticatedUser(uuid4(), "other", "Other", None, None, "employee")
    with pytest.raises(WorkspaceRepositoryError, match="только инициатор"):
        asyncio.run(trip_document_service.confirm_original_signature(
            connection, other, uuid4(), confirmed=False,
        ))


def test_replacing_brief_clears_previous_signature_confirmation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requester_id = uuid4()
    user = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "requester_user_id": requester_id, "workflow_version": 2,
        "stage": "launch", "status": "draft",
    }))
    monkeypatch.setattr(trip_document_service, "validate_attachment", lambda *_: "application/pdf")
    connection, storage = AsyncMock(), AsyncMock()
    asyncio.run(trip_document_service.put_attachment(
        connection, user, storage, uuid4(), "new-original.pdf", b"replacement",
    ))
    values = connection.execute.await_args.args[0].compile().params
    assert values["brief_attachment_size"] == len(b"replacement")
    assert values["original_signature_confirmed_at"] is None
    assert values["employee_signature_key"] is None
    assert values["signed_brief_key"] is None


def test_confirmed_original_is_preserved_as_signed_brief(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requester_id = uuid4()
    user = AuthenticatedUser(requester_id, "requester", "Requester", None, None, "employee")
    original = b"%PDF-1.4 signed source bytes"
    digest = trip_document_service._hash(original)
    row = {
        "requester_user_id": requester_id, "workflow_version": 2,
        "stage": "launch", "status": "draft", "brief_text": "",
        "brief_attachment_key": "original.pdf", "brief_attachment_sha256": digest,
        "brief_attachment_name": "original.pdf", "brief_attachment_type": "application/pdf",
        "original_signature_confirmed_at": datetime.now(UTC),
        "employee_signature_key": None, "employee_signature_sha256": None,
        "purpose": "", "destination": "Нукус", "start_date": date(2026, 10, 15),
        "end_date": date(2026, 10, 16), "expense_source": "",
    }
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value=row))
    monkeypatch.setattr(trip_document_service, "_appointed_chair", AsyncMock(
        return_value=uuid4(),
    ))
    monkeypatch.setattr(trip_document_service, "_people", AsyncMock(return_value=[]))
    connection, storage = AsyncMock(), AsyncMock()
    connection.scalar.side_effect = ["Testova Zebo", "Testov Rais"]
    storage.get.return_value = original
    asyncio.run(trip_document_service.prepare_signed_brief(
        connection, user, storage, uuid4(),
    ))
    storage.put.assert_not_awaited()
    values = connection.execute.await_args.args[0].compile().params
    assert values["signed_brief_key"] == "original.pdf"
    assert values["signed_brief_sha256"] == digest


def test_confirmed_signed_brief_returns_original_and_keeps_private_access(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requester_id = uuid4()
    original = b"%PDF-1.4 signed source bytes"
    digest = trip_document_service._hash(original)
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "requester_user_id": requester_id, "stage": "manager_approval",
        "status": "running", "original_signature_confirmed_at": datetime.now(UTC),
        "signed_brief_key": "original.pdf", "signed_brief_sha256": digest,
        "brief_attachment_key": "original.pdf", "brief_attachment_sha256": digest,
        "brief_attachment_type": "application/pdf",
        "brief_attachment_name": "original.pdf",
        "order_pdf_key": None, "order_pdf_sha256": None, "order_number": None,
    }))
    connection, storage = AsyncMock(), AsyncMock()
    connection.scalar.return_value = uuid4()
    connection.execute.return_value = MagicMock()
    connection.execute.return_value.scalars.return_value.all.return_value = []
    storage.get.return_value = original
    requester = AuthenticatedUser(
        requester_id, "requester", "Requester", None, None, "employee",
    )
    content, media_type, name = asyncio.run(trip_document_service.read_document(
        connection, requester, storage, uuid4(), "brief",
    ))
    assert (content, media_type, name) == (original, "application/pdf", "original.pdf")
    stranger = AuthenticatedUser(uuid4(), "stranger", "Stranger", None, None, "employee")
    with pytest.raises(WorkspaceRepositoryError, match="не найден"):
        asyncio.run(trip_document_service.read_document(
            connection, stranger, storage, uuid4(), "brief",
        ))


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
    assert "Xarajatlar manbai:" not in text_of(storage.put.await_args.args[1])


@pytest.mark.parametrize("version", [2, 3])
def test_written_brief_submits_without_employee_signature(
    monkeypatch: pytest.MonkeyPatch, version: int,
) -> None:
    user_id, chair_id, deputy_id = uuid4(), uuid4(), uuid4()
    user = AuthenticatedUser(user_id, "requester", "Requester", None, None, "employee")
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value={
        "requester_user_id": user_id, "workflow_version": version,
        "stage": "launch", "status": "draft", "brief_text": "Safarga ruxsat soʻrayman.",  # noqa: RUF001
        "brief_attachment_key": None, "brief_attachment_name": None,
        "employee_signature_key": None, "employee_signature_sha256": None,
        "purpose": "", "destination": "Nukus", "start_date": date(2026, 10, 15),
        "end_date": date(2026, 10, 16), "expense_source": "",
    }))
    verified = AsyncMock()
    monkeypatch.setattr(trip_document_service, "_verified", verified)
    monkeypatch.setattr(trip_document_service, "_appointed_chair", AsyncMock(
        return_value=chair_id,
    ))
    monkeypatch.setattr(trip_document_service, "_trip_deputy_user_id", AsyncMock(
        return_value=deputy_id,
    ))
    monkeypatch.setattr(trip_document_service, "_people", AsyncMock(return_value=[
        ("Testova Zebo", "mutaxassis"),
    ]))
    connection, storage = AsyncMock(), AsyncMock()
    connection.scalar.side_effect = ["Testova Zebo", "Testov Rais"]
    asyncio.run(trip_document_service.prepare_signed_brief(
        connection, user, storage, uuid4(),
    ))
    verified.assert_not_awaited()
    storage.put.assert_awaited_once()
    saved = storage.put.await_args.args[1]
    assert "BILDIRGI" in text_of(saved)
    assert len(PdfReader(BytesIO(saved)).pages[0].images) == 1
    values = connection.execute.await_args.args[0].compile().params
    assert values["signed_brief_key"]


def test_written_brief_preview_is_private_and_only_available_before_submission(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = uuid4()
    row = {
        "requester_user_id": user_id, "workflow_version": 3, "stage": "launch",
        "status": "draft", "brief_text": "Safarga ruxsat soʻrayman.",  # noqa: RUF001
        "purpose": "", "destination": "Nukus", "start_date": date(2026, 10, 15),
        "end_date": date(2026, 10, 16), "expense_source": "",
    }
    monkeypatch.setattr(trip_document_service, "_row", AsyncMock(return_value=row))
    monkeypatch.setattr(trip_document_service, "_people", AsyncMock(return_value=[]))
    connection, storage = AsyncMock(), AsyncMock()
    connection.scalar.side_effect = [uuid4(), "Testova Zebo", "Testov Rais"]
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    connection.execute.return_value = result
    requester = AuthenticatedUser(user_id, "requester", "Requester", None, None, "employee")
    content, media_type, name = asyncio.run(trip_document_service.read_document(
        connection, requester, storage, uuid4(), "brief-preview",
    ))
    assert media_type == "application/pdf" and name == "bildirgi-preview.pdf"
    assert "BILDIRGI" in text_of(content)
    connection.scalar.side_effect = [uuid4()]
    stranger = AuthenticatedUser(uuid4(), "other", "Other", None, None, "employee")
    with pytest.raises(WorkspaceRepositoryError) as denied:
        asyncio.run(trip_document_service.read_document(
            connection, stranger, storage, uuid4(), "brief-preview",
        ))
    assert denied.value.status_code == 404
    row["stage"] = "deputy_approval"
    row["deputy_approver_user_id"] = uuid4()
    connection.scalar.side_effect = [uuid4()]
    with pytest.raises(WorkspaceRepositoryError) as wrong_stage:
        asyncio.run(trip_document_service.read_document(
            connection, requester, storage, uuid4(), "brief-preview",
        ))
    assert wrong_stage.value.status_code == 404


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
        "start_date": date(2026, 10, 22), "end_date": date(2026, 10, 23),
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
    monkeypatch.setattr(trip_document_service, "ensure_trip_available", AsyncMock())
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
