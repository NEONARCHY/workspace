# Перенос LAN-сервера Yuksalish между компьютерами

Эта инструкция используется для любого планового переноса рабочего сервера Yuksalish
с одного Windows-компьютера на другой. Она переносит PostgreSQL, вложения MinIO,
Redis и опубликованные desktop-обновления. Git переносит только исходный код и не
заменяет этот процесс.

## Главное правило

В каждый момент времени запись принимает только один сервер. Исходный сервер
останавливается во время экспорта и остаётся выключенным после него. Новый сервер
разрешается отдать сотрудникам только после проверки HTTPS, входа, файлов и данных.

```text
старый ПК ── экспорт ── зашифрованный внешний диск ── восстановление ── новый ПК
    │                                                               │
    └──────── после CUTOVER остаётся выключенным ────────────────────┘
```

Не используйте эту инструкцию для обычного обновления кода на том же сервере. Для
обновления существующего сервера достаточно получить проверенный `main` и пересобрать
Compose без удаления volumes.

## Кто выполняет команды

| Обозначение | Где выполняется |
| --- | --- |
| **SOURCE** | старый серверный ПК, где находятся актуальные данные |
| **TARGET** | новый серверный ПК, который станет единственным сервером |
| **CLIENT** | любой другой ПК сотрудника в той же локальной сети |

Перед каждой командой сверяйте обозначение. Команды SOURCE и TARGET нельзя выполнять
в одном окне по привычке.

## Что подготовить заранее

- Merge всех нужных Pull Request в `main` и зелёный CI.
- Git, Docker Desktop, Node.js и pnpm на TARGET по `README.md`.
- Зарезервированный в роутере IPv4 TARGET, например `192.168.0.119`.
- Точную LAN-подсеть, например `192.168.0.0/24`.
- Зашифрованный внешний диск. Предпочтителен BitLocker + NTFS; FAT32 не подходит для
  потенциально крупных файлов.
- Свободное место на TARGET минимум под текущие Docker volumes, резервную копию и
  временную распаковку.
- Окно обслуживания, когда сотрудники не изменяют данные.
- Доступ к учётной записи суперадминистратора без передачи её пароля в Git, чат или
  командную строку.

Запишите значения на бумаге или в защищённой внутренней заметке:

```text
SOURCE repository: ______________________________________
TARGET repository: ______________________________________
Backup directory: _______________________________________
TARGET IPv4: ____________________________________________
LAN subnet: _____________________________________________
Git revision: ___________________________________________
Certificate SHA-256: ____________________________________
Transfer date and operator: _____________________________
```

## 1. Проверка TARGET до остановки SOURCE

### 1.1 Получить правильный IPv4

На TARGET выполнить в PowerShell:

```powershell
Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object InterfaceAlias,IPv4Address,IPv4DefaultGateway
```

Используйте адрес Wi-Fi или Ethernet с default gateway. Адреса Docker/WSL вида
`172.*`, loopback `127.0.0.1` и публичный адрес провайдера не являются LAN-адресом
сервера. После выбора адреса закрепите его в DHCP роутера. Смена IP после выпуска
сертификата потребует нового сертификата и перенастройки клиентов.

### 1.2 Подготовить чистый репозиторий

На TARGET из корня репозитория:

```powershell
git status --short --branch
git fetch origin --prune
git switch main
git pull --ff-only origin main
git rev-parse HEAD
```

Если есть незакоммиченные изменения, не удаляйте их. Сначала выясните владельца и
сохраните работу в отдельной ветке. Не используйте `git reset --hard`.

### 1.3 Убедиться, что назначение действительно пустое

На TARGET выполнить read-only проверки, которым ещё не нужен `.env.lan`:

```powershell
docker ps -a --filter "name=yuksalish-workspace"
docker volume ls --filter "name=yuksalish-workspace"
```

Нормальное состояние для первого восстановления: контейнеров Yuksalish нет и volumes
`yuksalish-workspace_*` отсутствуют. Если они существуют, `restore-handoff.ps1`
намеренно остановится.

Не удаляйте найденные volumes автоматически. Они могут содержать единственную копию
данных. Сначала установите, откуда они появились:

