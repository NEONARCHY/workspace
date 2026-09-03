# Yuksalish Workspace

Монорепозиторий самодостаточной корпоративной платформы Yuksalish. Главный продукт — единое Windows-приложение для общения, задач и управляемых процессов согласования. Hisobot переносится позже как один из модулей платформы.

## Живая desktop-альфа

Alpha 0.2.0 объединяет три раздела в одном постоянном серверном контуре:

- корпоративный мессенджер с чатами, поиском, отправкой и синхронизацией между клиентами;
- задачи с фильтрами, карточкой, созданием, сменой статуса и серверным хранением;
- заявки на оплату с историей решений, возвратом и повторной отправкой;
- визуальный редактор версионируемого графа согласования без изменения кода;
- development-вход под тестовыми пользователями с ролями сотрудника, руководителя и администратора.

Данные хранятся в PostgreSQL и доступны через FastAPI gateway. Автоматический development-вход предназначен только для локальной проверки: настоящий вход с паролем, TOTP и управлением сессиями ещё не реализован.

Тестовый Windows installer собирается командой:

```powershell
pnpm --filter @yuksalish/desktop dist:win
```

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
docker compose --env-file .env -f infrastructure\compose.yaml up -d --build
.\scripts\check.ps1
```

API через gateway: `http://127.0.0.1:8080/api/v1/health/live`.

`check.ps1` требует запущенный Docker Desktop. Скрипт создаёт отдельную базу `yuksalish_test`, применяет к ней миграции и пересоздаёт только эту тестовую базу; рабочая база `yuksalish` не очищается.

Для staging и production используются отдельные локальные файлы секретов. Порядок их
подготовки и обязательная проверка описаны в `docs/operations/environments.md`; шаблоны
`.env.staging.example` и `.env.production.example` нельзя запускать без замены заглушек.

Desktop в dev-режиме:

```powershell
pnpm dev:desktop
```

Desktop автоматически входит как тестовый пользователь Азиза. Пользователя можно сменить в верхней панели, чтобы проверить права и синхронизацию ролей. Gateway и PostgreSQL должны оставаться запущенными.

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
