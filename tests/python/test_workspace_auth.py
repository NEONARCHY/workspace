from uuid import uuid4

import pytest
from pydantic import SecretStr

from yuksalish_api.auth import InvalidTokenError, issue_access_token, verify_access_token
from yuksalish_api.repository import WorkspaceRepositoryError, _condition_outcome, _validate_graph
from yuksalish_api.workspace_schemas import (
    SaveWorkflowRequest,
    WorkflowEdgeResponse,
    WorkflowNodeResponse,
)


def test_signed_access_token_round_trip_and_expiration() -> None:
    user_id = uuid4()
    key = SecretStr("unit-test-signing-key")
    token = issue_access_token(user_id, key, ttl_seconds=60, now=1_000)

    assert verify_access_token(token, key, now=1_010) == user_id
    with pytest.raises(InvalidTokenError, match="expired"):
        verify_access_token(token, key, now=1_061)
    with pytest.raises(InvalidTokenError, match="signature"):
        verify_access_token(token, SecretStr("another-key"), now=1_010)


def test_workflow_validation_allows_return_cycle() -> None:
    payload = SaveWorkflowRequest(
        nodes=[
            WorkflowNodeResponse(
                id="start",
                kind="start",
                label="Start",
                detail="",
                position_x=0,
                position_y=0,
            ),
            WorkflowNodeResponse(
                id="approval",
                kind="approval",
                label="Approve",
                detail="",
                position_x=100,
                position_y=0,
            ),
            WorkflowNodeResponse(
                id="end",
                kind="end",
                label="End",
                detail="",
                position_x=200,
                position_y=0,
            ),
        ],
        edges=[
            WorkflowEdgeResponse(id="1", source="start", target="approval"),
            WorkflowEdgeResponse(id="2", source="approval", target="end"),
            WorkflowEdgeResponse(
                id="3",
                source="approval",
                target="start",
                outcome="return",
            ),
        ],
    )

    _validate_graph(payload)


def test_workflow_validation_rejects_disconnected_nodes() -> None:
    payload = SaveWorkflowRequest(
        nodes=[
            WorkflowNodeResponse(
                id="start",
                kind="start",
                label="Start",
                detail="",
                position_x=0,
                position_y=0,
            ),
            WorkflowNodeResponse(
                id="end",
                kind="end",
                label="End",
                detail="",
                position_x=100,
                position_y=0,
            ),
        ],
        edges=[],
    )

    with pytest.raises(WorkspaceRepositoryError, match="reachable"):
        _validate_graph(payload)


@pytest.mark.parametrize(
    ("operator", "actual", "expected", "result"),
    [
        ("gt", 60, 50, True),
        ("gte", 50, 50, True),
        ("lt", 49, 50, True),
        ("lte", 50, 50, True),
        ("eq", 50, 50, True),
        ("gt", 40, 50, False),
    ],
)
def test_amount_conditions(
    operator: str,
    actual: int,
    expected: int,
    result: bool,
) -> None:
    condition = {"field": "amount", "operator": operator, "value": expected}
    assert _condition_outcome(condition, {"amount": actual}) is result
