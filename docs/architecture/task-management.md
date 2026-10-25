# Task management

**Status:** implemented through desktop 0.28.0 / API 0.23.0

## Product flow

A task is a persistent PostgreSQL object with an author, primary assignee, project,
priority, deadline and lifecycle status. The desktop client presents one filtered
dataset as a table, a Kanban board or a monthly task calendar. The former toolbar
overview is a separate `team_overview` page in the main sidebar. Its initial visibility
is granted to three executive positions and remains configurable through position-level
module access rules. Selecting a task in
any view opens the same full card; changing a Kanban column uses the normal status
API, so server-side access and dependency rules cannot be bypassed by the UI.

The open task card uses recessed dark fills rather than visible section outlines
in dark mode. Light section surfaces remain unchanged. The transparent dark border
reserves the same geometry; controls, status labels and forced-colour boundaries
remain visible. Participant avatars are 32 px (formerly 24 px), and the header assignee
avatar is 48 px (formerly 36 px), shared by both palettes. Employee cards and avatars
have a soft light edge or the existing satin dark edge; profile links and removal
actions retain their previous behaviour.

The route/history disclosure expands downwards over 260 ms, including asynchronous
content-size changes. Only its measured local height animates; no per-frame React
renders or document-wide resize loop. Collapsed content is inert/aria-hidden;
reduced motion and forced colours switch immediately. Participant scope tabs fill
the form width with two compact equal segments. Recurrence actions occupy a
separate row below the aligned fields, adapting to the card's actual width.

The project field is optional. New clients select an active project visible to the
task author from the current project hub; the server validates its identity and
access again when the task is saved. The task retains a nullable project ID and a
readable label. Existing tasks and older clients with only the legacy free-text
label remain valid. A linked ordinary task does not become a project-hub work item
or automatically appear inside a project direction. Subtasks and recurring copies
retain the parent/template link. Migration `0079_task_project_links` adds this
nullable relation without backfilling ambiguous old labels. Deploy API and schema
before installing a client that sends project IDs.

The calendar shows tasks on their local due date, preserves the active state/role
filters and text search, and keeps tasks without a deadline in a separate visible
queue. Month navigation never changes task data.

The «Мои» filter and its count include tasks where the current user is the author,
primary assignee, co-assignee or observer; overlapping roles count a task only once.
The role picker, plan filter and search further narrow that dataset. Task statuses
and server-side access rules are unchanged.

The plan-document preview reads task titles and reviewable participant/deadline hints
from DOCX table rows. A dedicated responsible-person cell takes precedence; in
weekly tables with separate work columns, each column's named person applies only
to tasks in that column. Exact dates are suggested directly. A week range may use
its final day only when the document heading supplies one unambiguous year. The
desktop matches names only when exactly one active employee fits; unresolved names
and dates remain editable and are not silently assigned to the importer. Nothing
is created until the reviewed plan is confirmed. The preview counts incomplete
included rows, names their original document positions, and can show only those
rows; confirmation remains blocked until each has a title and primary assignee
(or a selected existing task when linking).

The 2026 annual `Иш режа` table has a dedicated seven-column import path.
`Тадбирнинг номи` becomes the task title, `Муддати` the reviewed deadline,
`Амалга ошириш механизми` the ordered checklist, the first named employee in
`Бажарувчи` the primary assignee only when uniquely matched; the remaining
matched employees become co-assignees, `Масъул` the observer(s), and
`Бажарилган ишлар` the description/expected
result. Section headers are context, not tasks. The source file is read for preview
and is not stored. Ambiguous names, department labels, recurring or moved deadlines
require review; no person or exact date is fabricated. A green completed-work cell
with an unambiguous past deadline proposes historical completion, which the importer
can uncheck before the atomic confirmation. Past-due imported annual tasks receive
an audited efficiency exclusion so retrospective entries do not change employee
scores; future-due entries remain in the normal methodology. This uses existing
task, checklist, event and audit tables and requires no migration.

