"""Fail-closed incoming scopes and immutable administrator access."""

import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.dialects import postgresql

from yuksalish_api import ai_referent_incoming_access as access
from yuksalish_api.auth import AuthenticatedUser


def test_new_incoming_index_name_does_not_collide_with_existing_migrations():
    versions = Path(__file__).resolve().parents[2] / "apps/api/migrations/versions"
    own = versions / "0077_referent_incoming_access.py"

    def indexes(path):
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        return {
            node.args[0].value
            for node in ast.walk(tree)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "create_index"
            and node.args
            and isinstance(node.args[0], ast.Constant)
        }

    new_names = indexes(own)
    assert new_names == {"ix_ai_incoming_agent_responsible"}
    for previous in versions.glob("*.py"):
        if previous.name < own.name:
            assert not new_names.intersection(indexes(previous)), previous.name


@pytest.fixture
def anyio_backend():
    return "asyncio"


def account(role="employee", name="Employee"):
    return AuthenticatedUser(
        id=uuid4(), username="test", full_name=name, role=role, position_id=None, job_title=None
    )


def result(rows):
    value = Mock()
    value.mappings.return_value.one_or_none.return_value = rows
    value.mappings.return_value.one.return_value = rows
    value.mappings.return_value.all.return_value = rows
    return value


@pytest.mark.parametrize(
    "name,key",
    [
        ("Ботир Мардаев", "botir"),
        ("Мардаев Ботир Шавкатович", "botir"),
        ("SAIDA MUSTAFAYEVA", "saida"),
        ("Аскар Маматханов", "askar"),
        ("Askar Mamatxanov", "askar"),
        ("Другой Ботир Мардаев", None),
        ("Ботир Мардаевский", None),
        ("Аскар", None),
        ("", None),
    ],
)
def test_exact_responsible_identity(name, key):
    assert access.named_responsible(name) == key


@pytest.mark.parametrize(
    "title,allowed",
    [
        ("Rais o\u2018rinbosari", True),
        ("Yuksalish harakati raisi", True),
        ("Rais o'rinbosari Yuksalish", True),
        ("Заместитель председателя", True),
        ("Начальник отдела", False),
        ("Rais yordamchisi", False),
        ("Komitet raisi", False),
        ("Председатель комитета", False),
    ],
)
def test_only_chair_and_deputy_titles_get_leadership_default(title, allowed):
    assert access.is_leadership_title(title) is allowed


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "assigned", "responsibles": []},
        {"mode": "all", "responsibles": [{"agentId": "pc", "externalId": "123"}]},
        {"mode": "assigned", "responsibles": [{"agentId": "pc", "externalId": "123"}] * 2},
    ],
)
def test_invalid_or_duplicate_bindings_rejected(payload):
    with pytest.raises(ValidationError):
        access.IncomingAccessUpdate(expected_revision=0, **payload)


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["employee", "manager", "hr"])
async def test_ordinary_roles_have_no_incoming_by_default(role):
    connection = SimpleNamespace(scalar=AsyncMock(return_value=None))
    assert await access.default_incoming_mode(connection, account(role)) == "none"


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["admin", "superadmin"])
async def test_administrators_always_have_all_even_with_stale_deny(role):
    user = account(role)
    assert await access.effective_incoming_mode(Mock(), user, {"mode": "none"}) == "all"


@pytest.mark.anyio
async def test_named_default_is_assigned_and_explicit_deny_wins():
    user = account(name="Саида Мустафаева")
    assert await access.default_incoming_mode(Mock(), user) == "assigned"
    assert await access.effective_incoming_mode(Mock(), user, {"mode": "none"}) == "none"


@pytest.mark.anyio
async def test_named_deputy_binding_gets_full_default():
    connection = SimpleNamespace(scalar=AsyncMock(return_value="umid"))
    assert await access.default_incoming_mode(connection, account("manager")) == "all"
    statement = connection.scalar.call_args.args[0]
    sql = str(
        statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True})
    )
    assert "'askar'" not in sql
    assert "enabled IS true" in sql


