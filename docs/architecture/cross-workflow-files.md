# Cross-workflow actions, files and request revisions

**Status:** implemented in alpha 0.5.0

## User flow

1. A chat participant selects a message and creates a task from it.
2. `tasks.source_message_id` preserves the source even after the user changes the task title.
3. A visible task can become a payment request through the task card.
4. `approval_requests.source_task_id` preserves the second link in the chain.
5. A manager returns a request with a mandatory comment.
6. The requester sees the return reason in the request card. The API retains the complete action chronology with actor, node and timestamp.
7. Only the original requester can edit the returned request and resubmit it.
8. Resubmission keeps the request identifier and number and restarts its existing workflow.

## Attachments

`workspace_attachments` is a shared metadata table for messages, tasks and approval requests. File bytes are stored under an opaque random key in the private MinIO bucket. PostgreSQL keeps the owner, original safe filename, media type, byte size, uploader, creation time and SHA-256 digest.

Uploads are limited to 25 MiB per file. Downloads always use `Content-Disposition: attachment` and require an authenticated user who can read the parent entity. Message writes require the message author; approval writes require the requester while the request is active or returned. Task access follows the current author/assignee/manager rules.

This alpha does not claim malware scanning or public file sharing. Those are production hardening tasks before exposing the server outside the controlled network.

## Immutable request history

`approval_request_versions` stores a complete title/payload snapshot plus the attachment identifiers visible at that moment. The initial version is created with the request. Corrections and attachment additions append versions; old rows are never updated. Workflow actions do not create content versions because they change process state, not submitted content.

The current request row remains the fast read model. `current_version` identifies the latest immutable content snapshot.

## API surface

- `PUT /api/v1/attachments/{owner_type}/{owner_id}?fileName=...`
- `GET /api/v1/attachments/{attachment_id}`
- `PATCH /api/v1/approval-requests/{request_id}`
- existing task and approval creation endpoints accept `sourceMessageId` and `sourceTaskId`

The workspace bootstrap returns visible attachment metadata, immutable request versions and workflow action history so the desktop client can render the complete chain without unprotected storage URLs.
