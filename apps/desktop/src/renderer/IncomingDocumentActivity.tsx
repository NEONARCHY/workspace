import type { IncomingDocumentDetail, TaskHistoryEvent } from "@yuksalish/contracts";
import { TaskHistory } from "./TaskHistory";

export function IncomingDocumentActivity({ token, detail }: {
  readonly token: string; readonly detail: IncomingDocumentDetail;
}) {
  const document = detail.document;
  const sourceEvents: TaskHistoryEvent[] = [];
  for (const [kind, occurredAt] of [
    ["incoming_received", document.receivedAt],
    ["incoming_registered", document.registeredAt],
    ["incoming_added", document.addedAt],
  ] as const) {
    if (occurredAt) sourceEvents.push({ id: `${document.id}:${kind}`, kind, occurredAt });
  }
  const taskId = document.canOpenTask ? document.execution?.taskId : undefined;
  return <>
    <TaskHistory token={token} taskId={taskId} revision={detail} sourceEvents={sourceEvents} variant="letter" />
    {document.execution && !document.canOpenTask ? <p className="incoming-document-help">История поручения недоступна с текущими правами.</p> : null}
  </>;
}
