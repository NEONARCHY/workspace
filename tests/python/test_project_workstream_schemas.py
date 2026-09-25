"""Validation for dated project directions and work decisions."""

from datetime import date

import pytest
from pydantic import ValidationError

from yuksalish_api.project_hub_schemas import (
    ProjectWorkCommentWrite,
    ProjectWorkStatusWrite,
    ProjectWorkstreamWrite,
)


def test_workstream_dates_must_be_ordered() -> None:
    with pytest.raises(ValidationError):
        ProjectWorkstreamWrite(
            title="Форум", start_date=date(2030, 10, 2), end_date=date(2030, 10, 1)
        )
    valid = ProjectWorkstreamWrite(
        title="Форум", start_date=date(2030, 10, 1), end_date=date(2030, 10, 2)
    )
    assert valid.end_date == date(2030, 10, 2)


def test_work_action_inputs_are_bounded() -> None:
    assert ProjectWorkStatusWrite(status="active", expected_status="planned").comment == ""
    with pytest.raises(ValidationError):
        ProjectWorkCommentWrite(comment="")
    with pytest.raises(ValidationError):
        ProjectWorkCommentWrite(comment="x" * 4001)
