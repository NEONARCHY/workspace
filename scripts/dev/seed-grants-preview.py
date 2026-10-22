"""Add idempotent grant examples only to the isolated personal development database."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from bootstrap_local import require_personal_database
from sqlalchemy import select, update

from yuksalish_api import grant_service
from yuksalish_api.auth import load_authenticated_user
from yuksalish_api.database import create_database_engine
from yuksalish_api.grant_schemas import GrantAction, GrantCreate, GrantSettingsWrite
from yuksalish_api.grant_tables import grant_requests
from yuksalish_api.position_policy import EXECUTIVE_LEADER_POSITION_NAME
from yuksalish_api.settings import Settings
from yuksalish_api.tables import users


async def main() -> None:
    settings = Settings(_env_file=None)
    require_personal_database(settings)
    engine = create_database_engine(settings)
    try:
        async with engine.begin() as connection:
            people = {}
            for username in ("malika", "aziza", "baxtiyor", "dilshod"):
                person_id = await connection.scalar(select(users.c.id).where(
                    users.c.username == username, users.c.status == "active",
                ))
                if person_id is None:
                    raise RuntimeError("The personal sandbox must contain its sample employees")
                people[username] = person_id
            await connection.execute(update(users).where(users.c.id == people["malika"]).values(
                job_title=EXECUTIVE_LEADER_POSITION_NAME,
            ))
            chair = await load_authenticated_user(connection, people["malika"])
            deputy = await load_authenticated_user(connection, people["aziza"])
            initiator = await load_authenticated_user(connection, people["baxtiyor"])
            executor = await load_authenticated_user(connection, people["dilshod"])
            if not chair or not deputy or not initiator or not executor:
                raise RuntimeError("Sample users must remain active")
            route = await grant_service.get_settings(connection, chair)
            if route.revision == 0:
                await grant_service.save_settings(connection, chair, GrantSettingsWrite(
                    leader_user_id=deputy.id, chair_user_id=chair.id, expected_revision=0,
                ))
            elif (route.leader_user_id, route.chair_user_id) != (str(deputy.id), str(chair.id)):
                raise RuntimeError(
                    "Preview route was changed by its owner; refusing to overwrite it"
                )
            examples = (
                ("launch", "Тест: грант на развитие местных инициатив"),
                ("working", "Тест: подготовка гранта для молодёжных проектов"),
                ("review", "Тест: готовый грант на проверке председателя"),
            )
            for phase, title in examples:
                grant_id = uuid5(NAMESPACE_URL, f"{settings.deployment_id}:grants-preview:{phase}")
                if await connection.scalar(select(grant_requests.c.id).where(
                    grant_requests.c.id == grant_id,
                )):
                    continue
                grant = await grant_service.create_grant(connection, initiator, GrantCreate(
                    request_id=grant_id, title=title,
                    description="Синтетический пример. Подготовить проектную заявку и бюджет.",
                    assignee_id=executor.id, due_at=datetime.now(UTC) + timedelta(days=10),
                ))
                if phase in {"working", "review"}:
                    grant = await grant_service.act_on_grant(
                        connection, chair, grant_id, GrantAction(
                            action="approve_launch", expected_revision=grant.revision,
                        ),
                    )
                if phase == "review":
                    grant = await grant_service.act_on_grant(
                        connection, executor, UUID(grant.id), GrantAction(
                            action="submit", text="Тестовые проектная заявка и бюджет готовы.",
                            expected_revision=grant.revision,
                        ),
                    )
                    await grant_service.act_on_grant(connection, deputy, grant_id, GrantAction(
                        action="approve", expected_revision=grant.revision,
                    ))
            print("Personal grant examples ready: malika=chair, aziza=deputy, baxtiyor=initiator, "
                  "dilshod=executor. Existing preview grants were preserved.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
