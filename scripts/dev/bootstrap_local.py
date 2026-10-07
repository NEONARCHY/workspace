"""Initialize only the isolated personal sandbox; never reseed an existing workspace."""

import asyncio
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from sqlalchemy import func, select
from sqlalchemy.engine import make_url

from yuksalish_api.database import create_database_engine
from yuksalish_api.seed import seed_demo_data
from yuksalish_api.settings import Settings
from yuksalish_api.tables import users


def require_personal_database(settings: Settings) -> None:
    url = make_url(settings.database_url)
    if (
        settings.environment != "development"
        or settings.deployment_id is None
        or settings.seed_demo_data
        or url.drivername != "postgresql+asyncpg"
        or url.host != "postgres"
        or url.port != 5432
        or url.database != "yuksalish_personal_dev"
        or url.username != "personal_dev"
        or settings.demo_password is None
    ):
        raise RuntimeError(
            "Refusing to initialize anything except the personal development database"
        )


def ensure_certificate(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    certificate_file = directory / "localhost.crt"
    key_file = directory / "localhost.key"
    if certificate_file.exists() and key_file.exists():
        certificate = x509.load_pem_x509_certificate(certificate_file.read_bytes())
        if certificate.not_valid_after_utc > datetime.now(UTC) + timedelta(days=7):
            return
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, "Yuksalish personal development (localhost)")
    ])
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=5))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.SubjectAlternativeName([
            x509.DNSName("localhost"), x509.IPAddress(ip_address("127.0.0.1")),
        ]), critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    key_file.write_bytes(key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ))
    key_file.chmod(0o600)
    certificate_file.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))


async def initialize(settings: Settings) -> None:
    require_personal_database(settings)
    engine = create_database_engine(settings)
    try:
        async with engine.connect() as connection:
            count = await connection.scalar(select(func.count()).select_from(users))
        if count == 0:
            await seed_demo_data(engine, settings.demo_password)
            print(
                "Personal sandbox initialized with sample users (malika, aziza, baxtiyor, dilshod)."
            )
        else:
            print("Personal sandbox already initialized; keeping existing data and passwords.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    local_settings = Settings(_env_file=None)
    require_personal_database(local_settings)
    ensure_certificate(Path("/workspace/local-tls"))
    asyncio.run(initialize(local_settings))
