import os
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import create_async_engine

from test_project_import_postgres import actor
from yuksalish_api.project_budget_schemas import BudgetArticleWrite
from yuksalish_api.project_budget_service import add_article, load_budget, record_expense, remainder
from yuksalish_api.project_hub_schemas import ProjectHubWrite, ProjectWorkstreamWrite
from yuksalish_api.project_hub_service import save_project, save_workstream
from yuksalish_api.repository import (
    WorkspaceRepositoryError,
    act_on_request,
    create_approval_request,
    delete_approval_request,
    update_approval_request,
)
from yuksalish_api.tables import (
    approval_actions,
    approval_edges,
    approval_nodes,
    approval_requests,
    approval_templates,
    project_budget_articles,
    project_payment_expenses,
)
from yuksalish_api.workspace_schemas import (
    ApprovalActionRequest,
    CreateApprovalRequest,
    UpdateApprovalRequest,
)


@pytest.mark.parametrize("amount", ["1e-10000000", "1e2", "NaN", "-1", "0.1234567890123"])
def test_article_money_never_silently_rounds_or_expands_unbounded_exponents(amount: str) -> None:
    with pytest.raises(ValidationError):
        BudgetArticleWrite(title="Plan", amount=amount, currency="UZS")


def test_remainder_keeps_exact_fraction_and_large_integer() -> None:
    assert remainder("9007199254740990.123456789012", Decimal(1)) == "9007199254740989.123456789012"
    assert remainder("100.50", Decimal(120)) == "-19.50"


