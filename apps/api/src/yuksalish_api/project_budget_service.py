"""Immutable plans and completed ordinary-payment expenses, with no currency conversion."""

from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal, localcontext
from uuid import UUID, uuid4

from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from .access_control import ensure_module_action
from .auth import AuthenticatedUser
from .project_budget_schemas import (
    BudgetArticleWrite,
    ExpenseTotal,
    ProjectBudgetResponse,
)
from .project_hub_schemas import BudgetArticleResponse
from .project_import_schemas import ImportBudgetLine
from .repository import WorkspaceRepositoryError
from .tables import audit_events, project_hub_projects
from .tables import project_budget_articles as articles
from .tables import project_payment_expenses as expenses


def money(value: Decimal | int | str) -> str:
    return format(Decimal(value), "f")


def remainder(planned: str | int, actual: Decimal) -> str:
    with localcontext() as context:
        context.prec = 64
        return money(Decimal(planned) - actual)


async def add_article(
    connection: AsyncConnection, user: AuthenticatedUser, project_id: UUID,
    payload: BudgetArticleWrite,
) -> BudgetArticleResponse:
    from .project_hub_service import _require_project

    await ensure_module_action(connection, user, "project_hub", "edit")
    await _require_project(connection, user, project_id, edit=True, lock=True)
    article_id = payload.idempotency_key
    existing = (await connection.execute(select(articles).where(
        articles.c.id == article_id,
    ))).mappings().first()
    if existing:
        if (existing["project_id"] != project_id or existing["created_by_user_id"] != user.id
                or existing["title"] != payload.title
                or existing["planned_amount"] != payload.amount
                or existing["currency"] != payload.currency
                or existing["funding"] != payload.funding):
            raise WorkspaceRepositoryError(409, "Budget article creation key was already used")
        return next(row for row in await article_choices(connection, [project_id])
                    if row.id == str(article_id))
    await connection.execute(insert(articles).values(
        id=article_id, project_id=project_id, title=payload.title,
        planned_amount=payload.amount, currency=payload.currency, funding=payload.funding,
        created_by_user_id=user.id, created_at=datetime.now(UTC),
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=user.id, action="project_budget.article_created",
        target_type="project_budget_article", target_id=article_id,
        details={"projectId": str(project_id), "plan": payload.model_dump(mode="json")},
        created_at=datetime.now(UTC),
    ))
    return BudgetArticleResponse(
        **payload.model_dump(exclude={"sources", "idempotency_key"}),
        id=str(article_id), project_id=str(project_id),
        remaining_amount=payload.amount,
    )


async def seed_articles(
    connection: AsyncConnection, user_id: UUID, project_id: UUID, import_id: UUID,
    lines: list[ImportBudgetLine],
) -> None:
    # Called inside the import publication transaction; repeated publish never reaches here.
    for line in lines:
        try:
            payload = BudgetArticleWrite.model_validate(line.model_dump())
        except ValueError as error:
            raise WorkspaceRepositoryError(
                422, "Confirm each budget article title and amount",
            ) from error
        await connection.execute(insert(articles).values(
            id=uuid4(), project_id=project_id, title=payload.title,
            planned_amount=payload.amount, currency=payload.currency, funding=payload.funding,
            import_id=import_id, created_by_user_id=user_id, created_at=datetime.now(UTC),
        ))


async def article_choices(
    connection: AsyncConnection, project_ids: list[UUID],
) -> list[BudgetArticleResponse]:
    if not project_ids:
        return []
    rows = (await connection.execute(select(articles).where(
        articles.c.project_id.in_(project_ids),
    ).order_by(articles.c.created_at, articles.c.id))).mappings().all()
    totals = (await connection.execute(select(
        expenses.c.article_id, func.sum(expenses.c.amount),
    ).where(expenses.c.project_id.in_(project_ids)).group_by(expenses.c.article_id))).all()
    by_article = {article_id: Decimal(amount) for article_id, amount in totals}
    return [BudgetArticleResponse(
        id=str(row["id"]), project_id=str(row["project_id"]), title=row["title"],
        amount=row["planned_amount"], currency=row["currency"], funding=row["funding"],
        actual_amount=money(by_article.get(row["id"], Decimal(0))),
        remaining_amount=remainder(row["planned_amount"], by_article.get(row["id"], Decimal(0))),
    ) for row in rows]


