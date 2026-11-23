# Workspace notifications through the Hisobot bot

This integration is **not activated by a merge or an EXE build**. The Workspace
server, the bot PC, and the installed clients require separate coordinated rollout.

## Scope

- Migration `0127_notification_mirror` follows `0126_session_admin_mode`.
  It queues *new* Workspace notification rows, including tasks, trips, projects,
  requests, and chat messages. It does not backfill existing rows. The old direct
  task/payment outbox is retained; an equivalent notice created within five minutes
  is not queued twice. Hisobot report notices are excluded because the bot already
  sends its own report reminders.
- Only active employees with a verified Telegram ID and the separate
  `workspace_notifications` grant are eligible. Both central and regional employees
  may receive notifications. The grant does not confer report obligations or
  Workspace module access. Access is checked again immediately before delivery.
- Chat delivery checks current chat membership and reads the original message, so
  messages longer than the Workspace feed preview are sent completely in chunks.
  Every chunk has a link button. Deleted messages and inaccessible chats are skipped.
- Links use `/?workspaceNotice=<opaque delivery id>` at the configured public
  Workspace HTTPS origin. The authenticated API verifies recipient identity and
  current access before opening the target. A link alone discloses no content.
- The sender runs inside the **single Hisobot EXE** and never starts another
  `getUpdates` consumer. It persists send intent and receipts in
  `data/workspace-telegram.sqlite3` next to the EXE; preserve this file across
  upgrades. Unknown outcomes are not automatically resent.

## Controlled rollout

1. Back up the Workspace database and test the migration on a dedicated PostgreSQL
   test database. Deploy matching API and web client. Do not run the migration on
   production without a verified backup.
2. On the Workspace server set `YUKSALISH_TELEGRAM_NOTIFICATIONS_MODE=preview`,
   `YUKSALISH_TELEGRAM_NOTIFICATIONS_WORKSPACE_URL=https://workspace.opinions.uz`
   and a new dedicated `YUKSALISH_TELEGRAM_NOTIFICATIONS_BRIDGE_TOKEN` of at least
   32 random characters. Keep the token out of Git, chats, command arguments, and logs.
3. In «Допуск к ботам», verify each recipient's Telegram ID and grant
   `Workspace · уведомления`. Each employee must have started the Hisobot bot in a
   private chat. Verify regional and central recipients separately.
4. On the bot PC update the portable EXE but keep its `.env`, `config/`, `data/`,
   and receipt journal. Set `WORKSPACE_NOTIFICATION_MODE=preview`, the same secret
   in `WORKSPACE_NOTIFICATION_BRIDGE_TOKEN`, the Workspace HTTPS origin in
   `WORKSPACE_NOTIFICATION_API_URL` (or use `HISOBOT_WORKSPACE_API_URL`), and the
   trusted CA path in `WORKSPACE_NOTIFICATION_CA_FILE` (or use the existing
   `HISOBOT_WORKSPACE_CA_FILE`). Do **not** disable TLS verification. No second bot
   process or separate Telegram token is needed.
5. With synthetic notices, verify queue claims, preview receipts, access revocation,
   full-length messages, and recipient-private links. Preview consumes queue rows;
   use new test notices for a subsequent live test.
6. Only after a coordinated release, switch **both** server and bot PC to `live`.
   The modes must match. Start exactly one bot instance. Test one task, one regional
   notification, one personal message, and one revoked-access case before wider use.

Set server and bot modes to `off` to stop new delivery. Keep the receipt journal:
deleting it can cause duplicate sends after an interrupted acknowledgement. The
former `integrations/workspace_telegram/delivery.py` remains for the pilot but must
**not** run alongside the integrated sender.