@pytest.mark.anyio
@pytest.mark.postgres
async def test_only_final_payment_records_immutable_once_only_expense() -> None:
    url = os.environ.get("YUKSALISH_TEST_DATABASE_URL")
    if not url:
        pytest.skip("YUKSALISH_TEST_DATABASE_URL is not configured")
    engine = create_async_engine(url)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                admin = await actor(connection, "superadmin")
                outsider = await actor(connection, "manager")
                employee = await actor(connection, "employee")
                project = await save_project(connection, admin, ProjectHubWrite(
                    code=f"B-{uuid4().hex[:12]}", title="Exact budget", budget=200,
                    manager_user_id=str(admin.id), access_status="closed",
                ))
                project_id = UUID(project.id)
                direction = await save_workstream(connection, admin, project_id,
                                                 ProjectWorkstreamWrite(title="Activity"))
                planned = BudgetArticleWrite(title="Services", amount="100.50", currency="UZS")
                article = await add_article(connection, admin, project_id, planned)
                duplicate = await add_article(connection, admin, project_id, planned)
                assert duplicate.id == article.id
                assert await connection.scalar(select(func.count()).select_from(
                    project_budget_articles,
                ).where(project_budget_articles.c.project_id == project_id)) == 1
                with pytest.raises(WorkspaceRepositoryError):
                    await load_budget(connection, outsider, project_id)
                with pytest.raises(WorkspaceRepositoryError):
                    await add_article(connection, outsider, project_id, planned)
                template_id = uuid4()
                await connection.execute(insert(approval_templates).values(
                    id=template_id, template_key="payment", name="Budget test",
                    request_kind="payment",
                    version=1_000_000, status="published", form_schema={},
                    created_by_user_id=admin.id, created_at=datetime.now(UTC),
                ))
                for key, kind in [("start", "start"), ("review", "approval"),
                                  ("payment", "approval"), ("completed", "end"),
                                  ("revision", "correction")]:
                    await connection.execute(insert(approval_nodes).values(
                        id=uuid4(), template_id=template_id, node_key=key, kind=kind,
                        title=key, config={"approverUserId": str(admin.id)},
                        position_x=0, position_y=0,
                    ))
                for source, target, outcome in [("start", "review", "submit"),
                                                ("review", "payment", "approve"),
                                                ("payment", "completed", "approve"),
                                                ("revision", "review", "resubmit"),
                                                ("review", "revision", "return")]:
                    await connection.execute(insert(approval_edges).values(
                        id=uuid4(), template_id=template_id, source_node_key=source,
                        target_node_key=target, outcome=outcome, condition={}, sort_order=0,
                    ))
                arguments = dict(title="Payment", amount=120, project_id=project.id,
                                 workstream_id=direction.id, budget_article_id=article.id)
                other_project = await save_project(connection, admin, ProjectHubWrite(
                    code=f"C-{uuid4().hex[:12]}", title="Another project",
                    manager_user_id=str(admin.id),
                ))
                other_direction = await save_workstream(connection, admin, UUID(other_project.id),
                    ProjectWorkstreamWrite(title="Other direction"))
                with pytest.raises(WorkspaceRepositoryError) as wrong_project:
                    await create_approval_request(connection, admin, CreateApprovalRequest(
                        title="Wrong article", amount=1, project_id=other_project.id,
                        workstream_id=other_direction.id, budget_article_id=article.id,
                    ))
                assert wrong_project.value.status_code == 422
                with pytest.raises(WorkspaceRepositoryError) as wrong_currency:
                    await create_approval_request(connection, admin, CreateApprovalRequest(
                        **arguments, currency="USD",
                    ))
                assert wrong_currency.value.status_code == 422
                request = await create_approval_request(connection, admin, CreateApprovalRequest(
                    **arguments,
                ))
                request_id = UUID(request.id)
                assert request.details.budget_article_id == article.id
                assert request.details.budget_article_title == "Services"
                before = await load_budget(connection, admin, project_id)
                assert not before.actual_by_currency
                request = await act_on_request(connection, admin, request_id,
                                              ApprovalActionRequest(action="return", comment="Fix"))
                request = await update_approval_request(connection, admin, request_id,
                    UpdateApprovalRequest(title="Corrected", amount=120))
                assert request.details.budget_article_id == article.id
                assert request.details.project_id == project.id
                request = await act_on_request(connection, admin, request_id,
                                              ApprovalActionRequest(action="resubmit"))
                with pytest.raises(WorkspaceRepositoryError) as forbidden:
                    await act_on_request(connection, employee, request_id,
                                         ApprovalActionRequest(action="approve"))
                assert forbidden.value.status_code == 403
                request = await act_on_request(connection, admin, request_id,
                                              ApprovalActionRequest(action="approve"))
                assert request.status == "running"
                assert not (await load_budget(connection, admin, project_id)).actual_by_currency
                action_count = await connection.scalar(select(func.count()).select_from(
                    approval_actions,
                ).where(approval_actions.c.request_id == request_id))
                # A failed financial validation must roll back the entire final transition,
                # including its action history, just like the API transaction dependency.
                savepoint = await connection.begin_nested()
                try:
                    snapshot = await connection.scalar(select(approval_requests.c.payload).where(
                        approval_requests.c.id == request_id,
                    ))
                    await connection.execute(update(approval_requests).where(
                        approval_requests.c.id == request_id,
                    ).values(payload={**snapshot, "currency": "USD"}))
                    with pytest.raises(WorkspaceRepositoryError) as failed_final:
                        await act_on_request(connection, admin, request_id,
                                             ApprovalActionRequest(action="approve"))
                    assert failed_final.value.status_code == 422
                finally:
                    await savepoint.rollback()
                unchanged = (await connection.execute(select(approval_requests).where(
                    approval_requests.c.id == request_id,
                ))).mappings().one()
                assert unchanged["status"] == "running"
                assert unchanged["active_node_keys"] == ["payment"]
                assert await connection.scalar(select(func.count()).select_from(
                    approval_actions,
                ).where(approval_actions.c.request_id == request_id)) == action_count
                assert not (await load_budget(connection, admin, project_id)).actual_by_currency
                request = await act_on_request(connection, admin, request_id,
                                              ApprovalActionRequest(action="approve"))
                assert request.status == "approved"
                budget = await load_budget(connection, admin, project_id)
                assert budget.articles[0].amount == "100.50"
                assert budget.articles[0].actual_amount == "120"
                assert budget.articles[0].remaining_amount == "-19.50"
                assert budget.remaining_project_amount == "80"
                with pytest.raises(WorkspaceRepositoryError):
                    await act_on_request(connection, admin, request_id,
                                         ApprovalActionRequest(action="approve"))
                payload = await connection.scalar(select(approval_requests.c.payload).where(
                    approval_requests.c.id == request_id,
                ))
                await record_expense(connection, request_id, admin.id, payload, 2)
                assert await connection.scalar(select(func.count()).select_from(
                    project_payment_expenses,
                ).where(project_payment_expenses.c.request_id == request_id)) == 1
                unallocated = await create_approval_request(
                    connection, admin, CreateApprovalRequest(
                        title="No article", amount=10, currency="USD", project_id=project.id,
                        workstream_id=direction.id,
                    ),
                )
                for _ in range(2):
                    await act_on_request(connection, admin, UUID(unallocated.id),
                                         ApprovalActionRequest(action="approve"))
                budget = await load_budget(connection, admin, project_id)
                assert {total.currency: total.amount for total in budget.actual_by_currency} == {
                    "USD": "10", "UZS": "120",
                }
                assert budget.remaining_project_amount == "80"
                assert budget.articles[0].actual_amount == "120"
                cancelled = await create_approval_request(connection, admin, CreateApprovalRequest(
                    title="Cancelled", amount=5, project_id=project.id,
                    workstream_id=direction.id, budget_article_id=article.id,
                ))
                await act_on_request(connection, admin, UUID(cancelled.id),
                                     ApprovalActionRequest(action="cancel"))
                assert (await load_budget(
                    connection, admin, project_id,
                )).articles[0].actual_amount == "120"
                with pytest.raises(WorkspaceRepositoryError):
                    await delete_approval_request(connection, admin, request_id)
                with pytest.raises(WorkspaceRepositoryError):
                    await act_on_request(connection, admin, request_id,
                                         ApprovalActionRequest(action="move", node_key="review"))
                # A reopened/booked request also cannot be revised via a legacy client.
                await connection.execute(update(approval_requests).where(
                    approval_requests.c.id == request_id,
                ).values(status="needs_revision", active_node_keys=["revision"]))
                with pytest.raises(WorkspaceRepositoryError):
                    await update_approval_request(connection, admin, request_id,
                                                  UpdateApprovalRequest(title="Changed", amount=1))
            finally:
                await transaction.rollback()
    finally:
        await engine.dispose()
