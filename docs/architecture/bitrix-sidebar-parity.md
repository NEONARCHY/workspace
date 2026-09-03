# Bitrix baseline: navigation, roles and positions

**Status:** confirmed baseline, implementation is split into vertical packages

**Inspection date:** 2026-09-03
**Goal:** reproduce the left navigation and the business behavior employees use today inside one self-contained Yuksalish Workspace application.

## Safety boundary

- The webhook and `staff.json` stay only in the local ignored folder `ВРЕМЕННО/`.
- The webhook value, employee names, aliases, message bodies, task text, CRM records and calendar events are not copied into Git or this document.
- Inspection used metadata, counts, field definitions, stage definitions and the job-title field only.
- Bitrix is a behavioral reference. Workspace keeps its own name, security model and database; it is not a pixel-for-pixel copy of the Bitrix product.

## Confirmed left navigation

The order is fixed from the supplied screenshot and is already represented in the Workspace shell.

| Order | Tab | Confirmed Bitrix baseline | Workspace package |
|---:|---|---|---|
| 1 | CRM | Standard leads, deals, contacts and companies are all empty | BP-9 |
| 2 | Задачи | 181 tasks; task API is available | BP-5 |
| 3 | Заявки на оплату | Smart process 1038, category 15; 71 items, 13 stages | BP-6 |
| 4 | Лента | Exact structure is not readable with the current webhook scope | BP-8 |
| 5 | Список проектов | Smart process 1042, category 21; 6 items, 5 stages | BP-7 |
| 6 | Согласование поездок | Smart process 1038, category 17; 1 item, 5 stages | BP-7 |
| 7 | Мессенджер | IM API and counters are available; message content was not read | BP-8 |
| 8 | Календарь | One calendar section is available to the webhook owner | BP-8 |
| 9 | Сотрудники | 41 active Bitrix users; 22 of 24 supplied IDs matched | BP-4 |

The shell may show a tab before its package is complete, but it must label the unfinished state honestly. A tab is only considered complete when its full acceptance scenario works against PostgreSQL and passes authorization tests.

## Smart process: payment requests

Bitrix entity type `1038`, category `15` (`Заявки на оплату`).

### Stages in current order

1. Запуск
2. Утверждение финансистом проекта
3. Утверждение финансовым менеджером по проектам
4. Работа с членами Юксалиш
5. Утверждение помощником председателя
6. Утверждение главным бухгалтером
7. Утверждение заместителя председателя
8. Утверждение председателем
9. Ожидает оплаты
10. Оплата
11. Доработка
12. Выполнено
13. Отмена

### Confirmed form fields

- transfer type;
- project name and code;
- source and destination account/card;
- request priority;
- deadline;
- primary and additional files;
- comment and rejection reason;
- trip purpose, start date, end date and employees;
- payment/transfer reason;
- amount in UZS;
- standard title, creator, updater, responsible employee, category, stage and timestamps.

### Confirmed enums

- Transfer type: `Гонорар (с расчетом)`, `Конвертация`, `Другие услуги`.
- Priority: `Обычная`, `Срочная`.
- Payment purpose: `Мероприятия`, `Гонорары`, `Зарплаты`, `Перелеты`, `Оплата за услуги`, `Другие`.

The Workspace graph editor remains the configuration surface. The Bitrix stage list is imported as a versioned template, not hard-coded into UI transitions.

## Smart process: trip approvals

Bitrix entity type `1038`, category `17` (`Согласование поездок`).

1. Запуск
2. Утверждение руководителем
3. Кадровая служба
4. Утверждено
5. Отклонено

Trip purpose, start/end dates and employee selection are shared fields of entity type 1038. Alpha 0.8.0 implements these fields, the five-stage route, correction cycle and immutable history. Until the process owner confirms position IDs, the safe provisional policy is requester → manager → administrator/HR; the workflow is functional but is not yet declared actor-equivalent to Bitrix.

## Smart process: project list

Bitrix entity type `1042`, category `21` (`Общая воронка`).

Stages: `Начало` → `Подготовка` → `Согласование` → `Успех` or `Провал`.

Confirmed fields:

- project budget;
- remaining budget;
- total spent budget;
- project description;
- status: `Новый проект`, `В работе`, `Завершен`;
- currency: `USD`, `UZS`, `EUR`.

## Roles and positions are different things

