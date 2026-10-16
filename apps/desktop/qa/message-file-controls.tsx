// Read-only production-component keyboard, wheel and geometry fixture.
import { useState } from "react";
import type { CalendarEventInput } from "@yuksalish/contracts";
import { MessageAttachmentsDialog } from "../src/renderer/MessageAttachmentsDialog";
import PdfFilePreview from "../src/renderer/PdfFilePreview";
import { CalendarEventComposer } from "../src/renderer/CalendarEventComposer";
import { MessengerView } from "../src/renderer/MessengerView";
import { initialChats, people } from "../src/renderer/test-fixtures/demo-data";
import "../src/renderer/file-viewer.css";

const noop = () => undefined;
const file = new File(["QA"], "Документ.doc", { type: "application/msword" });
// Tiny valid one-page PDF. Byte offsets are computed, not hard-coded.
const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>", "<< /Length 0 >>\nstream\n\nendstream"];
let pdf = "%PDF-1.4\n";
const offsets = [0];
objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
const xref = pdf.length;
pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const blob = new Blob([pdf], { type: "application/pdf" });
export function MessageFileControls() {
  const part = new URLSearchParams(location.search).get("part");
  const [caption, setCaption] = useState("");
  const [sent, setSent] = useState(0);
  const [closed, setClosed] = useState(false);
  const [draft, setDraft] = useState<CalendarEventInput>({ title: "Проверка времени", description: "", eventType: "meeting", startsAt: "2026-10-16T08:04", endsAt: "2026-10-16T11:00", allDay: false, location: "", attendeeIds: [] });
  if (part === "pdf") return <div className="file-viewer-pdf" style={{ height: "95dvh", display: "flex", flexDirection: "column", overflow: "hidden" }}><PdfFilePreview blob={blob} onError={message => { document.body.dataset.pdfError = message; }} /></div>;
  if (part === "calendar") return <CalendarEventComposer draft={draft} people={people} currentUserId="aziza" busyAttendeeIds={new Set()} minimumStart="2026-10-16T00:00" tasks={[]} projectTargets={{ projects: [], workstreams: [], items: [] }} canLinkProjects={false} projectTargetsLoading={false} projectTargetsError="" onRetryProjectTargets={noop} canCreateTask={false} canCreatePayment={false} busy={false} error="" onDraftChange={setDraft} onAddTask={noop} onUpdateTask={noop} onRemoveTask={noop} onPaymentChange={noop} onClose={noop} onSubmit={async () => undefined} />;
  if (part === "mention") return <main style={{ height: "100dvh", padding: 16 }}><MessengerView token="" currentUserId="aziza" currentUserRole="employee" chats={initialChats} messages={[]} tasks={[]} attachments={[]} people={people} departments={[]} chatActions={{ create: async () => initialChats[0]!, update: async () => initialChats[0]!, add: async () => initialChats[0]!, setMember: async () => initialChats[0]!, remove: async () => undefined, transfer: async () => initialChats[0]!, delete: async () => undefined }} onSendMessage={noop} onSendVoiceMessage={async () => undefined} onReactMessage={async () => undefined} onPinMessage={async () => undefined} onEditMessage={async () => undefined} onDeleteMessage={async () => undefined} onCreateTaskFromMessage={noop} onDownloadAttachment={noop} onLoadAttachment={async () => blob} onMarkRead={noop} /></main>;
  return <><output data-sent={sent} data-closed={closed}>{sent}</output>{!closed && <MessageAttachmentsDialog files={[file]} caption={caption} onCaption={setCaption} onFiles={noop} onRemove={noop} onAdd={noop} onSend={() => setSent(value => value + 1)} onClose={() => setClosed(true)} />}</>;
}
