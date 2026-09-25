"""Render and locate signatures without numbering, stamping or sending a letter."""

from __future__ import annotations

import hashlib
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from urllib.parse import urlencode

from .client import WorkspaceClient, WorkspaceError
from .state import State


def check_document(
    facsimile: Any, draft: Path, reviewers: list[dict[str, str]], kind: str
) -> list[str]:
    if not facsimile.enabled:
        raise WorkspaceError("Факсимиле не настроено на ПК референта.")
    if kind == "delivery":
        results = facsimile.check_signature_placements(draft, [item["name"] for item in reviewers])
        return [
            item["key"]
            for item in reviewers
            if item["name"] in results and results[item["name"]] is None
        ]

    import fitz  # type: ignore[import-not-found]
    from src.outgoing.facsimile import (  # type: ignore[import-not-found]
        _convert_docx_to_pdf,
        _prepare_signature_image,
        _signature_placement,
    )

    with TemporaryDirectory(prefix="referent-check-pages-") as temporary:
        folder = Path(temporary)
        pdf = folder / "pages.pdf"
        _convert_docx_to_pdf(draft, pdf, require_word=True)
        passed = []
        with fitz.open(pdf) as document:
            if not 1 <= len(document) <= 100:
                return []
            for index, reviewer in enumerate(reviewers):
                signature = facsimile._resolve_signature_image(reviewer["name"])
                if signature is None:
                    continue
                image_folder = folder / str(index)
                image_folder.mkdir()
                image = _prepare_signature_image(signature, image_folder)
                try:
                    for number in range(len(document)):
                        if len(document[number].get_text().strip()) < 30:
                            raise ValueError("Empty page")
                        with fitz.open() as page:
                            page.insert_pdf(document, from_page=number, to_page=number)
                            _signature_placement(
                                page,
                                image,
                                facsimile.signature_width_points,
                                facsimile.signature_vertical_offset_points,
                                reviewer_name=reviewer["name"],
                            )
                except ValueError:
                    continue
                passed.append(reviewer["key"])
        return passed


def run_preflight(service: Any, client: WorkspaceClient, state: State) -> bool:
    for key, result in state.pending("check-result:"):
        try:
            client.request(
                f"/ai-referent/agent/document-checks/{key.split(':', 1)[1]}/result",
                result,
                method="POST",
            )
        except WorkspaceError as error:
            if error.status != 409:
                raise
        state.remove(key)
    check = client.request(
        "/ai-referent/agent/document-checks/claim?"
        + urlencode(
            {
                "agentId": client.agent_id,
            }
        ),
        method="POST",
    ).get("check")
    if not check:
        return False
    lease = {"agentId": client.agent_id, "leaseToken": check["leaseToken"]}
    stop = threading.Event()

    def heartbeat() -> None:
        while not stop.wait(25):
            try:
                client.request(
                    f"/ai-referent/agent/document-checks/{check['id']}/heartbeat",
                    lease,
                    method="POST",
                )
            except WorkspaceError:
                return

    thread = threading.Thread(target=heartbeat, daemon=True, name="referent-check-heartbeat")
    thread.start()
    keys: list[str] = []
    try:
        content = client.transfer(
            f"/ai-referent/agent/document-checks/{check['id']}/file?" + urlencode(lease)
        )
        if hashlib.sha256(content).hexdigest() != check["sha256"]:
            raise WorkspaceError("Проверяемый файл изменился.")
        with TemporaryDirectory(prefix="referent-preflight-") as temporary:
            draft = Path(temporary) / "letter.docx"
            draft.write_bytes(content)
            keys = check_document(
                service.facsimile, draft, check["reviewers"], check["workflowKind"]
            )
    except Exception as error:
        # Office/COM boundary: never turn an unknown check result into a pass.
        state.put("check-error:" + check["id"], {"type": type(error).__name__})
    finally:
        stop.set()
        thread.join(timeout=45)
    result = {**lease, "reviewerKeys": keys}
    state.put("check-result:" + check["id"], result)
    client.request(
        f"/ai-referent/agent/document-checks/{check['id']}/result", result, method="POST"
    )
    state.remove("check-result:" + check["id"])
    return True
