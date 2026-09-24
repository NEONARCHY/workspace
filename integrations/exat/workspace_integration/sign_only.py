"""Sign every Word-rendered page independently, without Exat delivery or numbering."""

from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from zipfile import is_zipfile

from .client import WorkspaceError


def sign_document_pages(
    facsimile: Any, draft: Path, target_folder: Path, reviewer_name: str
) -> list[Path]:
    """Publish only when every page has a safely placed facsimile signature.

    Physical pages are defined by Microsoft Word's PDF export on the referent PC.
    This deliberately does not call OutgoingService.handle_review(), which can
    allocate an outgoing number and later trigger an external send.
    """
    if draft.suffix.lower() != ".docx" or not is_zipfile(draft):
        raise WorkspaceError("Для подписи нужен корректный DOCX.")
    if not facsimile.enabled:
        raise WorkspaceError("Факсимильная подпись не настроена на ПК референта.")
    signature = facsimile._resolve_signature_image(reviewer_name)
    if signature is None or not signature.is_file():
        raise WorkspaceError("Для выбранного согласующего не найдена подпись.")

    try:
        import fitz  # type: ignore[import-not-found]
        from src.outgoing.facsimile import (  # type: ignore[import-not-found]
            _convert_docx_to_pdf,
            _stamp_pdf_signature,
        )
    except ImportError as error:
        raise WorkspaceError("Для разделения подписанных PDF не установлен PyMuPDF.") from error

    target_folder.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="sign-only-", dir=target_folder) as temporary:
        staging = Path(temporary)
        source_pdf = staging / "word-export.pdf"
        _convert_docx_to_pdf(draft, source_pdf, require_word=True)
        if not source_pdf.is_file() or source_pdf.stat().st_size == 0:
            raise WorkspaceError("Microsoft Word не создал PDF.")

        staged: list[Path] = []
        with fitz.open(source_pdf) as document:
            if not 1 <= len(document) <= 100:
                raise WorkspaceError("Документ должен содержать от 1 до 100 страниц.")
            for index in range(len(document)):
                page = document[index]
                if len(page.get_text().strip()) < 30:
                    raise WorkspaceError(
                        f"Страница {index + 1} выглядит пустой. Подписание остановлено."
                    )
                page_pdf = staging / f"{index + 1:03d}.pdf"
                with fitz.open() as single:
                    single.insert_pdf(document, from_page=index, to_page=index)
                    single.save(page_pdf, garbage=4, deflate=True)
                applied, warning = _stamp_pdf_signature(
                    page_pdf,
                    signature,
                    reviewer_name=reviewer_name,
                    signature_width_points=facsimile.signature_width_points,
                    vertical_offset_points=facsimile.signature_vertical_offset_points,
                )
                if not applied or warning:
                    raise WorkspaceError(
                        f"Подпись на странице {index + 1} не размещена уверенно. "
                        "Ни одно письмо не опубликовано."
                    )
                with fitz.open(page_pdf) as signed:
                    if len(signed) != 1:
                        raise WorkspaceError("Подписанный PDF должен содержать одну страницу.")
                staged.append(page_pdf)

        published: list[Path] = []
        for index, page_pdf in enumerate(staged, 1):
            destination = target_folder / f"{index:03d}.pdf"
            page_pdf.replace(destination)
            published.append(destination)
        return published
