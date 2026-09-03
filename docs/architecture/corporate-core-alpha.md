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

## Live alpha 0.2.0

The Electron client now uses the FastAPI gateway and PostgreSQL as its source of truth. An idempotent seed creates four test users, sample conversations, tasks and a payment workflow. The same API serves the initial workspace snapshot and all mutations.

The implemented vertical slice includes:

- signed 12-hour development sessions for manager, employee and administrator roles;
- role-filtered workspace queries and server-side authorization for workflow changes and approval actions;
- persistent messages, tasks, task status changes, requests and approval history;
- direct links from a message to a task and from a task to a payment request at the data and API level;
- validation and persistence of draft workflow graphs, including intentional cycles through a correction node;
- amount-based routing, approval, rejection, return to requester and requester resubmission;
- authenticated WebSocket events that refresh a second running desktop client.

The event broker is deliberately process-local in this alpha. A Redis-backed broker is required before the API is scaled beyond one process.

## Security boundary

Development login is enabled only when the API environment is `development` or `test`. It selects one of the seeded users and issues a signed bearer token; it is intended for local product testing, not real employee authentication. Production remains blocked until invitation-based account creation, Argon2id passwords, TOTP, session/device management, rate limiting and audit review are implemented.

## Known limits

- Request fields cannot yet be edited after a return; the requester can only resubmit the existing payload.
- File upload and attachment policy are not connected to the payment form.
- The editor stores parallel nodes, but the alpha executor follows one sequential outcome path.
- Direct message-to-task and task-to-request links exist in the API, while dedicated context actions in the desktop UI remain to be added.
- Notifications currently trigger workspace refresh; unread counters and durable delivery are not implemented.