Plans have an explicitly selected owner («постановщик»), defaulting to the creator
for manual creation and document import. The creator remains immutable for audit.
Only an active employee may be selected. The owner, creator, or administrator may
rename the plan, change its details or move it between `active` and `completed`;
each actual transition is audited. Existing plans receive their creator as owner
and remain active in migration `0091_task_plan_settings`. The Plans view searches
active plans by default and has an explicit «Показать завершённые планы» toggle.
Completing a plan changes only the plan record: linked tasks remain linked, keep
their own statuses, and stay visible in Tasks according to normal task access.
During rollout, older API processes may still insert without an owner; the new API
treats those rows as owned by their creator. Deploy the migration and API before
the updated desktop client.

Each task card contains:

- a primary assignee plus `co_assignee` and `observer` participants;
- an ordered checklist with completion actor and time;
- append-only comments and private attachments;
- blocking or informational links to other visible tasks;
- subtasks and a protected result review/return flow;
- an optional standard or calendar recurrence definition;
- a direct action to its automatically managed task chat.

## Access and automatic chats

### Traceable task route — 16 October 2026

The task card's «Маршрут и история» opens an access-checked, paginated read-only
timeline (`GET /api/v1/tasks/{id}/history`). It combines the existing append-only
task ledger with persisted extension requests and decisions: creation, status,
assignment, submission, acceptance, revision, closure/cancellation and deadline
changes. Entries show the recorded actor/time, old/new deadlines and reasons.
Rejected/pending proposals are not presented as applied deadlines. Linked approval
and deadline events form one visible decision. The timeline exposes no arbitrary
audit metadata or chat contents and does not grant task access through efficiency.
Older tasks explicitly disclose incomplete early history; only their actual creation
timestamp/author are projected from the task row, never a guessed original deadline.
No schema migration or rewriting of stored history is required.

- Managers, administrators and superadministrators can read and edit all tasks,
  except a manager holding the exact executive chairman position: that position
  grants visibility, not blanket editing/management rights. The chairman retains
  author, assignee and co-assignee rights on tasks where he has those roles.
  The desktop mirrors this existing API rule for editing, uploads, checklist,
  Kanban dragging, participants, deadlines, return and efficiency controls.
  The personal review inbox and result acceptance remain author-only for everyone.
- An employee sees a task only when they are its author, primary assignee,
  co-assignee or observer. This rule is enforced by the workspace query and every
  task endpoint, not only by the desktop filters.
- The author and primary assignee can read and edit their task.
- A co-assignee can work on the card; an observer can read and comment.
- Only the author or an authorized manager can change the deadline directly.
  Executors request a later deadline from the task chat instead of silently editing it.
- Only the author, manager or administrator can change participants.
- Only the author or an administrator can permanently delete a task. Deletion also
  removes its subtasks, managed task chats, attachment metadata and efficiency events,
  while an audit event records who deleted the root task.
- Chat membership consists of the author, current assignee, co-assignees and
  observers. Managerial task visibility alone does not reveal the conversation.
  Workspace administrators and superadministrators have permanent read access to
  every managed task chat without being added to its participant list; ordinary
  managers still need task participation.

Task creation and each generated recurrence create exactly one `kind=task` chat in
the same transaction. The partial unique index on `(context_type, context_id)` makes
that operation safe under retries. A card title/description change updates the chat;
assignee and participant changes reconcile its members. Migration
`0021_task_calendar_chats` backfills existing tasks, while the deterministic demo
seed creates the same links on a clean installation.

## Recurrence rules

Daily, weekly and monthly rules retain an integer interval. A calendar rule can run:

- on any selected combination of weekdays; or
- on any selected combination of month days from 1 through 31.

The user chooses the local time of the next occurrence. The server validates the
IANA timezone and calculates later occurrences in local time before converting them
to UTC. A selected day such as 31 is skipped in months where it does not exist.

The scheduler locks due rows with `FOR UPDATE SKIP LOCKED`. Every generated task has
a unique `(cycle_id, cycle_occurrence_key)`, making concurrent or repeated runs
idempotent. A new occurrence copies description, assignee, project, priority,
participants and checklist titles; completion state, comments, files and other
cross-workflow links start clean.

## Integrity and API

Blocking dependencies form a directed acyclic graph. The API rejects self-links and
an edge that would create a cycle. A task cannot be submitted while a blocking task
is incomplete, and a parent cannot be accepted while a subtask remains open.

