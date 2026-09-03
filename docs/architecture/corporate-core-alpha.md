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

## Alpha boundary

The initial Electron build is an interaction prototype backed by typed sample state while the PostgreSQL schema is introduced. It validates navigation, information density and graph editing. Authentication, persistent CRUD, WebSocket delivery, file upload and workflow execution are the next server-backed slices and are not represented as complete in the UI.