- действующий или старый рабочий сервер — перенос на этот TARGET прекращается;
- незавершённое восстановление — разберите ошибку и сохраните логи;
- подтверждённая пустая тестовая инициализация — удаление выполняется отдельно,
  только по точному списку volumes после явного решения владельца.

Никогда не используйте `docker volume prune`, `docker system prune --volumes` или
`docker compose down -v` для подготовки TARGET.

### 1.4 Предварительно проверить базовые образы

Актуальный Compose использует официальный MinIO из Quay. На TARGET:

```powershell
docker pull alpine:3.22
docker pull quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z
```

Если Compose пытается загрузить `minio/minio` из Docker Hub, репозиторий TARGET не
обновлён до актуального `main`. Сначала исправьте Git-состояние, а не выполняйте
`docker login` к случайному registry. Если tag MinIO в актуальном `main` уже изменён,
используйте значение из `infrastructure/compose.yaml`, а не старый пример выше.

## 2. Проверка SOURCE

На SOURCE обновлять код непосредственно перед экспортом необязательно: в manifest
запишется фактический Git revision и Alembic revision. Однако код должен содержать
актуальные скрипты `scripts/lan`.

Отключите обязательное desktop-обновление в суперадминке. Попросите сотрудников
закончить изменяющие операции, отправить сообщения и закрыть формы.

Из корня репозитория SOURCE выполните одной строкой. Папка назначения должна быть
новой и находиться вне репозитория:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\export-handoff.ps1" -BackupDirectory "E:\Yuksalish-Handoff-YYYY-MM-DD" -SourceEnvFile ".env.lan" -PreflightOnly
```

Preflight проверяет сервисы, TOTP, Alembic, число пользователей и обязательную
политику обновления, но ничего не останавливает.

Если preflight успешен, объявите начало окна обслуживания и выполните:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\export-handoff.ps1" -BackupDirectory "E:\Yuksalish-Handoff-YYYY-MM-DD" -SourceEnvFile ".env.lan" -ConfirmCutover
```

Введите `CUTOVER` только после прекращения работы сотрудников. Скрипт:

1. останавливает процессы записи;
2. создаёт логический dump PostgreSQL;
3. останавливает data services;
4. архивирует MinIO, Redis и desktop-updates через Docker API;
5. рассчитывает SHA-256;
6. создаёт `manifest.json`;
7. оставляет SOURCE остановленным.

На внешнем диске должны появиться:

```text
manifest.json
database.dump
minio-data.tar.gz
redis-data.tar.gz
desktop-updates.tar.gz
```

Не продолжайте с неполной папкой или пустым файлом. Не включайте SOURCE после
успешного CUTOVER.

## 3. Создание окружения TARGET

Подключите внешний диск к TARGET. Не копируйте `.env` SOURCE: новый сервер должен
получить новые случайные секреты.

Из корня репозитория TARGET один раз выполните:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\new-server-environment.ps1" -ServerIp "192.168.0.119" -BackupDirectory "E:\Yuksalish-Handoff-YYYY-MM-DD"
```

Подставьте реальный IP и букву диска. Скрипт создаёт `.env.lan` и отказывается
перезаписывать существующий файл.

Ошибка `.env.lan already exists; refusing to overwrite secrets` означает, что
окружение уже создавалось. Не повторяйте команду. Проверьте существующий файл:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\validate-environment.ps1" -Environment production -EnvFile ".env.lan" -NetworkMode lan
```

Удалять или заменять `.env.lan` можно только после выяснения происхождения файла. При
подтверждённом продолжении того же переноса используйте существующий `.env.lan`.

## 4. Восстановление на TARGET

Сначала выполните безопасную проверку:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\restore-handoff.ps1" -BackupDirectory "E:\Yuksalish-Handoff-YYYY-MM-DD" -PreflightOnly
```

Ожидаемый результат:

```text
Preflight passed: all checksums match and the destination project is empty.
```

Затем выполните восстановление ровно один раз:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\restore-handoff.ps1" -BackupDirectory "E:\Yuksalish-Handoff-YYYY-MM-DD" -ConfirmEmptyTarget
```

Введите `RESTORE`. Скрипт восстановит volumes и БД, сверит количество пользователей,
соберёт сервисы, применит Alembic migrations и дождётся healthchecks.

Успешное окончание:

```text
LAN server restored. Check HTTPS, account login, attachments and updates before cutover.
```

