"""Administrative import: bounded parsing, consent, privacy and atomic retries."""

import asyncio
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from io import BytesIO
from uuid import UUID, uuid4

import openpyxl  # type: ignore[import-untyped]
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from test_task_proposals import scenario
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.repository import WorkspaceRepositoryError
from yuksalish_api.tables import (
    hr_settings,
    task_proposal_import_batches,
    task_proposals,
    tasks,
    users,
    workspace_notifications,
)
from yuksalish_api.task_proposal_import import preview_proposal_workbook
from yuksalish_api.task_proposal_import_service import (
    import_context,
    import_proposals,
    import_result,
)
from yuksalish_api.task_proposal_schemas import (
    TaskProposalDecision,
    TaskProposalImportWrite,
    TaskProposalWrite,
)
from yuksalish_api.task_proposal_service import decide_proposal, list_proposals, propose_task


def workbook(*rows):
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Tasks"
    sheet.append(["№", "Nomi", "Tavsif", "Muddat", "Ijrochi", "Hamijrochilar", "Izoh"])
    for row in rows:
        sheet.append(row)
    stream = BytesIO()
    book.save(stream)
    book.close()
    return stream.getvalue()


def test_preview_preserves_columns_dates_and_uncertainty():
    content = workbook(
        [
            1,
            "Brief title",
            "Long separate description",
            datetime(2031, 6, 1),
            "Aniqlash kerak",
            "Alpha, Beta",
            "Ijrochi taxminan belgilandi",
        ]
    )
    result = preview_proposal_workbook("C:\\source\\tasks.xlsx", content)
    row = result.rows[0]
    assert result.source_name == "tasks.xlsx"
    assert row.title == "Brief title" and row.description == "Long separate description"
    assert row.source_key == "Tasks!2" and row.number_hint == "1"
    assert str(row.due_date_hint) == "2031-06-01" and row.due_at_hint is None
    assert row.coexecutor_hints == ["Alpha", "Beta"]
    assert len(row.warnings) == 3


def test_preview_rejects_formulas_missing_headers_and_overflow():
    with pytest.raises(ValueError, match="формулы"):
        preview_proposal_workbook("tasks.xlsx", workbook([1, "=1+2", "", None, "Alpha"]))
    with pytest.raises(ValueError, match="100 задач"):
        preview_proposal_workbook(
            "tasks.xlsx", workbook(*[[i, f"Task {i}", "", None, "Alpha"] for i in range(101)])
        )
    with pytest.raises(ValueError, match="строки"):
        preview_proposal_workbook("tasks.xlsx", workbook())
    with pytest.raises(ValueError, match="XLSX"):
        preview_proposal_workbook("tasks.docx", b"not-an-xlsx")


async def configure(connection, author, admin):
    await connection.execute(
        update(users)
        .where(users.c.id == author.id)
        .values(
            job_title=EXECUTIVE_LEADER_POSITION_NAME,
        )
    )
    await connection.execute(
        pg_insert(hr_settings)
        .values(
            id=1,
            chair_user_id=author.id,
            updated_by_user_id=admin.id,
            updated_at=datetime.now(UTC),
        )
        .on_conflict_do_update(index_elements=[hr_settings.c.id], set_={"chair_user_id": author.id})
    )
    return replace(author, job_title=EXECUTIVE_LEADER_POSITION_NAME)


def batch(author, assignee, **changes):
    content = {
        "requestId": str(uuid4()),
        "authorUserId": str(author.id),
        "sourceName": "synthetic.xlsx",
        "items": [
            {
                "sourceKey": "Tasks!2",
                "task": {
                    "title": "Imported synthetic task",
                    "assigneeId": str(assignee.id),
                },
            }
        ],
    }
    content.update(changes)
    return TaskProposalImportWrite.model_validate(content)


def test_import_requires_admin_and_configured_distinct_chair():
    async def run():
        async with scenario() as (connection, actors):
            employee, author, admin, assignee = actors
            author = await configure(connection, author, admin)
            assert not (await import_context(connection, employee)).can_import
            assert (await import_context(connection, admin)).chair_user_id == str(author.id)
            with pytest.raises(WorkspaceRepositoryError) as denied:
                await import_proposals(connection, employee, batch(author, assignee))
            assert denied.value.status_code == 403
            with pytest.raises(WorkspaceRepositoryError) as wrong:
                await import_proposals(connection, admin, batch(employee, assignee))
            assert wrong.value.status_code == 422
            # The original employee endpoint must still reject other assignees, even for admins.
            request = TaskProposalWrite(
                request_id=uuid4(),
                author_user_id=author.id,
                task=batch(author, assignee).items[0].task,
            )
            with pytest.raises(WorkspaceRepositoryError, match="сами"):
                await propose_task(connection, admin, request)

    asyncio.run(run())


