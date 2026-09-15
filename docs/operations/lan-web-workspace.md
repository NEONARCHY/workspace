# LAN Web Workspace

## Архитектура

Yuksalish использует один React renderer и общие TypeScript-контракты для двух оболочек.
Electron загружает локальный production renderer и получает только узкие native-возможности через
preload. Браузер получает тот же renderer из контейнера `web`. Различия собраны в
`platform-adapter.ts`, а не распределены по компонентам.

```text
браузер ─ HTTPS/WSS ─┐
                     ├─ Caddy :8443 ─ gateway ─ API / WebSocket
Electron ─ HTTPS/WSS ┘                         └─ web static frontend
```

Web-вход создаёт серверную сессию. Refresh-token находится только в cookie с флагами
`HttpOnly`, `Secure` и `SameSite=Strict`; JavaScript его не получает. Короткий access-token и
CSRF-токен живут в памяти страницы. При обновлении страницы refresh-cookie ротируется и выдаёт
новый access-token. Смена пароля, блокировка, архивирование и отзыв сессии делают следующий
refresh и уже выданные access-токены недействительными. Electron продолжает хранить свой
refresh-token через Windows DPAPI.

## Подготовка после merge

На серверном ПК из корня репозитория:

```powershell
git switch main
git pull --ff-only origin main
```

В `.env.lan` должны остаться Electron origin `null` и точный HTTPS origin браузера:

```text
YUKSALISH_CORS_ORIGINS=["null","https://192.168.0.119:8443"]
```

Не копируйте значение из документа поверх других строк `.env.lan` и не публикуйте файл.
Проверка перед развёртыванием:

```powershell
.\scripts\validate-environment.ps1 -Environment production -NetworkMode lan -EnvFile .env.lan
```

## Сборка и развёртывание web

Скрипт можно запускать из любого каталога. Он не выполняет `git pull`, не создаёт NSIS, не
удаляет volumes и не меняет `.env.lan`:

```powershell
C:\projects\Yuksalish workspace\scripts\lan\deploy-web.ps1
```

Или двойным щелчком/из `cmd`:

```text
C:\projects\Yuksalish workspace\scripts\lan\deploy-web.cmd
```

Эквивалентная Compose-команда для ручной диагностики:

```powershell
$env:YUKSALISH_ENV_FILE = "../.env.lan"
$env:YUKSALISH_WEB_BUILD_ID = (git rev-parse HEAD).Trim()
docker compose --env-file .env.lan `
  -f infrastructure\compose.yaml -f infrastructure\compose.lan.yaml `
  up -d --build --wait api web gateway lan-https
```

`web` собирает хешированные assets. `index.html` и `version.json` не кешируются; assets с
хешами кешируются как immutable. Обычная web-выкладка не меняет версию Electron и не запускает
его update gate.

## Проверка

На сервере:

```powershell
Invoke-WebRequest -UseBasicParsing "https://192.168.0.119:8443/api/v1/health/ready"
Invoke-WebRequest -UseBasicParsing "https://192.168.0.119:8443/"
docker compose --env-file .env.lan `
  -f infrastructure\compose.yaml -f infrastructure\compose.lan.yaml ps
```

Оба HTTP-запроса должны вернуть `200`; второй — HTML с `id="root"`. С другого ПК в той же LAN
откройте `https://192.168.0.119:8443/`, убедитесь, что корневой сертификат установлен, и войдите
существующей учётной записью вручную. Пароли не передаются в команды и тесты.

WebSocket использует тот же origin:
`wss://192.168.0.119:8443/api/v1/events`. После входа индикатор должен вернуться в состояние
«Сервер подключён» после краткого отключения сети.

## Логи и 502

```powershell
docker compose --env-file .env.lan `
  -f infrastructure\compose.yaml -f infrastructure\compose.lan.yaml logs --tail 100 web gateway api
```

При `502` сначала проверьте `docker compose ... ps`, затем health `web`, `gateway` и `api`.
Не перезапускайте PostgreSQL/MinIO ради ошибки frontend. После исправления повторно запустите
`deploy-web.ps1`; он завершится ненулевым кодом, если health не восстановился.

## Безопасный откат frontend

Откат выполняется через Git и пересборку, без удаления данных:

```powershell
git switch --detach <проверенный-коммит>
.\scripts\lan\deploy-web.ps1
git switch main
```

Это пересобирает `web` и совместимый API-образ, но не удаляет volumes. Запрещены
`docker compose down -v`, очистка `postgres-data`, `redis-data`, `minio-data`,
`desktop-updates` и каталогов Caddy. Если откат API несовместим с уже применённой миграцией,
сначала нужен отдельный проверенный план; миграции нельзя откатывать на рабочей БД вслепую.

## Сертификат и поддерживаемые браузеры

Экспорт корневого сертификата:

```powershell
New-Item -ItemType Directory -Path D:\Yuksalish-Certificate -Force
.\scripts\lan\export-root-certificate.ps1 `
  -DestinationFile D:\Yuksalish-Certificate\yuksalish-root.crt
```

На ПК сотрудника установите его по runbook `lan-server-transfer.md` с помощью
`trust-root-certificate.ps1`. Поддерживаются актуальные Microsoft Edge и Google Chrome на
Windows. Firefox использует отдельное хранилище сертификатов и в alpha не является основным
браузером. Browser Notifications требуют явного согласия. Выбор отдельного аудиовыхода зависит
от поддержки `setSinkId`; при её отсутствии используется системный вывод.

Чтобы очистить только кеш интерфейса, откройте настройки сайта браузера для
`192.168.0.119:8443` и удалите cached files. Удаление cookies завершит web-сессию, но не удалит
серверные данные. Не используйте Docker/SQL-команды для очистки кеша браузера.

## Поздний выпуск Electron

Web deployment не создаёт установщик. На контрольной точке Electron проверяется отдельно:

```powershell
pnpm --filter @yuksalish/desktop build
pnpm --filter @yuksalish/desktop dist:win
```

После проверки подписи, хеша и установки готовый `.exe` публикуется через существующий раздел
суперадминистратора. Файлы `release/` не коммитятся.