Если восстановление завершилось ошибкой после создания volumes, не запускайте его
повторно. Зафиксируйте:

```powershell
docker compose --env-file .env.lan -f infrastructure/compose.yaml -f infrastructure/compose.lan.yaml ps -a
docker compose --env-file .env.lan -f infrastructure/compose.yaml -f infrastructure/compose.lan.yaml logs --tail 200 postgres minio redis api gateway lan-https
docker volume ls --filter "name=yuksalish-workspace"
```

После этого исправьте первопричину. Повторное восстановление требует снова доказать,
что TARGET не содержит нужных данных. Не очищайте его догадкой.

## 5. Windows-сеть и firewall TARGET

Проверьте профиль сети:

```powershell
Get-NetConnectionProfile
```

Если сеть Public, откройте PowerShell **от имени администратора** и выполните:

```powershell
Set-NetConnectionProfile -InterfaceAlias "Беспроводная сеть" -NetworkCategory Private
```

Подставьте фактический `InterfaceAlias`. Ошибка `PermissionDenied` обычно означает,
что PowerShell запущен не от администратора или изменение запрещено Group Policy.
Не скрывайте ошибку созданием широкого публичного правила.

В административном PowerShell создайте правило только для нужной подсети:

```powershell
New-NetFirewallRule -DisplayName "Yuksalish LAN HTTPS" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8443 -LocalAddress "192.168.0.119" -RemoteAddress "192.168.0.0/24" -Profile Private
```

Не открывайте порт на роутере и не публикуйте PostgreSQL, Redis или MinIO.

## 6. HTTPS-сертификат

Caddy создаёт внутренний CA на TARGET. Приватный ключ остаётся в volume
`yuksalish-workspace_lan-caddy-data`; сотрудникам выдаётся только публичный root
certificate.

На TARGET после запуска `lan-https` экспортируйте сертификат:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\export-root-certificate.ps1" -DestinationFile "E:\Yuksalish-LAN-root.crt"
```

Запишите показанный SHA-256 отдельно. На каждом CLIENT выполните одной строкой из
корня репозитория или папки со скриптом:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\lan\trust-root-certificate.ps1" -CertificateFile "E:\Yuksalish-LAN-root.crt" -ExpectedSha256 "<64-символьный-SHA-256>"
```

Использование `powershell.exe -ExecutionPolicy Bypass -File` влияет только на этот
запуск и устраняет ошибку `PSSecurityException: выполнение сценариев отключено`.
Не вводите сам пароль или путь к скрипту как отдельную PowerShell-команду.

Сертификат доверяется текущему Windows-пользователю. Если приложение запускается под
другой учётной записью Windows, сертификат нужно установить и для неё.

Актуальный `infrastructure/lan/Caddyfile` содержит `default_sni` для IP-клиентов
Windows. Если после обновления кода TLS продолжает падать, пересоздайте только HTTPS
service:

```powershell
docker compose --env-file .env.lan -f infrastructure/compose.yaml -f infrastructure/compose.lan.yaml up -d --force-recreate lan-https
```

Не помогает ручное включение TLS 1.2, если корневой сертификат не установлен или
Caddy использует другой IP.

## 7. Обязательные проверки до допуска сотрудников

### На TARGET

```powershell
docker compose --env-file .env.lan -f infrastructure/compose.yaml -f infrastructure/compose.lan.yaml ps -a
Invoke-WebRequest -UseBasicParsing "https://192.168.0.119:8443/api/v1/health/ready"
```

Все сервисы должны быть healthy, а readiness — `StatusCode 200`.

### На отдельном CLIENT

После доверия сертификату:

```powershell
Invoke-WebRequest -UseBasicParsing "https://192.168.0.119:8443/api/v1/health/ready"
```

Затем вручную проверить:

- вход существующей учётной записью;
- ожидаемое число сотрудников и доступные модули;
- последние задачи и чаты;
- открытие старого вложения;
- загрузку и скачивание нового тестового вложения;
- отправку тестового сообщения;
- WebSocket/живое обновление на двух клиентах;
- выход и повторный вход;
- настройки суперадминистратора;
- опубликованные desktop-релизы и выключенный обязательный режим.

Сравните ключевые значения с `manifest.json`, не публикуя его содержимое.

## 8. Переключение и хранение старого сервера

