from uuid import uuid4

import pytest
from pydantic import SecretStr

from yuksalish_api.auth import (
    InvalidTokenError,
    issue_access_token,
    read_access_token,
    verify_access_token,
)
from yuksalish_api.auth_service import (
    AuthServiceError,
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_totp,
    hash_password,
    validate_password,
    verify_password,
    verify_totp,
)
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    _condition_outcome,
    _validate_graph,
    person_from_record,
)
from yuksalish_api.workspace_schemas import (
    SaveWorkflowRequest,
    WorkflowEdgeResponse,
    WorkflowNodeResponse,
)


def test_person_from_legacy_record_defaults_to_active_status() -> None:
    person = person_from_record(
        {
            "id": uuid4(),
            "username": "legacy.employee",
            "full_name": "Legacy Employee",
            "role": "employee",
            "department_id": None,
            "position_id": None,
            "job_title": "Specialist",
        }
    )

    assert person.status == "active"


def test_signed_access_token_round_trip_and_expiration() -> None:
    user_id = uuid4()
    key = SecretStr("unit-test-signing-key")
    token = issue_access_token(user_id, key, ttl_seconds=60, now=1_000)

    assert verify_access_token(token, key, now=1_010) == user_id
    with pytest.raises(InvalidTokenError, match="expired"):
        verify_access_token(token, key, now=1_061)
    with pytest.raises(InvalidTokenError, match="signature"):
        verify_access_token(token, SecretStr("another-key"), now=1_010)


def test_session_access_token_contains_revocable_session_id() -> None:
    user_id = uuid4()
    session_id = uuid4()
    key = SecretStr("unit-test-signing-key")
    token = issue_access_token(
        user_id,
        key,
        session_id=session_id,
        ttl_seconds=60,
        now=1_000,
    )

    claims = read_access_token(token, key, now=1_010)

    assert claims.user_id == user_id
    assert claims.session_id == session_id
    assert claims.expires_at == 1_060


def test_password_hash_policy_and_verification() -> None:
    validate_password("Secure-Password-2026!", "new.employee")
    password_hash = hash_password("Secure-Password-2026!")

    assert verify_password(password_hash, "Secure-Password-2026!") is True
    assert verify_password(password_hash, "Wrong-Password-2026!") is False
    with pytest.raises(AuthServiceError, match="upper, lower"):
        validate_password("onlylowercase", "employee")
    with pytest.raises(AuthServiceError, match="username"):
        validate_password("Employee-Password-2026!", "employee")


def test_totp_rfc_vector_encryption_and_replay_guard() -> None:
    secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    code, step = generate_totp(secret, at_time=59)

    assert code == "287082"
    assert verify_totp(secret, code, at_time=59) == step
    assert verify_totp(secret, code, at_time=59, last_used_step=step) is None

    encryption_key = SecretStr("unit-test-encryption-key")
    ciphertext = encrypt_totp_secret(secret, encryption_key)
    assert secret not in ciphertext
    assert decrypt_totp_secret(ciphertext, encryption_key) == secret
    with pytest.raises(AuthServiceError, match="cannot be decrypted"):
        decrypt_totp_secret(ciphertext, SecretStr("wrong-key"))


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
