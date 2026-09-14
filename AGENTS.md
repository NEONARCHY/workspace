# Yuksalish Workspace — guide for coding agents

## Product and architecture

Yuksalish Workspace is a self-hosted corporate desktop workspace. It consists
of a Windows Electron/React application and a FastAPI/PostgreSQL backend.

- `apps/desktop` — Electron shell, React renderer, UI tests and Windows build;
- `apps/api` — FastAPI API, Alembic migrations and business logic;
- `apps/worker`, `apps/scheduler` — background work and scheduled jobs;
- `packages` — shared TypeScript contracts and localisation;
- `infrastructure` — Docker Compose, gateway and runtime infrastructure;
- `docs` — architecture decisions, operations and UX specifications.

Read the relevant document in `docs/` before changing an existing feature.
For user-facing design work, preserve the established soft spatial workspace:
Gilroy typography, restrained brand colours, clear hierarchy, keyboard access,
respect for reduced motion and transform-based motion where possible.

## How to work

1. Inspect the feature and its existing tests before editing.
2. Keep a change focused. Do not mix unrelated reformatting or clean-ups into
   a feature or bug-fix.
3. Preserve backend authorisation and validation. A desktop interaction must
   never bypass a server-side workflow, permission or audit rule.
4. Add or update focused tests when behaviour changes.
5. Update the related document in `docs/` when an API contract, database
   migration, deployment step or user-visible workflow changes.

## Checks

Run the narrowest relevant check while implementing, then run the project
checks before handing off a substantial change:

```powershell
pnpm check
pytest
```

When the desktop packaging path changes, additionally verify the installer:

```powershell
pnpm --filter @yuksalish/desktop dist:win
```

For backend schema changes, create a new Alembic migration; never edit an
existing applied migration. Validate it against the test database before
deployment.

## Data, secrets and releases

- Never commit `.env` files, production databases, user files, installers,
  access tokens or secrets.
- Do not delete or overwrite production data while developing. Prefer
  migrations that are repeatable and reversible where practical.
- A desktop build does not deploy the backend. If a feature changes the API or
  schema, record the required server update and migration in its documentation.
- GitHub push synchronises source code only; it does not update installed
  desktop applications.

## Git collaboration

- Treat `main` as the shared, releasable code line.
- Work in a personal `feature/*` or `fix/*` branch.
- Push the branch, open a Pull Request to `main`, pass CI and obtain review
  before merge.
- Do not force-push, delete or directly push to `main`.
- Before starting work, update from `origin/main`. Before merging an older
  branch, rebase it on `origin/main` and resolve conflicts deliberately.

See `CONTRIBUTING.md` for the full human development workflow.
