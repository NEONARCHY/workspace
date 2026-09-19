# Yuksalish Workspace

Корпоративное рабочее пространство для сотрудников Yuksalish: общение, задачи,
проекты, заявки на оплату, командировки, календарь, сотрудники и управляемые
маршруты согласования в одном продукте.

Этот репозиторий — монорепозиторий Windows-приложения, LAN web-клиента и серверной
части. README служит точкой входа для нового разработчика. Подробные продуктовые
правила, архитектурные решения и эксплуатационные инструкции находятся в `docs/`.

> **Важно:** GitHub хранит исходный код. `git pull` не обновляет уже установленный
> EXE, а `git push` не развёртывает сервер автоматически. Установка клиента,
> публикация обновления и обновление Docker Compose — отдельные операции.

## Состояние проекта

| Компонент | Текущее состояние |
| --- | --- |
| Desktop | Electron + React, версия `1.0.18` |
| LAN web | Тот же React renderer, production-сборка через Vite |
| API | FastAPI, версия Python-пакета `0.23.0` |
| База данных | PostgreSQL 17, Alembic head `0041_expand_message_reactions` |
| Фоновые процессы | отдельные worker и scheduler, Redis |
| Файлы | MinIO |
| Основная среда | Windows, PowerShell, Docker Desktop |
| CI | Python, desktop, release notes и поиск секретов |

Версии root-пакета, desktop и Python API повышаются независимо. Не определяйте
состояние всей системы только по одному номеру: проверяйте `package.json`,
`apps/desktop/package.json`, `pyproject.toml` и актуальный Alembic head.

## Что уже реализовано

- корпоративный мессенджер: личные диалоги, группы, права участников, ответы,
  упоминания, реакции, вложения, голосовые сообщения, поиск и связанные чаты;
- задачи: подробное создание, ответственные и наблюдатели, чек-листы, зависимости,
  повторения, комментарии, файлы, список, Kanban, календарь и проверка результата;
- проекты, заявки на оплату и командировки с защищёнными переходами между стадиями,
  аудитом, возвратом на доработку и версионируемыми маршрутами;
- сотрудники, должности, подразделения, служебные группы и модульные права доступа;
- корпоративная лента, общий календарь, отсутствия, уведомления и обзор команды;
- desktop- и web-клиенты с общей предметной моделью и локализацией;
- управляемые обновления Windows-клиента с историей версий и обязательным режимом;
- импорт исторических данных Hisobot с проверяемым и повторяемым сценарием.

