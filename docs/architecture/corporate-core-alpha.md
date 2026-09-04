# Corporate Core Alpha

## Product direction

Yuksalish Workspace is a self-contained corporate environment. Messenger, tasks and approvals are the operating core. Hisobot is a later business module that uses this core; it is not the home screen or the architectural center.

The first test build validates one connected workday scenario:

1. An employee discusses a purchase in a chat.
2. A message becomes a task with an owner and deadline.
3. The employee creates a payment request from the task.
4. The request follows a versioned visual approval graph.
5. Every object has its own automatic chat and immutable activity trail.

## Domain boundaries

- `Core`: users, departments, roles and account state.
- `Messenger`: direct, group, department, project, task and approval chats.
- `Tasks`: assignments, participants, deadlines, review and idempotent cycles.
- `Approvals`: versioned forms, graph nodes and edges, requests and decisions.
- `Hisobot`: a consumer of Core, notifications, files and scheduling after the corporate core is usable.

## Approval graph

The editor stores a directed graph instead of hard-coded steps. Each published template is immutable; editing creates a new draft version.

Supported node kinds:

- `start`: request entry point;
- `approval`: one or all selected approvers;
- `condition`: route by amount, field value, department or role;
- `parallel`: start independent approval branches;
- `correction`: return to the requester while preserving the decision trail;
- `end`: approved or rejected terminal state.

Edges contain the outcome, optional label, condition and order. Node positions are saved independently from execution rules, so rearranging the canvas does not change business behavior.

## Payment request baseline

The initial form contains purpose, amount, currency, payment date, cost center, counterparty, contract or invoice attachment, requester comment and linked task. The first sample workflow routes small payments to the department manager and larger payments through finance and the director.

## Live corporate alpha

The Electron client now uses the FastAPI gateway and PostgreSQL as its source of truth. An idempotent seed creates four test users, sample conversations, tasks and a payment workflow. The same API serves the initial workspace snapshot and all mutations.

The implemented vertical slice includes:

- Argon2id password login, administrator-issued invitations and account recovery;
- 15-minute access tokens with rotating, revocable per-device refresh sessions;
- encrypted TOTP secrets with replay protection and login lockout;
- role-filtered workspace queries and server-side authorization for workflow changes and approval actions;
- persistent messages, tasks, task status changes, requests and approval history;
- direct links from a message to a task and from a task to a payment request at the data and API level;
- validation and persistence of draft workflow graphs, including intentional cycles through a correction node;
- amount-based routing, approval, rejection, return to requester and requester resubmission;
- authenticated WebSocket events that refresh a second running desktop client.

The event broker is deliberately process-local in this alpha. A Redis-backed broker is required before the API is scaled beyond one process.

Alpha 0.11.0 adds a durable notification layer. PostgreSQL stores one personal event per stable event key, its read/resolved state and whether a native desktop notification was already delivered. A server-side scheduler materializes upcoming task and calendar reminders idempotently, while the Electron client uses the same queue for deep links and only shows a Windows notification for a newly observed, enabled event while the window is out of focus.

## Security boundary

Development login and demo seeding are enabled only in `development` or `test`. The production desktop does not embed demo credentials. A one-time CLI creates the first administrator only when `core_users` is empty; all later accounts use administrator-issued, expiring invitation codes. Recovery codes are also administrator-issued, expire after two hours and revoke every old session when consumed. TOTP secrets are encrypted with a key separate from access-token signing.

External production publication remains blocked until the server, backups, HTTPS/Cloudflare, centralized rate limiting and security audit are ready.

## Known limits

- Messenger replies, mentions, reactions, pinned messages, 24-hour editing policy and administration audit are not complete.
- Tasks do not yet have subtasks, author review or a calendar view.
- Payment-request deadline escalation and reminders are not yet implemented; the notification center already exposes every currently actionable stage.
- The process-local event broker must move to Redis before the API is scaled beyond one process.
