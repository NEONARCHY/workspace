# Спецификация импорта Hisobot SQLite → PostgreSQL

**Версия контракта:** 1.0.0
**Статус:** контракт реализован; требуется финальная репетиция на новом cutover snapshot
**Источник:** подтверждённый снимок `Hisobot AI` на 2026-09-02 15:51:04
**Machine-readable mapping:** `modules/hisobot/importer/src/hisobot_import/spec/mapping.v1.json`

## 1. Цель

Повторяемо перенести исторические данные Hisobot в новую платформу без изменения исходной SQLite, без отправки старых уведомлений и без молчаливой потери аномальных строк. Один и тот же снимок с той же версией mapping не должен создавать дубли.

## 2. Не входит в версию 1.0.0

- запуск реальных напоминаний и доставок;
- повторная генерация PDF;
- изменение или «исправление» исторического текста отчётов;
- автоматическое объединение неизвестных сотрудников;
- удаление Telegram ID до утверждения политики retention;
- финальный cutover работающего бота.

## 3. Входной пакет

Импорт запускается только для согласованного неизменяемого каталога:

```text
snapshot/
  data/hisobot.sqlite3
  data/archive/**
  PRODUCTION_SHA256SUMS.txt
```

`.env`, токены и исполняемый файл не нужны импортёру. По умолчанию инструмент работает в `inspect/dry-run`; доступ к SQLite открывается через `mode=ro&immutable=1`.

Перед apply обязательны:

1. остановка старого бота или штатный SQLite backup;
2. `PRAGMA integrity_check = ok`;
3. проверка SHA-256 всех входных файлов;
4. отсутствие `-wal`/`-shm`, не включённых в согласованный backup;
5. совпадение схемы с 18 ожидаемыми таблицами;
6. созданный `system_import_runs` со статусом `planned`.

## 4. Идентичность снимка и идемпотентность

`snapshot_fingerprint` — SHA-256 канонического объекта:

```json
{
  "database_sha256": "<sha256>",
  "archive_manifest_sha256": "<sha256>",
  "schema_sha256": "<sha256>"
}
```

Уникальность `system_import_runs` задаётся комбинацией:

```text
(source_system, snapshot_fingerprint, mapping_version)
```

Каждая строка получает канонический `source_key` из первичного/естественного ключа mapping и `source_payload_hash` из нормализованных исходных полей. Повторный запуск:

- с тем же key и hash подтверждает существующую строку;
- с тем же key и другим hash останавливает импорт как конфликт;
- с новым key создаёт новую целевую строку;
- никогда не перезаписывает подтверждённую историю без отдельной migration version.

## 5. Порядок фаз

### Фаза A — preflight

- проверить manifest, целостность и схему;
- собрать только агрегаты и аномалии, не выводя содержимое отчётов;
- сравнить ожидаемые counts;
- создать import run и зафиксировать версию mapping.

### Фаза B — legacy identities

- загрузить текущий справочник сотрудников из отдельно защищённого источника;
- создать `legacy_identity_links` для `employee_key` и Telegram ID;
- одному историческому `employee_key`, отсутствующему в текущей конфигурации, создать архивную quarantined identity без потери трёх отчётов;
- неоднозначные Telegram ID не связывать автоматически.

### Фаза C — бизнес-данные

Последовательность:

1. `reports`;
2. `vacations`;
3. `user_preferences` после разрешения identity;
4. daily summaries;
5. package metadata и файлы;
6. legacy delivery/reminder states;
7. legacy Telegram UI-state.

Каждая фаза коммитится порциями и пишет item ledger. Ошибка порции откатывает только эту порцию; import run остаётся диагностируемым.

### Фаза D — файлы

Старые `file_path` не переносятся как рабочие пути. Для каждого package:

1. извлечь basename через правила Windows path;
2. найти ровно один файл в `data/archive`;
3. проверить его SHA-256 по manifest;
4. загрузить в MinIO по стабильному ключу;
5. сохранить размер, hash, MIME, исходный legacy path и object key;
6. отсутствующие или неоднозначные файлы поместить в quarantine.

Предлагаемый object key:

```text
hisobot/legacy/{scope}/{period_type}/{year}/{source_sha256}.{extension}
```

### Фаза E — reconciliation

- source count = imported + quarantined + explicitly skipped для каждой таблицы;
- число и hash файлов совпадают с manifest;
- естественные ключи уникальны;
- все ссылки identity имеют состояние resolved или quarantined;
- legacy delivery/reminder rows не создали активных jobs;
- выборочные тексты сверяются владельцем через защищённый интерфейс, не через журналы;
- import run получает `validated` только после сохранения отчёта сверки.

## 6. Целевая схема PostgreSQL

Alembic revision `0002_hisobot_import_schema` создаёт:

- `legacy_identity_links` — закрытое сопоставление employee key/Telegram ID с будущим
  пользователем платформы;
- `hisobot_reports`, `hisobot_vacations`, `hisobot_summaries` — неизменяемые исторические
  бизнес-данные;
- `hisobot_report_artifacts` — 47 файлов, на которые ссылаются package-строки SQLite;
- `hisobot_legacy_archive_files` — полный реестр каждого файла snapshot, включая 7 DOCX без
  package-строк;
- `hisobot_legacy_user_preferences`, `hisobot_legacy_delivery_states`,
  `hisobot_legacy_reminder_states`, `hisobot_legacy_ui_messages` — неактивируемое legacy-состояние;
- `system_import_runs`, `system_import_items`, `system_import_quarantine` — журнал запуска,
  построчная сверка и изолированные ошибки.

Во внешние логи попадают только агрегаты, UUID и hashes. Исходные employee key, Telegram ID,
тексты и legacy error details остаются внутри закрытых PostgreSQL-таблиц.

## 7. Табличное отображение

| Источник | Цель | Правило |
|---|---|---|
| `reports` | `hisobot_reports` | natural key `employee_key + report_date`; сохранить исходные времена, late и текст без преобразования |
| `vacations` | `hisobot_vacations` | сохранить through date, автора изменения через legacy identity |
| `user_preferences` | `hisobot_legacy_user_preferences` | сохранить с unresolved legacy identity; перенос в профиль platform user выполняется после подтверждённого identity mapping |
| `daily_summaries`, `hudud_daily_summaries` | `hisobot_summaries` | immutable variants `central_daily`/`hudud_daily` |
| четыре package-таблицы | `hisobot_report_artifacts` | rebase в MinIO, hash verification, сохранить historical counts |
| шесть delivery-таблиц | `hisobot_legacy_delivery_states` | архивировать состояние; не переотправлять |
| `reminders`, `reminder_events` | `hisobot_legacy_reminder_states` | архивировать состояние; не планировать заново |
| `ui_messages` | `hisobot_legacy_ui_messages` | audit/archive only, не использовать как desktop UI-state |
| все файлы `data/archive` | `hisobot_legacy_archive_files` | учесть каждый hash; несвязанные DOCX сохранить как unlinked legacy objects |

Полные source keys и стратегии находятся в versioned JSON mapping.

## 8. Типы и нормализация

- даты `YYYY-MM-DD` → PostgreSQL `date` без смены дня;
- naive datetime интерпретируется как `Asia/Tashkent`, затем сохраняется как `timestamptz` UTC; исходная строка сохраняется в import audit;
- `is_late` → boolean только для `0/1`, иначе quarantine;
- Telegram ID → bigint в закрытой legacy identity таблице;
- content переносится как Unicode без trim, транслитерации или AI-сжатия;
- пустые nullable поля остаются `NULL`, а не пустой строкой;
- статус доставки сохраняется как legacy value плюс нормализованная категория.

## 9. Зафиксированные аномалии baseline