An assignee or co-assignee submits a written result for review. The author receives
an action-required notification, while other executors see an informational one.
The task is visibly marked as waiting for the author. Only the named author can
accept the result, even when the assignee has manager or administrator privileges.
The author or an authorized manager may return it to work with a reason.
Acceptance and return notify the primary assignee and co-assignees. Task actions
are protected against duplicate clicks in the desktop form and checked again by
the API. The EFF-2 metric credits all executors at the time of an on-time submission,
not at acceptance; a reasoned return revokes that submission's credit.

The task detail footer contains result submission for executors, and delete,
accept and return actions for the author when applicable. The result composer
also accepts task files, which remain available in the card after submission.
The former payment-request shortcut is no longer part of the task card.
Task deletion also removes its task chat and immutable message versions through
a transaction-scoped purge guard; ordinary message history remains append-only.

An executor or co-assignee can request a later deadline from the task chat with
a reason and local date/time picker. The request and its message are stored in
one transaction. The author or authorized manager accepts or rejects it in the
chat message; the message then shows the persisted decision to every chat
participant. A task has at most one pending request, duplicate decisions are
idempotent, and a direct deadline change or task closure supersedes a pending
request. An accepted extension records the same efficiency deadline event as a
direct change. Extending an already missed deadline does not erase that prior
late event from EFF-2 history.

### Deadline decision inbox and work-first detail — 16 October 2026

Creating an extension request atomically persists a dedicated action-required
task notification for the task's author, in addition to the existing chat
message. It names the requester, task, old/proposed dates and reason. The normal
desktop/web notification pipeline delivers the system banner according to the
employee's existing notification preferences and platform permissions. Its
Tasks/entity link opens the card with the pending decision immediately below
the heading. Existing pending requests are materialised on bootstrap with a
stable event key, without replaying read/delivered notifications on every read.
Decisions resolve the action immediately; superseded/closed requests resolve on
reconciliation. No new schema or change to the efficiency methodology is needed.

The «Перенос срока» filter counts only live pending requests on tasks authored
by the current employee, and combines with text/role/plan filters. List rows show
a compact request badge to all task readers, with personal decision wording for
the author. Rejected, approved, superseded, closed and stale-deadline requests
are not counted. The task card uses the existing protected decision endpoint;
authorized managers retain their prior rights but do not receive every author's
inbox notification.

Delivered result and task files precede lifecycle/configuration content in DOM
and keyboard reading order. The task description, comments and history remain
available; team, plan links, subtasks, checklist, dependencies, recurrence and
efficiency controls are grouped under «Команда и настройки задачи», collapsed
by default. Disclosure hides but does not discard drafts or controls. Dark
recessed surfaces and light-theme styling remain consistent inside the group.

The current valid deadline, not a historical `overdue` status, determines the
current overdue filter and counters. After rescheduling into the future, the
task leaves that filter and returns to the working Kanban lane even while a
legacy server reports the old status. If the new deadline expires, it becomes
overdue again. Missing/invalid dates retain the explicit-status fallback;
completed and cancelled tasks remain excluded. This does not erase historical
efficiency events or change result-review transitions.

Relevant endpoints:

- `POST /api/v1/tasks`
- `PATCH /api/v1/tasks/{task_id}`
- `DELETE /api/v1/tasks/{task_id}`
- `PATCH /api/v1/tasks/{task_id}/status`
- `POST /api/v1/tasks/{task_id}/submit-result`
- `POST /api/v1/tasks/{task_id}/accept-result`
- `POST /api/v1/tasks/{task_id}/return-for-revision`
- `POST /api/v1/tasks/{task_id}/deadline-requests`
- `POST /api/v1/tasks/{task_id}/deadline-requests/{request_id}/decision`
- `POST /api/v1/tasks/{task_id}/extend-deadline`
- `PUT|DELETE /api/v1/tasks/{task_id}/participants[...]`
- `POST|PATCH|DELETE /api/v1/tasks/{task_id}/checklist[...]`
- `POST /api/v1/tasks/{task_id}/comments`
- `PUT|DELETE /api/v1/tasks/{task_id}/dependencies[...]`
- `PUT /api/v1/tasks/{task_id}/cycle`
- `PUT /api/v1/attachments/task/{task_id}`
- `DELETE /api/v1/tasks/{task_id}/attachments/{attachment_id}`