После успешных проверок объявите TARGET единственным сервером. SOURCE оставьте
выключенным и не удаляйте его volumes до завершения согласованного периода хранения.
Внешнюю резервную копию также сохраните.

Откат простым включением SOURCE допустим только до первой новой записи на TARGET. Как
только на TARGET создано сообщение, задача, файл или изменение профиля, базы уже
расходятся. Для возвращения на SOURCE потребуется новый перенос в обратную сторону.

На TARGET включите автозапуск Docker Desktop при входе в Windows, отключите сон при
питании от сети и проверьте восстановление сервисов после контролируемой перезагрузки.

## 9. Частые ошибки

| Сообщение или симптом | Причина | Что делать |
| --- | --- | --- |
| `.env.lan already exists` | Окружение уже создавалось | Не перезаписывать; выполнить `validate-environment.ps1` |
| `Destination containers already exist` | Compose уже запускали на TARGET | Проверить данные; не повторять restore поверх контейнеров |
| `Destination volume ... already exists` | Остался volume или TARGET не пуст | Проверить происхождение; не использовать prune/down -v |
| `pull access denied for minio/minio` | Старый Compose использует Docker Hub | Получить актуальный `main` с образом `quay.io/minio/minio` |
| `Could not create SSL/TLS secure channel` | Не доверен CA, неверный IP или старый Caddy config | Проверить SHA-256, trust script и `default_sni`; пересоздать `lan-https` |
| `PSSecurityException` | Windows блокирует `.ps1` | Запускать одной строкой через `powershell.exe -ExecutionPolicy Bypass -File` |
| Health работает на TARGET, но не на CLIENT | Firewall, Public network, VLAN/guest isolation или CA | Проверить Private profile, правило `/24`, маршрутизацию и сертификат |
| `502 Bad Gateway` | API unhealthy или gateway видит старый контейнер | Смотреть `ps -a` и логи API/gateway; не восстанавливать БД повторно |
| После `git pull` пользователь не входит | Git не переносит БД или клиент смотрит на `127.0.0.1` | Проверить восстановленную БД и адрес API в клиенте |
| Старый EXE не видит сервер | Он собран с прежним API origin | Один раз установить сборку для нового LAN IP |

## 10. Диагностика без изменения данных

```powershell
docker compose --env-file .env.lan -f infrastructure/compose.yaml -f infrastructure/compose.lan.yaml ps -a
docker compose --env-file .env.lan -f infrastructure/compose.yaml -f infrastructure/compose.lan.yaml logs --tail 200 api gateway lan-https
docker volume ls --filter "name=yuksalish-workspace"
Get-NetConnectionProfile
Get-NetTCPConnection -LocalPort 8443 -State Listen
Invoke-WebRequest -UseBasicParsing "https://192.168.0.119:8443/api/v1/health/ready"
```

Эти команды безопасны для первичного сбора фактов. Не переходите к удалению volumes,
повторному restore или запуску SOURCE, пока не определена причина.

## 11. Завершение переноса

Перенос считается завершённым, когда отмечены все пункты:

- [ ] SOURCE остановлен и не принимает записи.
- [ ] Backup содержит manifest, database dump и три архива.
- [ ] SHA-256 проверены restore-скриптом.
- [ ] TARGET использует актуальный `main`.
- [ ] TARGET IP закреплён в DHCP.
- [ ] Windows network profile — Private.
- [ ] Firewall разрешает только TCP 8443 из нужной LAN-подсети.
- [ ] Все Docker services healthy.
- [ ] Readiness возвращает 200 на TARGET и отдельном CLIENT.
- [ ] Публичный root certificate установлен на CLIENT с проверкой отпечатка.
- [ ] Вход, данные, чаты, файлы и живые события проверены.
- [ ] Обязательное обновление остаётся выключенным до проверки клиентов.
- [ ] Docker запускается после перезагрузки TARGET.
- [ ] SOURCE volumes и внешний backup сохранены для контролируемого восстановления.
- [ ] Записаны дата, операторы, Git revision, IP и certificate SHA-256.

Связанные документы:

- `docs/operations/environments.md`
- `docs/operations/server-readiness.md`
- `docs/operations/desktop-updates.md`
- `docs/operations/lan-server-handoff.md` — история первого переноса.
