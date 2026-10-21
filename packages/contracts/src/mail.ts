import type { WorkspaceTaskCreateInput } from "./index";

export interface MailConnection {
  readonly configured: boolean;
  readonly sendingEnabled: boolean;
  readonly accountId: string | null;
  readonly email: string | null;
  readonly connectedAt: string | null;
  readonly reconnectRequired: boolean;
}
export interface MailConnect { readonly requestId: string; readonly authorizationUrl: string; }
export interface MailConnectStatus { readonly status: "pending" | "exchanging" | "connected" | "failed" | "expired"; }
export interface MailMessageSummary {
  readonly id: string;
  readonly threadId: string;
  readonly subject: string;
  readonly sender: string;
  readonly recipients: string;
  readonly receivedAt: string;
  readonly snippet: string;
  readonly unread: boolean;
}
export interface MailProviderAttachment {
  readonly id: string; readonly fileName: string; readonly contentType: string; readonly sizeBytes: number;
}
export interface MailMessage extends MailMessageSummary {
  readonly body: string; readonly messageId: string; readonly references: string; readonly replyTo: string;
  readonly attachments: readonly MailProviderAttachment[];
}
export interface MailPage { readonly messages: readonly MailMessageSummary[]; readonly nextPageToken: string | null; }
export interface MailThread { readonly messages: readonly MailMessage[]; readonly truncated: boolean; }
export interface MailFields {
  readonly to: readonly string[]; readonly cc: readonly string[]; readonly bcc: readonly string[];
  readonly subject: string; readonly body: string;
}
export interface MailDraftWrite extends MailFields {
  readonly requestId: string; readonly expectedRevision: number; readonly replyMessageId?: string | null;
}
export type MailState = "draft" | "queued" | "sending" | "sent" | "unknown" | "failed";
export interface MailFile extends MailProviderAttachment { readonly signedLetterId: string | null; }
export interface MailDraft extends MailFields {
  readonly id: string; readonly revision: number; readonly status: MailState; readonly updatedAt: string;
  readonly attachments: readonly MailFile[]; readonly providerMessageId: string | null; readonly error: string;
  readonly replyMessageId: string | null;
}
export type MailDraftSummary = Pick<MailDraft, "id" | "subject" | "to" | "status" | "revision" | "updatedAt" | "error">;
export interface MailSignedFile {
  readonly id: string; readonly letterId: string; readonly title: string; readonly fileName: string; readonly sha256: string;
}
export interface MailTaskExport {
  readonly operationId: string; readonly messageId: string; readonly task: WorkspaceTaskCreateInput;
  readonly attachmentIds: readonly string[];
}
