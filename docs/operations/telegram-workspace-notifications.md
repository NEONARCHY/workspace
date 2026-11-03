# Telegram notifications: pilot and controlled activation

This package is merged code, not a production activation. Leave the office API,
Hisobot PC, real bot token and real employee grants unchanged during preview.

## Components and compatibility

- Additive migration `0119_workspace_telegram` follows `0118_task_proposal_imports`.
  Apply on an isolated test database first. Existing bot grants and reports are preserved.
  Downgrade refuses to discard delivery receipts; rollback by disabling delivery first.
- API defaults `YUKSALISH_TELEGRAM_NOTIFICATIONS_MODE=off`.
- Notification eligibility uses a separate `workspace_notifications` grant in existing
  Telegram administration. It neither grants workspace modules nor changes report obligations.
- Companion `integrations/workspace_telegram/delivery.py` is send-only and uses existing
  `httpx`; it never calls getUpdates or takes over the Hisobot webhook. Deploying the
  companion on the bot PC is a separate future operation, not an effect of this PR.
- Web links require the matching web renderer and API; desktop external navigation/IPC
  stays unchanged. Without login the object and message are not disclosed.

## Safe test procedure

1. Use a dedicated PostgreSQL test database and synthetic active central and regional users.
2. Configure API mode `preview`, a synthetic dedicated bridge token (minimum32 characters),
   and the test HTTPS Workspace origin in `YUKSALISH_TELEGRAM_NOTIFICATIONS_WORKSPACE_URL`.
3. Give synthetic central users verified synthetic Telegram IDs and the separate grant.
   Verify that regional users are denied the grant; even a historical bad grant cannot deliver.
4. Create a task and payment request through normal business functions. Verify transactional
   creation, co-assignees, correct active payment actor and idempotence.
5. Start the companion without `--live`, supplying `WORKSPACE_NOTIFICATION_API_URL` and
   `WORKSPACE_NOTIFICATION_BRIDGE_TOKEN`. No bot token is needed. An optional
   `WORKSPACE_NOTIFICATION_CA_FILE` trusts an existing test CA without disabling TLS.
   Local HTTP is allowed only with `--test-local` in non-live preview.
6. Inspect prepared cards and open their URLs, first logged out, then as the actual recipient.
   Another account must be denied. Revoke permission, change identity, move into a regional
   department, complete the task or advance the payment stage: stale deliveries are skipped.
7. Simulate Telegram and bridge failures with MockTransport; never use real bot delivery
   to verify error handling. Tests live in `test_workspace_telegram_notifications.py` and
   `test_workspace_telegram_sender.py`.

Preview receipts are `previewed`, never `sent`; they are not replayed after switching live.
Server and companion claim modes must match, so a default preview companion cannot
consume a live queue. No historical bootstrap/backfill is performed.

## Future live activation (requires separate authorization)

Before touching production, verify CI, backup and rollback under the current deployment
runbook. Confirm the bot owner, private direct chats and central-office roster. Employees
must already have opened the Hisobot bot with /start; Telegram bots cannot initiate a chat.
A username alone is not a verified Telegram ID. Never print tokens or real message content.

API settings: mode `live`, public HTTPS Workspace origin and a new dedicated bridge secret.
Bot PC environment: `WORKSPACE_NOTIFICATION_API_URL` (Workspace HTTPS origin),
`WORKSPACE_NOTIFICATION_BRIDGE_TOKEN` (same delivery-only secret),
`WORKSPACE_TELEGRAM_BOT_TOKEN` (existing bot token kept only on the bot PC).
Launch from the repository root with Python3.11 and existing dependencies:
`python -m integrations.workspace_telegram.delivery --live --journal <private-local-path>`.
Run one supervised companion instance and persist its SQLite journal on private local disk,
outside Git/shared folders. Do not run a second getUpdates consumer. The bridge token can
lease notification bodies, so store it as a secret, separate from the general Hisobot key.
Neither bridge nor Telegram button can create tasks, approve payments or bypass user login.

## Failure handling and shutdown

The sender records intent before contacting Telegram and persists a receipt before ACK.
Lost ACKs retry the receipt, not sendMessage. Definite Telegram rejections (429/5xx) use
bounded retry, at most five attempts; malformed replies/timeouts are `unknown`, with no
blind resend. A crashed intent is also `unknown`. A Telegram403 is terminal (`failed`).
Poll/process failures stop the companion; the supervisor may restart it with the same journal.
Inspect aggregate queue states, not private text or tokens. Resolve unknown outcomes with
operator evidence before any separately authorized retry. This package has no unsafe
"retry all" action. Existing unrelated task/payment notifications remain unchanged.

To stop delivery set API mode `off` and stop the companion. ACKs for already attempted
sends can still be recorded. Pending records remain; later preparation repeats eligibility.
Do not delete the receipt journal while there may have been a send. Retain receipts under
internal privacy policy; no automatic destructive purge is introduced in this pilot.
