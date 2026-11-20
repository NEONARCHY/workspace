from uuid import uuid4

import pytest

from yuksalish_api.auth import AuthenticatedUser
from yuksalish_api.messenger_service import leadership_chat_contexts
from yuksalish_api.position_policy import (
    EXECUTIVE_LEADER_POSITION_NAME,
    is_executive_leader,
    is_task_chat_leader,
)


@pytest.mark.parametrize("title", [
    EXECUTIVE_LEADER_POSITION_NAME,
    EXECUTIVE_LEADER_POSITION_NAME.replace("'", "\u2018"),
    "Rais o'rinbosari", "Raisning o\u2018rinbosari",
    "Rais birinchi o\u2019rinbosari", "Raisning birinchi o\u02bbrinbosari",
    "  RAISNING   BIRINCHI O\u02bcRINBOSARI  ",
    "Rais birinchi o'rinbosari \u2013 ijrochi direktor",
    "Rais birinchi o'rinbosari-ijrochi direktor",
    "Rais o`rinbosari",
])
def test_task_chat_leadership_titles(title: str) -> None:
    assert is_task_chat_leader(title)
    if "rinbosari" in title.casefold():
        assert not is_executive_leader(title)


@pytest.mark.parametrize("title", [
    None, "", "Mutaxassis", "Direktor", "Ijrochi direktor",
    "Rais o'rinbosari yordamchisi", "Viloyat rais o'rinbosari",
    "Rais birinchi o'rinbosari \u2013 ijrochi direktor yordamchisi",
    "Rais birinchi o'rinbosari \u2013 boshqa direktor",
])
def test_unrelated_positions_do_not_gain_task_chats(title: str | None) -> None:
    assert not is_task_chat_leader(title)


@pytest.mark.parametrize(("role", "title", "contexts"), [
    ("employee", "Rais birinchi o'rinbosari \u2013 ijrochi direktor", ("task",)),
    ("manager", "Rais o'rinbosari", ("task",)),
    ("employee", None, ()),
    ("manager", None, ()),
    ("manager", "Rais o'rinbosari yordamchisi", ()),
    ("employee", EXECUTIVE_LEADER_POSITION_NAME, ("project", "project_hub", "trip", "task")),
    ("admin", None, ("project", "project_hub", "trip", "task")),
    ("superadmin", None, ("project", "project_hub", "trip", "task")),
])
def test_exception_is_limited_to_task_context(
    role: str, title: str | None, contexts: tuple[str, ...],
) -> None:
    user = AuthenticatedUser(uuid4(), "test", "Test", None, title, role)
    assert leadership_chat_contexts(user) == contexts
