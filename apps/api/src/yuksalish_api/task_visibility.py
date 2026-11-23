"""One object-read policy for task lists, cards and linked task metadata."""

from sqlalchemy import exists, func, or_, select, true
from sqlalchemy.sql.elements import ColumnElement

from .auth import AuthenticatedUser
from .position_policy import (
    EXECUTIVE_LEADER_POSITION_NAME,
    is_employee_lifecycle_leader,
    is_human_resources_position,
    is_task_chat_leader,
)
from .tables import hr_settings, task_participants, tasks, users


def _global_title_condition(title: ColumnElement[str]) -> ColumnElement[bool]:
    normalized = func.lower(func.trim(func.regexp_replace(
        func.translate(func.coalesce(title, ""), "\u2018\u2019\u02bb\u02bc`", "'''''"),
        r"\s+", " ", "g",
    )))
    return or_(
        normalized == EXECUTIVE_LEADER_POSITION_NAME.casefold(),
        normalized.op("~")(
            r"^rais(ning)? (birinchi )?o'rinbosari( *[\u2013\u2014-] *ijrochi direktor)?$",
        ),
        normalized.contains("kadr"), normalized.contains("персонал"),
    )


def has_global_task_title_access(user: AuthenticatedUser) -> bool:
    return (
        user.role in {"admin", "superadmin"}
        or is_task_chat_leader(user.job_title)
        or is_human_resources_position(user.job_title)
    )


def task_visibility_condition(user: AuthenticatedUser) -> ColumnElement[bool]:
    if has_global_task_title_access(user):
        return true()

    participant_ids = select(task_participants.c.task_id).where(
        task_participants.c.user_id == user.id,
    )
    personal = or_(
        tasks.c.author_user_id == user.id,
        tasks.c.primary_assignee_user_id == user.id,
        tasks.c.id.in_(participant_ids),
    )
    # An explicitly appointed HR reviewer has the same read access as the HR title.
    configured_hr = exists(select(hr_settings.c.id).where(
        hr_settings.c.id == 1, hr_settings.c.hr_user_id == user.id,
    )).correlate(None)
    if user.department_id is None:
        return or_(personal, configured_hr)

    people = users.alias("task_scope_people")
    same_department = people.c.department_id == user.department_id
    if is_employee_lifecycle_leader(user.job_title):
        # A department head supervises the department; its reporting contact alone
        # (departments.lead_user_id) is not a managerial access grant.
        # Sharing a department with an administrator/chair/deputy/HR does not
        # make that organisation-wide leader the department head's subordinate.
        team_ids = select(people.c.id).where(
            same_department, people.c.id != user.id,
            people.c.role.not_in({"admin", "superadmin"}),
            ~_global_title_condition(people.c.job_title),
            ~exists(select(hr_settings.c.id).where(
                hr_settings.c.id == 1, hr_settings.c.hr_user_id == people.c.id,
            )).correlate(people),
        )
    else:
        # Follow actual reporting relationships, never the manager role alone.
        # UNION also terminates safely if historic directory data contains a cycle.
        reports = select(people.c.id).where(
            same_department, people.c.direct_manager_user_id == user.id,
            people.c.id != user.id,
        ).cte("task_scope_reports", recursive=True)
        reports = reports.union(select(people.c.id).join(
            reports, people.c.direct_manager_user_id == reports.c.id,
        ).where(same_department, people.c.id != user.id))
        team_ids = select(reports.c.id)
    team_participation = select(task_participants.c.task_id).where(
        task_participants.c.user_id.in_(team_ids),
    )
    return or_(
        personal, configured_hr,
        tasks.c.author_user_id.in_(team_ids),
        tasks.c.primary_assignee_user_id.in_(team_ids),
        tasks.c.id.in_(team_participation),
    )
