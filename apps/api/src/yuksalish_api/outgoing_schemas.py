"""Contracts for the outgoing correspondence module.

Letters are prepared and approved here, but registered and sent by the ZoomBot's
sibling — the E-XAT robot on a separate workstation. Until that robot is wired
up, the section reports `configured: false` the way the members registry does.
"""

from .workspace_schemas import ApiModel


class OutgoingLettersRegistryResponse(ApiModel):
    configured: bool
