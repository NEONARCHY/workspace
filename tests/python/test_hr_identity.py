"""Only synthetic identities/photos. OCR is transient and conservative."""

from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from PIL import Image

from yuksalish_api.errors import WorkspaceRepositoryError
from yuksalish_api.hr_identity import (
    extract_identity,
    normalise_photo,
    recognise_identity,
    tsv_lines,
)


def photo() -> bytes:
    value = BytesIO()
    Image.new("RGB", (640, 400), "white").save(value, "PNG")
    return value.getvalue()


def test_labelled_fields_and_bilingual_name_are_not_guessed() -> None:
    result = extract_identity(
        [
            "FAMILIYASI / SURNAME",
            "TESTOV",
            "ISMI / GIVEN NAME",
            "ALI",
            "OTASINING ISMI / PATRONYMIC",
            "TESTOVICH",
            "JSHSHIR: 00000000000000",
            "DOCUMENT NO: AD 0000000",
        ]
    )
    assert result.full_name == "TESTOV ALI TESTOVICH"
    assert result.pinfl == "00000000000000"
    assert result.passport == "AD0000000"


def test_ambiguous_and_unlabelled_values_stay_empty() -> None:
    result = extract_identity(
        ["00000000000000", "ID NUMBER: 000000001", "ID NUMBER: 000000002", "PINFL: 1234567890123O"]
    )
    assert result.pinfl is None and result.full_name is None and result.passport is None
    assert result.warnings
    assert all("000000001" not in value for value in result.warnings)


def test_patronymic_is_not_reused_as_given_name() -> None:
    result = extract_identity(["FAMILIYASI: TESTOV", "OTASINING ISMI: TESTOVICH"])
    assert result.full_name is None


def test_confidence_rejects_whole_incomplete_line() -> None:
    header = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tconf\ttext\n"
    result = tsv_lines(
        header + "5\t1\t1\t1\t1\t1\t90\tPINFL:\n"
        "5\t1\t1\t1\t1\t2\t30\t00000000000000\n"
        "5\t1\t1\t1\t2\t1\t99\tTESTOV\n"
    )
    assert result == ["TESTOV"]


def test_reencoded_photo_limits_and_non_image_rejection() -> None:
    result = normalise_photo(photo())
    assert Image.open(BytesIO(result)).size == (640, 400)
    for content in (b"%PDF-fake", b"", b"x" * (5 * 1024 * 1024 + 1)):
        with pytest.raises(WorkspaceRepositoryError):
            normalise_photo(content)
    oversized = BytesIO()
    Image.new("RGB", (4000, 4000), "white").save(oversized, "PNG")
    with pytest.raises(WorkspaceRepositoryError, match="12 мегапикселей"):
        normalise_photo(oversized.getvalue())


@pytest.mark.anyio
async def test_missing_engine_does_not_fall_back_to_remote_provider() -> None:
    with pytest.raises(WorkspaceRepositoryError) as error:
        await recognise_identity(photo(), Path("missing-tesseract"))
    assert error.value.status_code == 503


@pytest.mark.anyio
async def test_engine_receives_only_normalised_stdin_and_bounded_result(
    monkeypatch, tmp_path
) -> None:
    engine = tmp_path / "synthetic-engine"
    engine.touch()
    output = (
        b"level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tconf\ttext\n"
        b"5\t1\t1\t1\t1\t1\t90\tPINFL:\n"
        b"5\t1\t1\t1\t1\t2\t90\t00000000000000\n"
    )
    process = AsyncMock()
    process.stdin.write = lambda value: None
    process.stdin.close = lambda: None
    process.stdout.read.side_effect = [output, b""]
    process.returncode = 0
    run = AsyncMock(return_value=process)
    monkeypatch.setattr("yuksalish_api.hr_identity.asyncio.create_subprocess_exec", run)
    result = await recognise_identity(photo(), engine)
    assert result.pinfl == "00000000000000"
    assert run.call_args.args[:3] == (str(engine), "stdin", "stdout")
    assert "shell" not in run.call_args.kwargs


@pytest.mark.anyio
async def test_oversized_ocr_output_is_not_returned(monkeypatch, tmp_path) -> None:
    engine = tmp_path / "synthetic-engine"
    engine.touch()
    process = AsyncMock()
    process.stdin.write = lambda value: None
    process.stdin.close = lambda: None
    process.stdout.read.return_value = b"x" * (129 * 1024)
    process.returncode = 0
    monkeypatch.setattr(
        "yuksalish_api.hr_identity.asyncio.create_subprocess_exec", AsyncMock(return_value=process)
    )
    with pytest.raises(WorkspaceRepositoryError) as error:
        await recognise_identity(photo(), engine)
    assert error.value.status_code == 422
