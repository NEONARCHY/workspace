"""Non-destructive checks of the bootstrap's environment guard."""

import unittest
from uuid import uuid4

from pydantic import SecretStr

from bootstrap_local import require_personal_database

from yuksalish_api.settings import Settings


class PersonalDatabaseGuardTests(unittest.TestCase):
    def settings(self, **overrides: object) -> Settings:
        fields = {
            "environment": "development",
            "deployment_id": uuid4(),
            "database_url": (
                "postgresql+asyncpg://personal_dev:test@postgres:5432/yuksalish_personal_dev"
            ),
            "demo_password": SecretStr("local-sample-password-only"),
            "seed_demo_data": False,
        }
        return Settings(_env_file=None, **(fields | overrides))

    def test_accepts_only_personal_database(self) -> None:
        require_personal_database(self.settings())

    def test_rejects_external_and_shared_environments(self) -> None:
        for overrides in (
            {"environment": "production"},
            {"environment": "test"},
            {"deployment_id": None},
            {"seed_demo_data": True},
            {"demo_password": None},
            {"database_url": (
                "postgresql+asyncpg://personal_dev:test@192.168.31.176:5432/yuksalish_personal_dev"
            )},
            {"database_url": "postgresql+asyncpg://personal_dev:test@postgres:5432/yuksalish"},
            {"database_url": (
                "postgresql+asyncpg://yuksalish:test@postgres:5432/yuksalish_personal_dev"
            )},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(RuntimeError):
                require_personal_database(self.settings(**overrides))


if __name__ == "__main__":
    unittest.main()