async def load_budget(
    connection: AsyncConnection, user: AuthenticatedUser, project_id: UUID,
) -> ProjectBudgetResponse:
    from .project_hub_service import _require_project

    await ensure_module_action(connection, user, "project_hub", "view")
    project = await _require_project(connection, user, project_id, lock=True)
    rows = (await connection.execute(select(expenses.c.currency, func.sum(expenses.c.amount))
        .where(expenses.c.project_id == project_id).group_by(expenses.c.currency))).all()
    totals = {currency: Decimal(amount) for currency, amount in rows}
    return ProjectBudgetResponse(
        project_id=str(project_id), articles=await article_choices(connection, [project_id]),
        actual_by_currency=[ExpenseTotal(currency=key, amount=money(value))
                            for key, value in sorted(totals.items())],
        remaining_project_amount=remainder(
            project["budget"], totals.get(project["currency"], Decimal(0)),
        ),
    )


async def validate_article_link(
    connection: AsyncConnection, article_id: str | None, project_id: str | None, currency: str,
) -> str:
    if not article_id:
        return ""
    try:
        article_uuid = UUID(article_id)
        project_uuid = UUID(project_id or "")
    except ValueError as error:
        raise WorkspaceRepositoryError(422, "Select a project for the budget article") from error
    row = (await connection.execute(select(articles).where(
        articles.c.id == article_uuid, articles.c.project_id == project_uuid,
    ))).mappings().first()
    if row is None or row["currency"] != currency.upper():
        raise WorkspaceRepositoryError(
            422, "Budget article and payment project/currency must match",
        )
    return str(row["title"])


async def ensure_unbooked(connection: AsyncConnection, request_id: UUID) -> None:
    booked = await connection.scalar(
        select(expenses.c.id).where(expenses.c.request_id == request_id),
    )
    if booked:
        raise WorkspaceRepositoryError(
            409, "A recorded payment cannot be reopened, revised or deleted; "
                 "preserve its expense history",
        )


async def record_expense(
    connection: AsyncConnection, request_id: UUID, actor_id: UUID,
    payload: Mapping[str, object], version: int,
) -> None:
    # Caller holds the request row lock and has already authorized the final transition.
    if not payload.get("project_id"):
        return
    project_id = UUID(str(payload["project_id"]))
    await connection.execute(select(project_hub_projects.c.id).where(
        project_hub_projects.c.id == project_id,
    ).with_for_update())
    amount = int(str(payload["amount"]))
    if not 0 < amount <= 9_007_199_254_740_991:
        raise WorkspaceRepositoryError(422, "Payment amount exceeds the exact supported range")
    currency = str(payload["currency"]).upper()
    article_id = str(payload["budget_article_id"]) if payload.get("budget_article_id") else None
    await validate_article_link(connection, article_id, str(project_id), currency)
    existing = (await connection.execute(select(expenses).where(
        expenses.c.request_id == request_id,
    ))).mappings().first()
    if existing:
        if (existing["project_id"] != project_id or existing["amount"] != amount
                or existing["request_version"] != version
                or existing["currency"] != currency
                or str(existing["article_id"] or "") != (article_id or "")):
            raise WorkspaceRepositoryError(409, "The recorded payment snapshot is immutable")
        return
    expense_id = uuid4()
    await connection.execute(insert(expenses).values(
        id=expense_id, request_id=request_id, project_id=project_id,
        article_id=UUID(article_id) if article_id else None, amount=amount, currency=currency,
        request_version=version, snapshot=dict(payload), actor_user_id=actor_id,
        created_at=datetime.now(UTC),
    ))
    await connection.execute(insert(audit_events).values(
        id=uuid4(), actor_user_id=actor_id, action="project_budget.expense_recorded",
        target_type="project_payment_expense", target_id=expense_id,
        details={"requestId": str(request_id), "projectId": str(project_id),
                 "articleId": article_id, "amount": str(amount), "currency": currency,
                 "version": version}, created_at=datetime.now(UTC),
    ))
