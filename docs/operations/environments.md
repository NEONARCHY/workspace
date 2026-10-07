# Runtime environments and secrets

Yuksalish uses one Compose definition and a separate environment file for each runtime.
Real environment files contain secrets, stay only on the target machine and are ignored by
Git.

| Environment | Tracked template | Local secret file | Purpose |
|---|---|---|---|
| Development | `.env.example` | `.env` | Developer workstation and disposable QA |
| Staging | `.env.staging.example` | `.env.staging` | Pre-production verification with non-production data |
| Production | `.env.production.example` | `.env.production` | Live employee data and services |
| LAN pilot | `.env.lan.example` | `.env.lan` | Single production-mode server on a private LAN |

Never reuse a password, MinIO key, bucket or database between environments. Templates use
obvious placeholders and must never be treated as deployable configuration.

## Prepare an environment file

Development:

```powershell
Copy-Item .env.example .env
.\scripts\validate-environment.ps1 -Environment development -EnvFile .env
```

Staging or production:

```powershell
Copy-Item .env.staging.example .env.staging
# Replace every replace-with value and the example.invalid origin.
.\scripts\validate-environment.ps1 -Environment staging -EnvFile .env.staging
```

The validator intentionally rejects staging and production files containing placeholders,
localhost origins or development-only values.

For a LAN handoff, use `scripts/lan/new-server-environment.ps1` and validate with
`-Environment production -NetworkMode lan -EnvFile .env.lan`. Follow
`docs/operations/lan-server-transfer.md`; do not use Cloudflare credentials for LAN mode.
The separate local demo site may use `YUKSALISH_ENVIRONMENT=test`. `scripts/lan/deploy-web.ps1`
reads the mode from `.env.lan`, validates the LAN origin, and deploys that same environment;
it does not convert a test site into production.

For the reviewed dual LAN/Cloudflare route on the existing office server, follow
`docs/operations/remote-workspace.md`. Do not treat a Tunnel as a new Compose
project or as independent 24/7 hosting.

## Start Compose with an explicit environment

```powershell
$env:YUKSALISH_ENV_FILE = "../.env.staging"
docker compose --env-file .env.staging -f infrastructure\compose.yaml up -d --build
```

For production, use `.env.production` in both places. Do not rely on an implicitly selected
`.env` file during staging or production operations.

Before building the LAN web image, run `scripts/lan/prepare-release-note-order.ps1` from
the full Git clone. It exports only release-note ordering metadata; `.git` and credentials
remain excluded from Docker. Normal LAN deploy/restore scripts do this automatically.

## Secret handling

The optional assistant key is `YUKSALISH_GEMINI_API_KEY` in the server's local environment file (for the test LAN site, `.env.lan`). Never put it in desktop/Vite variables or commit it. Without a key the assistant and generated greetings show a configuration message; scheduled birthday posts and notifications still work.

- Generate unique random values of at least 32 characters for PostgreSQL and MinIO.
- Generate separate random values for `YUKSALISH_AUTH_SIGNING_KEY` and
  `YUKSALISH_AUTH_ENCRYPTION_KEY`; rotating the encryption key requires a planned TOTP reset.
- Keep actual `.env`, `.env.staging` and `.env.production` outside Git and cloud chat.
- Grant filesystem access only to the Windows administrator and service account.
- Back up secrets separately from database and file backups.
- Rotate a secret immediately if it appears in a commit, log, screenshot or message.
- Add the Cloudflare token only after the domain, account and tunnel are created.

The database password embedded in `YUKSALISH_DATABASE_URL` must be URL-safe. PostgreSQL,
Redis and MinIO remain on the internal Docker network; only `gateway` may be connected to a
future Cloudflare Tunnel.

## First production administrator

Keep `YUKSALISH_SEED_DEMO_DATA=false`. After migrations finish, create the first administrator
from an interactive terminal; the command refuses to run after any user exists:

```powershell
docker compose --env-file .env.production -f infrastructure\compose.yaml exec api `
  yuksalish-bootstrap-admin --username admin --full-name "Имя администратора"
```

The password is read twice without being shown or placed in shell history. All later accounts
and password-recovery codes are created by an administrator inside the desktop application.
