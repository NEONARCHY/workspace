"""Private, versioned survey analysis contracts; no answers in audit events."""

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field

from .project_hub_schemas import HubModel

QuestionType = Literal["categorical", "multiple", "numeric", "text", "excluded"]


class SurveyModel(HubModel):
    model_config = ConfigDict(**{**HubModel.model_config, "extra": "forbid"})


class SurveySheet(SurveyModel):
    name: str
    rows: list[list[str]]


class SurveyWorkbook(SurveyModel):
    sheets: list[SurveySheet]
    warnings: list[str] = Field(default_factory=list)


class SurveyFilter(SurveyModel):
    column: int = Field(ge=0, le=511)
    value: str = Field(max_length=2000)
    operator: Literal["equals", "contains", "range", "empty", "filled"] = "equals"
    upper: str = Field(default="", max_length=2000)


class SurveySavedView(SurveyModel):
    name: str = Field(min_length=1, max_length=100)
    query: str = Field(default="", max_length=200)
    filters: list[SurveyFilter] = Field(default_factory=list, max_length=20)


class SurveyConfiguration(SurveyModel):
    sheet: int = Field(default=0, ge=0, le=19)
    header_row: int = Field(default=0, ge=0, le=24999)
    types: dict[str, QuestionType] = Field(default_factory=dict, max_length=512)
    separator: Literal[";", "|", ","] = ";"
    missing_values: list[str] = Field(default_factory=list, max_length=20)
    query: str = Field(default="", max_length=200)
    filters: list[SurveyFilter] = Field(default_factory=list, max_length=20)
    saved_views: list[SurveySavedView] = Field(default_factory=list, max_length=20)


class SurveyAnalysis(SurveyModel):
    id: str
    title: str
    file_name: str
    revision: int
    archived: bool
    created_at: datetime
    updated_at: datetime
    configuration: SurveyConfiguration


class SurveyDetail(SurveyModel):
    analysis: SurveyAnalysis
    workbook: SurveyWorkbook


class SurveyUpdate(SurveyModel):
    expected_revision: int = Field(ge=1)
    title: str = Field(min_length=1, max_length=240)
    archived: bool
    configuration: SurveyConfiguration


class SurveyExport(SurveyModel):
    configuration: SurveyConfiguration
    row_numbers: list[int] = Field(max_length=25000)
