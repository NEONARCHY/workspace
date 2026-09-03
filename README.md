# Yuksalish Workspace

Локальный монорепозиторий новой корпоративной платформы Yuksalish.

## Структура

- `apps/api` — FastAPI API и Alembic migrations;
- `apps/desktop` — защищённая Electron/React/TypeScript оболочка;
- `apps/worker` — фоновые задания;
- `apps/scheduler` — планировщик;
- `modules/hisobot/importer` — проверяемый контракт импорта старого Hisobot;
- `packages` — общие TypeScript-контракты и локализация;
- `infrastructure` — Docker Compose и gateway;
- `tests` — Python unit/integration tests;
- `docs` — архитектурные решения и runbooks.

Production-снимки, SQLite, PDF, EXE, журналы и `.env` намеренно не входят в Git.

## Быстрый старт

```powershell
Copy-Item .env.example .env
.\scripts\bootstrap.ps1
.\scripts\check.ps1
docker compose --env-file .env -f infrastructure\compose.yaml up --build
```

API через gateway: `http://127.0.0.1:8080/api/v1/health/live`.

Для staging и production используются отдельные локальные файлы секретов. Порядок их
подготовки и обязательная проверка описаны в `docs/operations/environments.md`; шаблоны
`.env.staging.example` и `.env.production.example` нельзя запускать без замены заглушек.

Desktop в dev-режиме:

```powershell
pnpm dev:desktop
```

## Импорт Hisobot

Инспекция всегда открывает SQLite только для чтения:

```powershell
.\.venv\Scripts\python.exe -m hisobot_import inspect `
  --database "Hisobot AI\data\hisobot.sqlite3" `
  --archive "Hisobot AI\data\archive"
```

Пишущий импорт требует точного fingerprint, применённых Alembic-миграций и настроек
PostgreSQL/MinIO из локального `.env`:

```powershell
.\.venv\Scripts\python.exe -m hisobot_import apply `
  --database "Hisobot AI\data\hisobot.sqlite3" `
  --archive "Hisobot AI\data\archive" `
  --confirm-fingerprint "<fingerprint из inspect>" `
  --upload-files
```

Повторный запуск того же snapshot и mapping возвращает существующий подтверждённый import
run и не создаёт строки или файлы повторно.

Проверяемые результаты полной двухпроходной Docker-репетиции сохранены в
`docs/import/hisobot-rehearsal-2026-09-02.md`.

## Инженерные правила

- основная ветка — `main`;
- рабочие ветки — `feature/*` и `fix/*`;
- изменения проходят lint, typecheck, tests, build и проверку секретов;
- секреты задаются только на целевой машине или через защищённый CI secret store;
- миграции данных выполняются повторяемо и никогда не изменяют исходный SQLite.