def test_import_stays_private_and_only_named_chair_materialises_task_once():
    async def run():
        async with scenario() as (connection, actors):
            employee, author, admin, assignee = actors
            author = await configure(connection, author, admin)
            before = await connection.scalar(select(func.count()).select_from(tasks))
            payload = batch(author, assignee)
            result = await import_proposals(connection, admin, payload)
            proposal = result.proposals[0]
            assert not result.reused and proposal.task_id is None
            assert proposal.creator_user_id == str(admin.id)
            assert proposal.task.assignee_id == str(assignee.id)
            assert await connection.scalar(select(func.count()).select_from(tasks)) == before
            assert not await list_proposals(connection, assignee)
            with pytest.raises(WorkspaceRepositoryError) as hidden:
                await import_result(connection, employee, payload.request_id)
            assert hidden.value.status_code == 404
            with pytest.raises(WorkspaceRepositoryError) as no_bypass:
                await decide_proposal(
                    connection, admin, UUID(proposal.id),
                    TaskProposalDecision(action="approve", import_reviewed=True)
                )
            assert no_bypass.value.status_code == 403
            approved = await decide_proposal(
                connection, author, UUID(proposal.id),
                TaskProposalDecision(action="approve", import_reviewed=True)
            )
            again = await decide_proposal(
                connection, author, UUID(proposal.id),
                TaskProposalDecision(action="approve", import_reviewed=True)
            )
            assert approved.task_id and again.task_id == approved.task_id
            assert await connection.scalar(select(func.count()).select_from(tasks)) == before + 1
            saved = (
                (
                    await connection.execute(
                        select(tasks).where(
                            tasks.c.id == UUID(approved.task_id),
                        )
                    )
                )
                .mappings()
                .one()
            )
            assert (saved["primary_assignee_user_id"] == assignee.id
                    and saved["author_user_id"] == author.id)

    asyncio.run(run())


def test_batch_retry_new_uuid_content_and_different_content_are_safe():
    async def run():
        async with scenario() as (connection, actors):
            _, author, admin, assignee = actors
            author = await configure(connection, author, admin)
            payload = batch(author, assignee)
            first = await import_proposals(connection, admin, payload)
            count = await connection.scalar(
                select(func.count()).select_from(workspace_notifications)
            )
            same = await import_proposals(connection, admin, payload)
            new_id = await import_proposals(
                connection,
                admin,
                payload.model_copy(
                    update={
                        "request_id": uuid4(),
                        "source_name": "renamed.xlsx",
                    }
                ),
            )
            assert same.reused and new_id.reused
            assert first.batch_id == new_id.batch_id
            assert (
                await connection.scalar(select(func.count()).select_from(workspace_notifications))
                == count
            )
            changed = payload.model_copy(deep=True)
            changed.items[0].task.title = "Different"
            with pytest.raises(WorkspaceRepositoryError) as conflict:
                await import_proposals(connection, admin, changed)
            assert conflict.value.status_code == 409

    asyncio.run(run())


def test_validation_failure_rolls_back_whole_batch_and_roles_rechecked_on_approval():
    async def run():
        async with scenario() as (connection, actors):
            _, author, admin, assignee = actors
            author = await configure(connection, author, admin)
            payload = batch(author, assignee)
            bad = payload.model_copy(deep=True)
            bad.items.append(bad.items[0].model_copy(deep=True, update={"source_key": "Tasks!3"}))
            bad.items[1].task.due_at = datetime.now(UTC) - timedelta(hours=1)
            with pytest.raises(WorkspaceRepositoryError):
                await import_proposals(connection, admin, bad)
            assert not await connection.scalar(
                select(task_proposal_import_batches.c.id).where(
                    task_proposal_import_batches.c.id == bad.request_id,
                )
            )
            assert not await connection.scalar(
                select(task_proposals.c.id).where(
                    task_proposals.c.import_batch_id == bad.request_id,
                )
            )
            valid = await import_proposals(connection, admin, payload)
            await connection.execute(
                update(users).where(users.c.id == admin.id).values(role="employee")
            )
            with pytest.raises(WorkspaceRepositoryError) as revoked:
                await decide_proposal(
                    connection,
                    author,
                    UUID(valid.proposals[0].id),
                    TaskProposalDecision(action="approve", import_reviewed=True),
                )
            assert revoked.value.status_code == 403

    asyncio.run(run())