Импорт обязан сохранить и отдельно отчитаться о следующих фактах:

- один архивный `employee_key` отсутствует в текущем config и связан с тремя отчётами;
- 47 package paths являются абсолютными путями старого Windows-ПК, но каждый однозначно сопоставляется с архивом по basename;
- имеются central weekend packages 2026-08-08 и 2026-08-09 при текущем правиле `mon-fri`;
- delivery rows имеют до 80 попыток;
- 113 reminders и 852 reminder events имеют неуспешное состояние;
- основные исторические причины доставки — `chat not found` и timeout.

Weekend-данные сохраняются как исторические. Retry-состояния не активируются в новом scheduler.

## 10. Acceptance baseline текущего снимка

| Таблица | Ожидается |
|---|---:|
| `reports` | 333 |
| `vacations` | 2 |
| `user_preferences` | 37 |
| `daily_summaries` | 23 |
| `hudud_daily_summaries` | 16 |
| `packages` | 24 |
| `hudud_packages` | 16 |
| `weekly_packages` | 4 |
| `hudud_weekly_packages` | 3 |
| `deliveries` | 104 |
| `summary_deliveries` | 26 |
| `hudud_deliveries` | 80 |
| `hudud_summary_deliveries` | 5 |
| `weekly_deliveries` | 18 |
| `hudud_weekly_deliveries` | 15 |
| `reminders` | 235 |
| `reminder_events` | 2238 |
| `ui_messages` | 730 |

Дополнительные контрольные агрегаты: 32 distinct employee keys, 22 report dates, диапазон 2026-08-03—2026-09-02, 89 late reports, 47 PDF и 7 DOCX в архиве.

Суммарно ожидается 3 909 строк из 18 SQLite-таблиц и 54 записи полного файлового реестра —
3 963 item-ledger записи без quarantine. Повторный запуск должен вернуть тот же `run_id` с
`reused=true` и не изменить entity/object counts.

Эти числа относятся только к сохранённому baseline. Финальный cutover snapshot будет новее и получит собственные acceptance counts.

## 11. Безопасность и журналы

- не выводить content, ФИО, Telegram ID, токены и last_error целиком;
- диагностировать строки через source table, hashed source key и error code;
- доступ к raw snapshot и quarantine ограничить migration-ролью;
- MinIO objects сделать private и включить server-side encryption перед production;
- отчёт reconciliation может содержать только агрегаты и хеши;
- исходный снимок после приёмки хранить read-only по политике retention.

## 12. Команды

```powershell
# 1. Получить и отдельно подтвердить fingerprint
.\.venv\Scripts\python.exe -m hisobot_import inspect `
  --database "Hisobot AI\data\hisobot.sqlite3" `
  --archive "Hisobot AI\data\archive"

# 2. Применить миграцию только с тем же fingerprint
.\.venv\Scripts\python.exe -m hisobot_import apply `
  --database "Hisobot AI\data\hisobot.sqlite3" `
  --archive "Hisobot AI\data\archive" `
  --confirm-fingerprint "<sha256 из inspect>" `
  --upload-files
```

Database URL и MinIO credentials берутся только из `YUKSALISH_*` environment variables или
локального `.env`; секреты не передаются аргументами CLI.

## 13. Cutover и rollback

1. Объявить окно, остановить Telegram polling и scheduler.
2. Сделать финальный согласованный backup и новый manifest.
3. Выполнить inspect и dry-run; согласовать аномалии.
4. Выполнить apply в новую пустую import run.
5. Выполнить reconciliation и пользовательскую выборочную проверку.
6. Открыть новую систему; старый бот оставить read-only.
7. При ошибке закрыть новую систему, пометить run `rolled_back`, удалить только строки этого run и вернуть polling старого бота.

Rollback не изменяет исходную SQLite и архивы. Отзыв Telegram-токена выполняется только после принятого окна стабильности.
