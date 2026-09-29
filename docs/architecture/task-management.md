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

The calendar shows tasks on their local due date, preserves the active state/role
filters and text search, and keeps tasks without a deadline in a separate visible
queue. Month navigation never changes task data.

Each task card contains:

- a primary assignee plus `co_assignee` and `observer` participants;
- an ordered checklist with completion actor and time;
- append-only comments and private attachments;
- blocking or informational links to other visible tasks;
- subtasks and a protected result review/return flow;
- an optional standard or calendar recurrence definition;
- a direct action to its automatically managed task chat.

## Access and automatic chats

- Managers, administrators and superadministrators can read and edit all tasks.
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
The task is visibly marked as waiting for the author. The author (or an authorized
manager) can finish it by accepting the result, or return it to work with a reason.
Acceptance and return notify the primary assignee and co-assignees. Task actions
are protected against duplicate clicks in the desktop form and checked again by
the API. The EFF-2 metric credits all executors at the time of an on-time submission,
not at acceptance; a reasoned return revokes that submission's credit.

The task detail footer contains result submission for executors, and delete,
accept and return actions for the author when applicable. The result composer
also accepts task files, which remain available in the card after submission.
The former payment-request shortcut is no longer part of the task card.

An executor or co-assignee can request a later deadline from the task chat with
a reason and local date/time picker. The request and its message are stored in
one transaction. The author or authorized manager accepts or rejects it in the
chat message; the message then shows the persisted decision to every chat
participant. A task has at most one pending request, duplicate decisions are
idempotent, and a direct deadline change or task closure supersedes a pending
request. An accepted extension records the same efficiency deadline event as a
direct change. Extending an already missed deadline does not erase that prior
late event from EFF-2 history.

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

## Atomic creation

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
