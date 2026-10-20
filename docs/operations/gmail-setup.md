# Подключение личных Gmail: запуск оператором

Включение требует отдельного согласованного обновления API, миграции и клиентов.
Создание PR само по себе ничего на офисном сервере не включает. Не меняйте боевую
БД и не отправляйте реальные письма во время автоматических тестов.

## Google Cloud и согласие

1. В принадлежащем организации Google Cloud проекте включите Gmail API.
2. Создайте OAuth consent screen **External** для обычных `gmail.com`, добавьте
   проверенный домен, контакт поддержки, опубликованные политику конфиденциальности
   и условия использования. Не применяйте Workspace Internal к личным аккаунтам.
3. Создайте OAuth client типа **Web application**. Разрешите точный callback,
   например `https://workspace.opinions.uz/api/v1/mail/oauth/callback`.
   Не используйте `192.168.0.119:8443` как Google web callback: нужен домен HTTPS
   с доверенным сертификатом. Сам Workspace можно оставить на LAN; доменный
   callback должен вести на **тот же API и ту же БД**. Нельзя отправлять callback
   на несвязанный облачный экземпляр.
4. Запросите только `https://www.googleapis.com/auth/gmail.readonly` и
   `https://www.googleapis.com/auth/gmail.send`. Чтение — restricted scope;
   для внешнего рабочего запуска требуются применимые процедуры Google verification
   и, при серверной передаче/хранении restricted data, security assessment.
   Наличие кнопки подключения не означает одобрение Google.
5. Для ограниченного пилота Testing добавьте конкретные тестовые аккаунты.
   Testing ограничен тестовыми пользователями (до 100); refresh grants при этих
   scopes истекают через 7 дней. Это не режим постоянного запуска организации.

Источники: [OAuth web-server](https://developers.google.com/identity/protocols/oauth2/web-server),
[Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
[restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
[Testing limits](https://support.google.com/cloud/answer/15549945?hl=en).

## Конфигурация и обновление

В защищённом серверном env задаются:

```dotenv
YUKSALISH_GMAIL_CLIENT_ID=<web-client-id>
YUKSALISH_GMAIL_CLIENT_SECRET=<secret>
YUKSALISH_GMAIL_REDIRECT_URI=https://workspace.opinions.uz/api/v1/mail/oauth/callback
YUKSALISH_GMAIL_ENCRYPTION_KEY=<base64url-32-random-bytes-with-padding>
YUKSALISH_GMAIL_SENDING_ENABLED=false
```

Создайте ключ в защищённой операторской сессии, например
`python -c "import secrets,base64; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())"`.
Не присылайте секрет/ключ в чат, не публикуйте в PR, не коммитьте env. Отдельно
резервируйте ключ в менеджере секретов: без него БД почты не расшифровать.
Не заменяйте ключ работающего сервера случайным: встроенной онлайн-ротации нет;
нужен отдельный миграционный сценарий и проверенная резервная копия.

После разрешения владельца: резервная копия БД, миграция `0111_personal_mail`,
согласованные API/web/EXE. Compose уже передаёт серверный env через `env_file`.
Проверьте health и права «Почта», не ослабляя общую аутентификацию/CSRF.
Сервис с незаполненными параметрами работает без Gmail и показывает настройку,
а не поддельный подключённый ящик. Отправка по умолчанию выключена.

Все внешние прокси/туннели должны исключать query callback из access/error/log
и аналитики. Репозиторный nginx уже исключает exact callback на обоих listeners;
API скрывает query от Uvicorn, httpx URL отключены на INFO. Проверьте также
Cloudflare/другой внешний слой. Не публикуйте содержимое писем в observability.

## Приёмка до включения отправки

- Два отдельных тестовых Gmail и два Workspace сотрудника: подключение,
  отказ/отмена, просроченный и повторный callback, переподключение того же ящика.
- Чужие черновики/файлы/OAuth ID недоступны даже администратору.
- Проверить входящие, поиск, пагинацию, reply/forward и отсутствие загрузки
  внешних изображений; чтение не меняет unread в Gmail.
- Сохранить черновик, открыть повторно, проверить конфликт двух окон и вложения.
- Получить собственный завершённый «На подпись» PDF, сверить предпросмотр;
  исходящие E-XAT письма не должны попадать в этот список.
- Явно включить `YUKSALISH_GMAIL_SENDING_ENABLED=true` только для согласованного
  пилота; подтвердить отправку на свой тестовый адрес. Проверить To/Cc/Bcc,
  текст и неизменность подписанного PDF. Gmail acceptance не равно delivery.
- Прервать ответ после отправки на **тестовом** окружении: `unknown`, без
  автоматического повтора; сверить Sent. Для неразрешённого `unknown` проверить
  Gmail вручную и не создавать новую отправку без осознанного решения человека.
- Создать задачу с выбранными текстом/файлом: обычные права, ответственный,
  соисполнитель, срок, чек-лист; соседняя переписка не видна исполнителям.
- Отключить Gmail; при недоступности Google вручную отозвать доступ в Google
  Account → Security → Third-party connections. Проверить работу старых задач.

Реальные Google Cloud credentials, верификация и этот live-пилот не могут быть
заменены MockTransport тестами. До их завершения не объявляйте массовый запуск.