`Role` is an authorization profile. It determines what a user can see and change. The alpha keeps three assignable security profiles: `employee`, `manager`, `admin`; `superadmin` is reserved and cannot be assigned through the normal editor.

`Position` is an editable organizational title, for example `Moliyachi` or `Dizayner`. It does not grant permissions by itself. A new user receives a role and a position as two separate fields.

Rules for the position catalog:

- create, rename, activate and deactivate; no destructive delete while history or assignments exist;
- inactive positions remain visible on previously assigned employees but cannot be newly assigned;
- renaming a position preserves its stable ID and employee links;
- название должности хранится только на латинице; кириллические и смешанные исходные варианты нормализуются миграцией;
- варианты апострофов сохраняются осознанно и не объединяются автоматически;
- privileged changes are written to an append-only audit event table.

## Position baseline from Bitrix

The supplied file has 24 current staff references but contains names and aliases, not job titles. Job titles were resolved through the Bitrix user API: 22 IDs matched, 2 did not; one matched user has no position. The result contains 20 unique non-empty labels:

1. `"Yuksalish" harakati raisi, Qonunchilik palatasi qo'mita raisi`
2. `Rais birinchi o‘rinbosari – ijrochi direktor`
3. `Rais o‘rinbosari`
4. `Sun’iy intellekt va raqamlashtirish bo‘limi yetakchi mutaxassisi`
5. `Raqamlashtirish va sun'iy intellekt bo'limi boshlig'i`
6. `Moliyachi`
7. `Matbuot kotibi`
8. `Kanselyariya bosh mutaxassisi`
9. `Islohotlarni qoʼllab-quvvatlash va jamoatchilik nazoratini rivojlantirish boʼlimi`
10. `Xalqaro hamkorlikni rivojlantirish bo‘limi bosh mutaxassisi`
11. `Islohotlarni qo‘llab-quvvatlash va umumlashtirish bo‘limi bosh mutaxassisi`
12. `Harakat a’zolari bilan ishlash va tadbirkorlar bilan muloqot bo‘limi boshlig‘i`
13. `Fuqarolik jamiyati institutlari bilan hamkorlik bo'limi boshlig'i`
14. `Fuqarolik jamiyati institutlari bilan aloqalar bo‘limi bosh mutaxassisi`
15. `Dizayner`
16. `Bosh hisobchi`
17. `Auditor`
18. `Inson kapitali bo‘yicha bo‘lim`
19. `Hududiy bo‘linmalar bilan ishlash bo‘limi boshlig‘i`
20. `Xalqaro hamkorlikni rivojlantirish bo‘limi boshlig‘i`

The two unresolved IDs are not guessed. Before a production employee import, they must either be mapped manually or explicitly marked obsolete.

## Delivery sequence

| Package | Result | Dependency | Exit evidence |
|---|---|---|---|
| BP-4 | Navigation shell; employee directory; position catalog; role/position assignment and audit | Current auth alpha | Migration, API authorization tests, desktop tests |
| BP-5 | Bitrix-equivalent task list/card, filters, participants, checklist, comments, files, dependencies and cycles | BP-4 | Characterisation matrix against selected real tasks |
| BP-6 | Payment request form, all 13 stages, decisions, correction loop, files and editable graph | BP-4, then task link from BP-5 | Golden requests complete the same routes and permissions |
| BP-7 | Project list and trip approvals; functional slice delivered in alpha 0.8.0 | BP-4, BP-6 workflow rules | Project lifecycle and trip return/approval scenarios pass; exact trip position IDs remain to verify |
| BP-8 | Messenger parity, activity feed and calendar | BP-4; expanded read-only Bitrix scope for feed | Two-client realtime and selected reference scenarios |
| BP-9 | CRM scope chosen from actual business need, then implemented | Product decision after empty baseline review | Agreed CRM scenarios, not generic unused screens |

Hisobot and the other legacy bots remain separate migration packages and do not block this navigation program.

## Open evidence needed

1. A read-only webhook scope that can inspect activity feed and department structure. The current calls return `insufficient_scope`.
2. Five to ten representative tasks covering normal, overdue, checklist, comments, observers and recurring behavior.
3. Representative approved, rejected and returned payment requests with owners confirming the actual actor rules.
4. A decision on what CRM must do, because all four standard CRM object types are currently empty.

No expanded access is required to continue BP-4 or to build the schema and UI for BP-5/BP-6. It becomes mandatory only before claiming exact parity for the blocked areas.