## Task attachment removal and deadline labels — 13 October 2026

The uploader may remove a task attachment while still having task read access;
admin and superadmin may remove any task attachment they can access. Managers do
not acquire this power over colleagues' files. The API checks module visibility,
task access, the exact task/attachment pair and uploader/administrator authority,
then locks and removes the metadata and writes an audit record atomically.
Ordinary download and preview access ends immediately. The private stored object
is retained for administrative recovery; it is not physically purged. UI removal
requires confirmation, waits for server success, and retains the file on failure.
Other document workflows and message attachments are not changed by this endpoint.

Task files already have no count cap in the current upload/read paths. Multiple
selection and subsequent batches remain unrestricted; a regression covers a batch
of 50 files and 50 rendered records. Ordinary per-file size remains 25 MiB (audio
uses the existing separate limit). No new artificial count limit is introduced.

Deadline cards format the authoritative `dueAt` in the same client timezone as
chat dates instead of relying on a server-local `dueLabel`. The server fallback
label explicitly uses Asia/Tashkent, independently of its host timezone. A UTC
13:00 deadline is therefore 18:00 in Tashkent, not a lost extension. Approval and
efficiency rules, stored instants and historical decisions are unchanged.
No database migration is required; deploy API before using the new delete button.

## Atomic creation

### Task proposals with explicit author consent — 16 October 2026

The standalone Tasks composer defaults to the current user as author. Selecting
another active employee switches the final action to «Отправить на подтверждение»
and fixes the primary assignee to the requester. The complete title, description,
project, priority, deadline, co-assignees/observers, checklist, dependencies and
recurrence become an immutable private proposal, not a task. The two parties can
review it in «Заявки на постановку»; its notification opens the proposal itself.
Participants receive no task/chat access before approval. Pending, rejected and
withdrawn proposals are not queried as tasks, overdue items or efficiency events.

Only the named author may approve or reject; administrator/manager privileges do
not substitute for consent. Rejection requires a reason. Only the requester may
withdraw a pending proposal. Approval locks the proposal and atomically creates
the real task and its managed chat under the approver's authorship, retaining the
requester as primary assignee and creation actor. An audit entry records the
approver and linked task; future recurrences use the confirmed author as well.
Repeated identical submissions use a stable request UUID, duplicate decisions are
idempotent, and conflicting decisions return 409. Active participants, current
module permissions, links and dates are revalidated at approval. If the deadline
or next recurrence has expired, withdraw/reject and submit a new future-dated
proposal; time awaiting consent is not backdated into the task lifecycle.

Routes: GET/POST `/api/v1/task-proposals` and POST
`/api/v1/task-proposals/{id}/decision` (approve/reject/cancel). Lists are visible
only to the requester and selected author. Migration `0101_task_proposals` adds
the separate table without changing existing tasks. Deploy the migration and API
before the new client. The ordinary creation endpoint never accepts a delegated
author from the client. Linked-message/calendar/subtask proposal variants are not
part of this standalone flow; their existing direct creation stays unchanged.

The creation dialog sends the title, expected result, project, assignee, deadline,
priority, participants, checklist, dependencies and optional recurrence in one
`POST /api/v1/tasks` request. The repository validates every referenced employee
and task before inserting anything. The task, participant roles, checklist,
dependency edges, recurrence and managed task chat are then written in one database
transaction. A failed validation or chat synchronisation leaves no partial task.

The same contract is used for a task created from a messenger message; only the
source message identifier is added. The compact subtask action remains intentionally
separate because its parent, visibility and review lifecycle are already fixed by
the selected task.

## Verification boundary

Automated checks cover calendar navigation/selection, the custom-cycle contract,
idempotent materialisation, migration from an empty database, one-chat-per-task and
membership reconciliation. A short user check of real task density and a two-client
conversation remains useful before expanding the pilot. Exact Bitrix behavioural
characterisation still requires safely selected representative production tasks.
