# Архитектура фундамента

## Контуры

```text
Electron renderer (React, без Node.js)
        │ HTTPS / WSS
        ▼
gateway (единственная опубликованная точка)
        │
        ├── FastAPI API
        ├── worker ───── Redis
        ├── scheduler ── Redis
        ├── PostgreSQL
        └── MinIO
```

Desktop загружает только локально собранный renderer. У renderer отключён Node.js, включены context isolation и sandbox; preload публикует только неизменяемые `platform` и `version`. Произвольный IPC, внешняя навигация, новые окна и запросы разрешений запрещены.

Gateway — единственная точка, которую можно подключать к Cloudflare Tunnel. PostgreSQL, Redis и MinIO не публикуют порты хоста. В development gateway слушает только `127.0.0.1:8080`.

## Границы модулей

- `apps/*` — развёртываемые процессы и desktop-клиент;
- `modules/*` — изолированная доменная логика и инструменты миграции;
- `packages/*` — общие контракты без бизнес-состояния;
- `infrastructure/*` — локальная оркестрация и gateway;
- `docs/*` — решения, спецификации, runbooks;
- `tests/*` — кросс-модульные проверки.

На первом шаге API публикует health endpoints и каталог модулей-заглушек. Worker и scheduler являются отдельными процессами, но ещё не выполняют бизнес-задания.

## Конфигурация

Все runtime-настройки поступают через переменные `YUKSALISH_*`. `.env.example` содержит только локальные заглушки; настоящий `.env` исключён из Git и Docker build context. Production-секреты должны поступать из защищённого хранилища целевой машины или CI.

## Наблюдаемость

Python-процессы выводят структурированный JSON в stdout. Docker отвечает за ротацию и доставку журналов. Healthchecks разделены на liveness процесса и готовность инфраструктурных сервисов; глубокие проверки зависимостей API добавляются вместе с реальными репозиториями.

## Следующие архитектурные шаги

1. Подтвердить локальный или удалённый приватный Git-hosting и включить branch protection.
2. Добавить реальные PostgreSQL-модели пользователей, ролей и модулей.
3. Подключить Redis queue и idempotent outbox вместо заглушек worker/scheduler.
4. Настроить MinIO bucket policy, server-side encryption и backup.
5. Подключить HTTPS-домен через Cloudflare Tunnel после получения домена и токена.
