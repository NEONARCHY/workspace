import { useCallback } from "react";
import { ExternalFileViewer, type FileViewerSource } from "./FileViewer";
import { downloadMailFile, downloadMailProviderFile } from "./workspace-api";

export interface MailFileSource extends FileViewerSource { readonly messageId?: string; }
export function mailFilePreviewable(file: { readonly contentType: string }) {
  return ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.contentType);
}
export function loadMailFileBlob(token: string, file: MailFileSource, signal?: AbortSignal) {
  return file.messageId ? downloadMailProviderFile(token, file.messageId, file.id, signal) : downloadMailFile(token, file.id, signal);
}
export function saveMailBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function MailAttachmentViewer({ token, file, onClose }: {
  readonly token: string; readonly file: MailFileSource; readonly onClose: () => void;
}) {
  const load = useCallback((source: MailFileSource, signal?: AbortSignal) => loadMailFileBlob(token, source, signal), [token]);
  const download = useCallback(async (source: MailFileSource) => saveMailBlob(await loadMailFileBlob(token, source), source.fileName), [token]);
  return <ExternalFileViewer attachment={file} onClose={onClose} onLoad={load}
    onLoadOffice={async () => { throw new Error("Для этого формата используйте скачивание файла"); }} onDownload={download} />;
}
