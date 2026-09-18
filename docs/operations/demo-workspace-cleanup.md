# Очистка тестового Workspace

Этот runbook удаляет тестовых сотрудников и **все связанные с пользователями данные**:
задачи, заявки, проекты, поездки, чаты, сообщения, ленту, календарь, уведомления,
аудит, авторизационные сессии, файлы в MinIO и runtime-кэш Redis.

Операция сохраняет карточку верхнего Бахтиёра Самугова
(`006a5b58-87de-510a-98fc-995352501e88`) и переносит на неё действующий логин,
пароль и роль супер-администратора из нижней тестовой записи
(`e3dfc070-d520-4a51-9a18-d00c4d9ab582`). В результате в справочнике остаётся один
сотрудник. Это одноразовая операторская операция, а не миграция Alembic.

## 1. Получить код и остановить серверные процессы

Выполнять на серверном компьютере Бахтиёра из корня репозитория. Ниже используется
`.env.lan`; если сервер запущен с другим env-файлом, подставить его путь во всех командах.

```powershell
git switch main
git pull --ff-only origin main

$compose = @(
  "--env-file", ".env.lan",
  "-f", "infrastructure/compose.yaml",
  "-f", "infrastructure/compose.lan.yaml"
)
docker compose @compose stop api worker scheduler
```

PostgreSQL, MinIO и Redis должны оставаться запущенными до завершения команды очистки.

## 2. Обязательная резервная копия

```powershell
$backupDir = Join-Path $PWD ("backups/pre-demo-purge-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Path $backupDir | Out-Null

$postgresId = docker compose @compose ps -q postgres
docker compose @compose exec -T postgres sh -c `
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/pre-demo-purge.dump'
docker cp "${postgresId}:/tmp/pre-demo-purge.dump" (Join-Path $backupDir "database.dump")

$minioVolume = docker volume inspect yuksalish-workspace_minio-data --format '{{.Name}}'
docker run --rm -v "${minioVolume}:/source:ro" -v "${backupDir}:/backup" alpine:3.22 `
  tar -czf /backup/minio-data.tar.gz -C /source .
```

Не продолжать, если `database.dump` или `minio-data.tar.gz` не созданы.

## 3. Dry run

```powershell
docker compose @compose build api
docker compose @compose run --rm --no-deps api python scripts/purge_demo_workspace.py `
  --keeper-user-id 006a5b58-87de-510a-98fc-995352501e88 `
  --credential-source-user-id e3dfc070-d520-4a51-9a18-d00c4d9ab582
```

Команда должна показать сохраняемого пользователя, источник учётных данных, число удаляемых
пользователей и количество связанных таблиц. Без `--confirm` данные не меняются.

## 4. Выполнить очистку

```powershell
docker compose @compose run --rm --no-deps api python scripts/purge_demo_workspace.py `
  --keeper-user-id 006a5b58-87de-510a-98fc-995352501e88 `
  --credential-source-user-id e3dfc070-d520-4a51-9a18-d00c4d9ab582 `
  --confirm PURGE-DEMO-WORKSPACE
```

После успешного завершения старые access/refresh-токены недействительны. Войти нужно прежними
учётными данными нижнего Бахтиёра; они теперь принадлежат сохранённой карточке сотрудника.

## 5. Запустить обновлённый сервер и проверить

```powershell
docker compose @compose up -d --build postgres redis minio api worker scheduler gateway lan-https
docker compose @compose ps
docker compose @compose exec -T postgres sh -c `
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select id,username,full_name,role,status from core_users"'
```

Ожидается одна строка: сохранённый ID Бахтиёра, действующий логин, роль `superadmin` и статус
`active`. Затем проверить вход, пустые задачи/заявки/ленту/мессенджер и загрузку нового файла.

## Откат

При ошибке остановить сервисы и восстановить `database.dump` и `minio-data.tar.gz` по процедуре
из `docs/operations/lan-server-transfer.md`. Не выполнять повторное приглашение сотрудников до
завершения восстановления.