def test_other_admin_cannot_duplicate_or_read_private_import_receipt():
    async def run():
        async with scenario() as (connection, actors):
            employee, author, admin, assignee = actors
            author = await configure(connection, author, admin)
            await connection.execute(update(users).where(users.c.id == employee.id)
                                     .values(role="admin"))
            other_admin = replace(employee, role="admin")
            payload = batch(author, assignee)
            result = await import_proposals(connection, admin, payload)
            with pytest.raises(WorkspaceRepositoryError) as private:
                await import_result(connection, other_admin, UUID(result.batch_id))
            assert private.value.status_code == 404
            with pytest.raises(WorkspaceRepositoryError) as duplicate:
                await import_proposals(connection, other_admin,
                                       payload.model_copy(update={"request_id": uuid4()}))
            assert duplicate.value.status_code == 409
            assert await connection.scalar(
                select(func.count()).select_from(task_proposals).where(
                    task_proposals.c.import_batch_id == UUID(result.batch_id),
                ),
            ) == 1

    asyncio.run(run())


def test_import_schema_rejects_duplicate_source_rows_and_forged_provenance():
    from yuksalish_api.task_proposal_schemas import TaskProposalWrite

    raw = {
        "requestId": str(uuid4()),
        "authorUserId": str(uuid4()),
        "sourceName": "x.xlsx",
        "items": [{"sourceKey": "Sheet!2", "task": {"title": "A"}}] * 2,
    }
    with pytest.raises(ValidationError):
        TaskProposalImportWrite.model_validate(raw)
    with pytest.raises(ValidationError):
        TaskProposalWrite.model_validate(
            {
                "requestId": str(uuid4()),
                "authorUserId": str(uuid4()),
                "task": {"title": "A"},
                "importBatchId": str(uuid4()),
            }
        )


def test_unknown_assignee_waits_for_personal_selection_and_legacy_approval_is_blocked():
    async def run():
        async with scenario() as (connection, actors):
            employee, author, admin, _ = actors
            author = await configure(connection, author, admin)
            payload = batch(author, employee)
            payload.items[0].task.assignee_id = None
            result = await import_proposals(connection, admin, payload)
            identifier = UUID(result.proposals[0].id)
            before = await connection.scalar(select(func.count()).select_from(tasks))
            with pytest.raises(WorkspaceRepositoryError) as legacy:
                await decide_proposal(connection, author, identifier,
                                      TaskProposalDecision(action="approve"))
            assert legacy.value.status_code == 409
            with pytest.raises(WorkspaceRepositoryError) as needs_person:
                await decide_proposal(connection, author, identifier,
                                      TaskProposalDecision(action="approve", import_reviewed=True))
            assert needs_person.value.status_code == 422
            assert await connection.scalar(select(func.count()).select_from(tasks)) == before
            deadline = datetime.now(UTC) + timedelta(days=2)
            approved = await decide_proposal(connection, author, identifier, TaskProposalDecision(
                action="approve", import_reviewed=True, assignee_id=employee.id, due_at=deadline,
            ))
            assert approved.task.assignee_id == str(employee.id)
            assert approved.task.due_at == deadline
            with pytest.raises(WorkspaceRepositoryError) as immutable:
                await decide_proposal(connection, author, identifier, TaskProposalDecision(
                    action="approve", import_reviewed=True, assignee_id=admin.id,
                ))
            assert immutable.value.status_code == 409
    asyncio.run(run())


def test_ordinary_proposals_cannot_change_conditions_at_approval():
    async def run():
        async with scenario() as (connection, actors):
            employee, author, _, other = actors
            request = TaskProposalWrite(request_id=uuid4(), author_user_id=author.id,
                                        task=batch(author, employee).items[0].task)
            result = await propose_task(connection, employee, request)
            with pytest.raises(WorkspaceRepositoryError) as denied:
                await decide_proposal(connection, author, UUID(result.id), TaskProposalDecision(
                    action="approve", assignee_id=other.id,
                ))
            assert denied.value.status_code == 422
    asyncio.run(run())
