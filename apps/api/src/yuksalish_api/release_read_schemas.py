"""Only explicit acknowledgements, never a user ID supplied by the client."""

from typing import Annotated

from pydantic import ConfigDict, Field, field_validator

from .workspace_schemas import ApiModel

ReleaseEntryId = Annotated[
    str, Field(min_length=1, max_length=220, pattern=r"^(?:update|release):[A-Za-z0-9._-]+$"),
]


class ReleaseReadState(ApiModel):
    read_entry_ids: list[str] = Field(default_factory=list)


class ReleaseReadInput(ApiModel):
    model_config = ConfigDict(extra="forbid")
    entry_ids: list[ReleaseEntryId] = Field(min_length=1, max_length=2000)

    @field_validator("entry_ids")
    @classmethod
    def unique_entries(cls, values: list[str]) -> list[str]:
        if len(values) != len(set(values)):
            raise ValueError("Release entries must be unique")
        return values