@pytest.mark.anyio
async def test_denied_scope_rejects_before_reading_letters(monkeypatch):
    monkeypatch.setattr(access, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(access, "effective_incoming_mode", AsyncMock(return_value="none"))
    connection = SimpleNamespace(execute=AsyncMock(return_value=result(None)))
    with pytest.raises(HTTPException) as caught:
        await access.incoming_scope(connection, account())
    assert caught.value.status_code == 403
    assert connection.execute.await_count == 1


@pytest.mark.anyio
async def test_explicit_binding_is_scoped_by_agent_and_robot_id(monkeypatch):
    monkeypatch.setattr(access, "ensure_module_action", AsyncMock())
    rule = {
        "mode": "assigned",
        "revision": 1,
        "responsibles": [{"agent_id": "pc-A", "external_id": "42"}],
    }
    connection = SimpleNamespace(execute=AsyncMock(return_value=result(rule)))
    mode, scope = await access.incoming_scope(connection, account())
    assert mode == "assigned"
    sql = str(scope.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "agent_id = 'pc-A'" in sql and "responsible_external_id = '42'" in sql
    assert "responsible_user_id" not in sql  # a stale robot mapping cannot widen access


@pytest.mark.anyio
@pytest.mark.parametrize("ambiguous", ["none", "accounts", "robot"])
async def test_automatic_named_scope_fails_closed_on_homonyms(monkeypatch, ambiguous):
    user = account(name="Ботир Мардаев")
    monkeypatch.setattr(access, "ensure_module_action", AsyncMock())
    monkeypatch.setattr(access, "effective_incoming_mode", AsyncMock(return_value="assigned"))
    accounts = [{"id": user.id, "full_name": user.full_name}]
    sources = [
        {
            "agent_id": "pc",
            "responsible_external_id": "42",
            "responsible_display_name": "Botir Mardaev",
        },
        {
            "agent_id": "pc",
            "responsible_external_id": "other",
            "responsible_display_name": "Саида Мустафаева",
        },
    ]
    if ambiguous == "accounts":
        accounts.append({"id": uuid4(), "full_name": "Мардаев Ботир"})
    if ambiguous == "robot":
        sources.append(
            {
                "agent_id": "pc",
                "responsible_external_id": "43",
                "responsible_display_name": "Ботир Мардаев",
            }
        )
    connection = SimpleNamespace(
        execute=AsyncMock(side_effect=[result(None), result(accounts), result(sources)])
    )
    mode, scope = await access.incoming_scope(connection, user)
    assert mode == "assigned"
    sql = str(scope.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    if ambiguous == "none":
        assert "'42'" in sql and "'other'" not in sql
    else:
        assert sql == "false"


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["employee", "manager", "hr"])
async def test_non_admin_cannot_read_or_write_visibility(role):
    with pytest.raises(HTTPException) as caught:
        await access.read_incoming_access(Mock(), account(role))
    assert caught.value.status_code == 403
    with pytest.raises(HTTPException) as caught:
        await access.save_incoming_access(
            Mock(),
            account(role),
            uuid4(),
            access.IncomingAccessUpdate(expected_revision=0, mode="all"),
        )
    assert caught.value.status_code == 403


@pytest.mark.anyio
@pytest.mark.parametrize("role", ["admin", "superadmin"])
async def test_admin_rules_cannot_be_modified(monkeypatch, role):
    monkeypatch.setattr(access, "ensure_module_action", AsyncMock())
    connection = SimpleNamespace(execute=AsyncMock(return_value=result({"role": role})))
    with pytest.raises(HTTPException) as caught:
        await access.save_incoming_access(
            connection,
            account("admin"),
            uuid4(),
            access.IncomingAccessUpdate(expected_revision=0, mode="none"),
        )
    assert caught.value.status_code == 422
    assert connection.execute.await_count == 1


@pytest.mark.anyio
async def test_conflicting_revision_does_not_write(monkeypatch):
    monkeypatch.setattr(access, "ensure_module_action", AsyncMock())
    connection = SimpleNamespace(
        execute=AsyncMock(side_effect=[result({"role": "employee"}), result({"revision": 4})])
    )
    with pytest.raises(HTTPException) as caught:
        await access.save_incoming_access(
            connection,
            account("admin"),
            uuid4(),
            access.IncomingAccessUpdate(expected_revision=3, mode="all"),
        )
    assert caught.value.status_code == 409
    assert connection.execute.await_count == 2


@pytest.mark.anyio
async def test_scoped_employee_cannot_download_global_journal(monkeypatch):
    monkeypatch.setattr(
        access,
        "incoming_visibility",
        AsyncMock(
            return_value=access.IncomingVisibility(
                incoming_mode="assigned", can_view_journals=False, can_manage_visibility=False
            )
        ),
    )
    with pytest.raises(HTTPException) as caught:
        await access.require_full_incoming_access(Mock(), account())
    assert caught.value.status_code == 403