CRM пока остаётся элементом согласованной навигации, а не завершённым модулем.
Актуальные ограничения и правила конкретной области проверяйте в соответствующем
документе из раздела [Карта документации](#карта-документации).

## Архитектура

```text
Electron desktop ───────────────┐
                               │ HTTPS / WSS
LAN browser ── Caddy :8443 ────┼── gateway ── FastAPI ── PostgreSQL
                               │       │          ├────── Redis
                               │       │          └────── MinIO
                               │       └── static web
                               └────────── worker / scheduler
```

- Electron renderer не имеет прямого доступа к Node.js. `preload` публикует только
  ограниченные возможности: защищённую сессию, черновики, уведомления и обновления.
- Gateway — единственная публичная точка приложения. PostgreSQL, Redis и MinIO не
  должны публиковаться в LAN или интернет.
- Desktop и браузер используют общий React renderer. Различия платформ собраны в
  `platform-adapter.ts`.
- Проверка ролей и бизнес-переходов всегда выполняется сервером. Скрытая кнопка в UI
  не является механизмом безопасности.
- API запускает `alembic upgrade head` до старта Uvicorn. Новая схема оформляется
  новой миграцией; уже применённые миграции не редактируются.
- Изменения, создающие несколько связанных сущностей, должны быть атомарными и
  сохранять аудит.

Подробнее: [обзор архитектуры](docs/architecture/overview.md).

## Структура репозитория

```text
apps/
  api/                 FastAPI, routers, services, repositories, Alembic
  desktop/             Electron main/preload и React renderer
  worker/              фоновые задания
  scheduler/           планировщик
modules/
  hisobot/importer/    безопасный импорт старого Hisobot
packages/
  contracts/           общие TypeScript-контракты
  i18n/                русская и узбекская локализация
infrastructure/        Docker Compose, gateway и LAN HTTPS
scripts/               bootstrap, проверки, LAN deployment и перенос сервера
tests/python/          unit- и integration-тесты Python
docs/                  архитектура, дизайн, продуктовые правила и runbooks
```

Ключевые точки входа:

| Задача | Файл или каталог |
| --- | --- |
| Композиция приложения и маршрутизация | `apps/desktop/src/renderer/App.tsx` |
| Клиентские API-вызовы | `apps/desktop/src/renderer/workspace-api.ts` |
| Общая тема и токены | `workspace-theme.ts`, `design-system.css` |
| Electron lifecycle | `apps/desktop/src/main/main.ts` |
| Безопасный bridge | `apps/desktop/src/preload/preload.ts` |
| FastAPI application | `apps/api/src/yuksalish_api/main.py` |
| Серверные маршруты | `apps/api/src/yuksalish_api/routers/` |
| Доступ и роли | `access_control.py`, `position_policy.py` |
| Таблицы и репозиторий | `tables.py`, `repository.py` |
| Общие контракты | `packages/contracts/src/index.ts` |
| Миграции | `apps/api/migrations/versions/` |
| Контейнеры | `infrastructure/compose.yaml` |

## Требования к рабочему компьютеру

- Windows 10/11 и PowerShell;
- Git;
- Node.js `20.20.0` или новее в рамках поддерживаемой major-версии;
- pnpm `10.33.0` через Corepack;
- Python `3.11` (не 3.12+ для текущего backend-контракта);
- Docker Desktop с Docker Compose;
- доступ к приватному GitHub-репозиторию.

Проверьте окружение:

```powershell
git --version
node --version
corepack pnpm --version
python --version
docker version
docker compose version
```

## Первый локальный запуск

### 1. Получить код

```powershell
git clone https://github.com/NEONARCHY/yuksalish-workspace.git
Set-Location "yuksalish-workspace"
git switch main
git pull --ff-only origin main
```

### 2. Подготовить зависимости и development-конфигурацию

```powershell
Copy-Item .env.example .env
corepack enable
.\scripts\bootstrap.ps1
.\scripts\validate-environment.ps1 `
  -Environment development -EnvFile .env
```

`bootstrap.ps1` создаёт `.venv`, устанавливает зависимости из
`requirements.lock.txt`, подключает Python-пакеты репозитория и выполняет `pnpm
install`. Реальные `.env`, базы, вложения, логи и установщики не коммитятся.

### 3. Запустить серверный стек

```powershell
$env:YUKSALISH_ENV_FILE = "../.env"
docker compose --env-file .env -f infrastructure\compose.yaml up -d --build --wait
```

Проверка готовности:

```powershell
docker compose --env-file .env -f infrastructure\compose.yaml ps
Invoke-WebRequest -UseBasicParsing `
  "http://127.0.0.1:8080/api/v1/health/ready"
```

Ожидаемый HTTP-статус — `200`. Миграции применяются контейнером API автоматически.

### 4. Запустить desktop в development-режиме

```powershell
pnpm dev:desktop
```

Development seed создаёт пользователей `aziza`, `baxtiyor`, `dilshod` и `malika`.
Пароль берётся из `YUKSALISH_DEMO_PASSWORD` в локальном `.env`; у Малики роль
администратора. В production demo seed обязан быть выключен.

## Ежедневная разработка

Начинайте задачу от свежего `main`:

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/short-description
```

Для исправлений используйте `fix/short-description`. Один PR должен содержать одну
связанную задачу. Не смешивайте функциональное изменение, массовое форматирование и
посторонний рефакторинг.

Перед каждым commit/push обновите собственный JSON-блок в
`apps/desktop/release-notes/pending/`. Формат:

```json
{
  "id": "20260920-short-description",
  "items": [
    "Понятное пользователю описание фактического изменения."
  ]
}
```

Пункты не должны содержать имена файлов, API, БД или внутренние детали. Не изменяйте
pending-блок другого PR. Затем:

```powershell
pnpm check
git diff --check
git status
git add <файлы-текущей-задачи>
git commit -m "feat: краткое описание"
git push -u origin feature/short-description
```

Создайте Pull Request в `main`, дождитесь зелёных CI-проверок и только затем
выполняйте merge. Прямой push и force push в `main` запрещены. Полный командный
процесс описан в [CONTRIBUTING.md](CONTRIBUTING.md).

## Проверки

Быстрые проверки изменённой desktop-области:

```powershell
pnpm --filter @yuksalish/desktop test
pnpm --filter @yuksalish/desktop lint
pnpm --filter @yuksalish/desktop typecheck
```

Полная TypeScript/desktop-проверка:

```powershell
pnpm check
pnpm audit --audit-level low
```

Python-проверки в подготовленном `.venv`:

```powershell
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy apps modules
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m bandit -q -r apps modules `
  -x tests,apps/api/migrations
.\.venv\Scripts\python.exe -m pip_audit -r requirements.lock.txt
```

Полный локальный сценарий:

```powershell
.\scripts\check.ps1
```

`check.ps1` требует Docker Desktop. Он подготавливает отдельную базу
`yuksalish_test`; не направляйте `YUKSALISH_TEST_DATABASE_URL` на рабочую БД.
Integration-тесты без тестового PostgreSQL пропускаются, поэтому простой `pytest`
без подготовки окружения не равнозначен CI.

CI содержит четыре обязательных задания:

| Job | Что проверяет |
| --- | --- |
| `python` | env-шаблоны, Ruff, mypy, pytest/coverage, Bandit, pip-audit |
| `desktop` | lint, типы, тесты, desktop/web build, Compose, pnpm audit |
| `release-notes` | корректный pending-блок текущего push/PR |
| `secrets` | случайно добавленные ключи, пароли и токены |

Не увеличивайте timeout и не ослабляйте lint/coverage только ради зелёного CI:
сначала устраните причину нестабильности или медленной проверки.

## База данных и миграции

- Источник схемы — последовательность Alembic-миграций.
- Новое изменение схемы получает новую миграцию; применённые файлы не переписываются.
- API автоматически выполняет `alembic upgrade head` при старте контейнера.
- Перед слиянием проверяйте upgrade на отдельной тестовой базе.
- Никогда не используйте `docker compose down -v`, `docker volume prune` или
  `docker system prune --volumes` на сервере с рабочими данными.
- Git не хранит PostgreSQL, MinIO, Redis и опубликованные установщики. Для переноса
  сервера нужен отдельный export/restore, а не копирование репозитория.

Актуальный head можно проверить так:

```powershell
docker compose --env-file .env -f infrastructure\compose.yaml exec api `
  alembic -c apps/api/alembic.ini current
```

## LAN-сервер

LAN — production-режим на одном выделенном Windows-компьютере. Его секреты хранятся
только в `.env.lan`; файл нельзя отправлять в Git или рабочий чат.

Обычное обновление существующего сервера без удаления данных:

```powershell
git switch main
git pull --ff-only origin main
.\scripts\validate-environment.ps1 `
  -Environment production -NetworkMode lan -EnvFile .env.lan
$env:YUKSALISH_ENV_FILE = "../.env.lan"
$env:YUKSALISH_WEB_BUILD_ID = (git rev-parse HEAD).Trim()
docker compose --env-file .env.lan `
  -f infrastructure\compose.yaml `
  -f infrastructure\compose.lan.yaml `
  up -d --build --wait
```

Эта операция пересобирает сервисы, сохраняет Docker volumes и применяет новые
миграции. Перед выполнением всё равно обязательны актуальная резервная копия и
зелёный CI нужного commit.

Проверка:

```powershell
docker compose --env-file .env.lan `
  -f infrastructure\compose.yaml `
  -f infrastructure\compose.lan.yaml ps
Invoke-WebRequest -UseBasicParsing `
  "https://АДРЕС-СЕРВЕРА:8443/api/v1/health/ready"
```

Для web-only deployment используйте `scripts/lan/deploy-web.ps1`. Для переноса
единственного сервера между компьютерами строго следуйте
[lan-server-transfer.md](docs/operations/lan-server-transfer.md): обычный `git pull`
не переносит рабочие данные и вложения.

## Сборка и выпуск Windows-приложения

Локальная сборка установщика:

```powershell
pnpm --filter @yuksalish/desktop dist:win
```

Результат появляется в `apps/desktop/release/` и не коммитится. Перед реальным
распространением нужны проверка установки на отдельном ПК и подпись издателя; без
подписи Windows SmartScreen может показывать предупреждение.

Обычный GitHub push не обновляет сотрудников. Выпуск состоит из отдельных шагов:

1. повысить SemVer desktop и подготовить release notes;
2. пройти CI и собрать установщик;
3. проверить установку и подключение к нужному HTTPS-серверу;
4. загрузить и опубликовать EXE из интерфейса суперадминистратора;
5. только после проверки при необходимости включить обязательное обновление.

Полный runbook: [desktop-updates.md](docs/operations/desktop-updates.md).

## Безопасность и данные

- Не коммитьте `.env`, токены, ключи, рабочие базы, вложения, логи, скриншоты с
  реальными данными и собранные EXE.
- Не передавайте пароль аргументом командной строки и не выводите секреты в логи.
- Renderer не должен получать Node.js API или произвольный IPC.
- Новое действие должно проверять роль и доступ на сервере, даже если UI его скрывает.
- Web refresh-token хранится в `HttpOnly` cookie; desktop refresh-сессия защищена
  Windows DPAPI через Electron `safeStorage`.
- Изменения авторизации, внешней навигации, preload/IPC, загрузок и админ-доступа
  требуют отдельного security review и негативных тестов.

Если секрет попал в commit или лог, считайте его скомпрометированным: отзовите или
замените его, затем очистите источник утечки. Простого удаления строки в следующем
commit недостаточно.

## Карта документации

### Начать отсюда

- [Архитектура системы](docs/architecture/overview.md)
- [Среды и секреты](docs/operations/environments.md)
- [Готовность серверного компьютера](docs/operations/server-readiness.md)
- [Развёртывание LAN web](docs/operations/lan-web-workspace.md)
- [Перенос LAN-сервера](docs/operations/lan-server-transfer.md)
- [Обновления desktop](docs/operations/desktop-updates.md)

### Основные предметные области

- [Задачи](docs/architecture/task-management.md)
- [Мессенджер и группы](docs/architecture/messenger-groups.md)
- [Личная организация чатов и навигации](docs/architecture/personal-organization.md)
- [Заявки на оплату](docs/architecture/payment-workflows.md)
- [Проекты](docs/architecture/project-workflows.md)
- [Командировки](docs/architecture/trip-approvals.md)
- [Подразделения и доступ к модулям](docs/architecture/departments-and-module-access.md)
- [Административные контроли](docs/architecture/administration-controls.md)
- [Уведомления](docs/architecture/notifications.md)
- [Zoom-встречи](docs/architecture/zoom-meetings.md)

### Интерфейс

- [Дизайн-система](docs/design/workspace-design-system.md)
- [Постоянный бриф Workspace 2.0](docs/design/workspace-2-owner-brief.md)
- [Roadmap Workspace 2.0](docs/design/workspace-2-redesign-roadmap.md)
- [Движение и производительность](docs/design/motion-and-rendering.md)
- [Таблицы задач и сотрудников](docs/design/record-lists.md)
- [Создание задач](docs/design/task-composer.md)
- [Календарь](docs/design/workspace-calendar.md)

При расхождении документа с поведением источником истины являются актуальный код,
тесты, миграции и явно принятое продуктовое решение. Исправляйте документацию в том
же PR, где изменили соответствующий контракт.

## Диагностика

Контейнеры и последние серверные логи:

```powershell
docker compose --env-file .env -f infrastructure\compose.yaml ps
docker compose --env-file .env -f infrastructure\compose.yaml `
  logs --tail 100 api gateway worker scheduler
```

Типовой порядок поиска проблемы:

1. зафиксировать точное действие, роль пользователя и время ошибки;
2. проверить health и состояние контейнеров;
3. проверить ошибки API/gateway, не публикуя секреты и персональные данные;
4. сверить Alembic revision и commit клиента/сервера;
5. воспроизвести на тестовых данных;
6. добавить тест, который падал до исправления и проходит после него.

Не очищайте volumes и не пересоздавайте рабочую БД как способ диагностики.

## Владение и передача проекта

Новый разработчик перед первым изменением должен:

1. прочитать этот README и `CONTRIBUTING.md`;
2. поднять локальный стек и получить `200` от health endpoint;
3. выполнить `pnpm check` и Python-проверки;
4. прочитать документы только той предметной области, которую меняет;
5. проверить текущую ветку, `origin/main`, Alembic head и версии пакетов;
6. открыть небольшой PR вместо прямого изменения `main`.

Критичные знания не должны оставаться только в переписке. Если решение влияет на
права, данные, развёртывание, обновления или UX-паттерн, зафиксируйте его в `docs/`
и свяжите с кодом и тестами в том же PR.
