import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { AIReferentPacketFile, AIReferentPacketKind } from "@yuksalish/contracts";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger, useRestoreFocusTarget } from "@fluentui/react-components";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { ArrowDownload20Regular, Dismiss20Regular, Document20Regular, FolderOpen20Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { downloadAIReferentPacket, loadAIReferentPacket, previewAIReferentPacketFile } from "./workspace-api";
import { fileViewerKind } from "./file-viewer-kind";

const ExternalFileViewer = lazy(() => import("./FileViewer").then(module => ({ default: module.ExternalFileViewer })));

export function AIReferentPacketViewer({ token, kind, ownerId, file, onClose }: {
  readonly token: string; readonly kind: AIReferentPacketKind; readonly ownerId: string;
  readonly file: AIReferentPacketFile; readonly onClose: () => void;
}) {
  const attachment = useMemo(() => ({ id: `${kind}:${ownerId}:${file.source}:${file.id}`,
    fileName: file.name.split("/").at(-1) || file.name, byteSize: file.byteSize,
    contentType: "application/octet-stream" }), [file, kind, ownerId]);
  return <Suspense fallback={<LoadingSkeleton layout="rows" rows={3} label="Открываем документ" />}>
    <ExternalFileViewer attachment={attachment} onClose={onClose}
      onLoad={(_attachment, signal) => downloadAIReferentPacket(token, kind, ownerId, file, signal)}
      onLoadOffice={(_attachment, sheet, offset, signal) => previewAIReferentPacketFile(token, kind, ownerId, file, sheet, offset, signal)}
      onDownload={async () => saveReferentBlob(await downloadAIReferentPacket(token, kind, ownerId, file), attachment.fileName)} />
  </Suspense>;
}

export function referentDownloadName(label: string, extension: string): string {
  const stem = label.replace(/[/\\]/g, "-").replace(/[<>:"|?*\p{Cc}]+/gu, " ").replace(/\s+/g, " ").trim().replace(/[. -]+$/g, "").slice(0, 112);
  const safeStem = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(stem) ? `Письмо ${stem}` : stem;
  return `${safeStem || "Пакет документов"}.${extension}`;
}

export function saveReferentBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const AIReferentFiles = memo(function AIReferentFiles({ token, kind, ownerId, letterLabel, details, triggerLabel }: {
  readonly token: string; readonly kind: AIReferentPacketKind; readonly ownerId: string;
  readonly letterLabel?: string;
  readonly details?: readonly { readonly label: string; readonly value: string }[];
  readonly triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<readonly AIReferentPacketFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<AIReferentPacketFile>();
  const previewFocusTarget = useRestoreFocusTarget();
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try { setFiles((await loadAIReferentPacket(token, kind, ownerId)).files); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть пакет."); }
    finally { setLoading(false); }
  }, [token, kind, ownerId]);
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => { void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [open, refresh]);
  const download = async (file?: AIReferentPacketFile) => {
    setBusy(true);
    setError("");
    try {
      const blob = await downloadAIReferentPacket(token, kind, ownerId, file);
      saveReferentBlob(blob, file?.name.split("/").at(-1) ?? referentDownloadName(letterLabel || (kind === "journal" ? "Excel-журналы" : "Пакет документов"), "zip"));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось скачать файл."); }
    finally { setBusy(false); }
  };
  return <WorkspaceDialog open={open} onOpenChange={(_event, data) => { setOpen(data.open); if (!data.open) setPreview(undefined); }}>
      <DialogTrigger disableButtonEnhancement>
        <Button className="ai-referent-packet-trigger" aria-label={triggerLabel ? "Пакет документов" : undefined}
          title={triggerLabel ? "Открыть письмо и вложения" : undefined}
          icon={<FolderOpen20Regular />}>{triggerLabel ?? "Пакет документов"}</Button>
      </DialogTrigger>
      <DialogSurface className="ai-referent-detail-dialog ai-referent-packet-dialog" aria-label="Пакет документов">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть пакет" onClick={() => setOpen(false)} />}>Пакет документов</DialogTitle>
          <DialogContent className="ai-referent-detail-content ai-referent-packet-content">
            <p className="ai-referent-packet-context">{letterLabel || (kind === "journal" ? "Excel-журналы" : "Письмо и вложения")}</p>
            {details?.length ? <dl className="ai-referent-packet-details">{details.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
            <p className="ai-referent-packet-help">Актуальное письмо и приложения. Исходные рабочие файлы остаются в защищённом хранилище.</p>
            {loading && !files.length ? <LoadingSkeleton layout="rows" rows={3} label="Загружаем файлы" /> : null}
            {error ? <p role="alert">{error}</p> : null}
            {!loading && !error && files.length === 0 ? <p>Робот ещё не передал файлы этого письма.</p> : null}
            {files.map((file) => <div className="ai-referent-file ai-referent-packet-file" key={`${file.source}:${file.id}`}>
              <Document20Regular aria-hidden="true" />
              <span className="ai-referent-file-info"><strong>{file.name.split("/").at(-1)}</strong><small>{Math.max(1, Math.round(file.byteSize / 1024))} КБ · {new Date(file.createdAt).toLocaleString("ru-RU")}</small></span>
              <div className="ai-referent-packet-file-actions">
                {fileViewerKind({ fileName: file.name, contentType: "" }) !== "unsupported" && <Button {...previewFocusTarget} disabled={busy} onClick={() => setPreview(file)} aria-label={`Открыть в Workspace: ${file.name.split("/").at(-1)}`}>Открыть в Workspace</Button>}
                <Button disabled={busy} icon={<ArrowDownload20Regular />} aria-label={`Скачать ${file.name.split("/").at(-1)}`} onClick={() => void download(file)} />
              </div>
            </div>)}
            <div className="ai-referent-detail-actions">
              <Button disabled={busy || loading} onClick={() => void refresh()}>Обновить</Button>
              <Button appearance="primary" disabled={busy || files.length === 0} onClick={() => void download()}>Скачать пакет ZIP</Button>
            </div>
          </DialogContent>
          {open && preview ? <AIReferentPacketViewer token={token} kind={kind} ownerId={ownerId} file={preview} onClose={() => setPreview(undefined)} /> : null}
        </DialogBody>
      </DialogSurface>
    </WorkspaceDialog>;
});
