import { useCallback, useEffect, useState } from "react";
import type { AIReferentPacketFile, AIReferentPacketKind } from "@yuksalish/contracts";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { ArrowDownload20Regular, Dismiss20Regular, Document20Regular, FolderOpen20Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { downloadAIReferentPacket, loadAIReferentPacket } from "./workspace-api";

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

export function AIReferentFiles({ token, kind, ownerId, letterLabel }: {
  readonly token: string; readonly kind: AIReferentPacketKind; readonly ownerId: string;
  readonly letterLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<readonly AIReferentPacketFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  return <>
    <Button className="ai-referent-packet-trigger" icon={<FolderOpen20Regular />} onClick={() => setOpen(true)}>Пакет документов</Button>
    <WorkspaceDialog open={open} onOpenChange={(_event, data) => setOpen(data.open)}>
      <DialogSurface className="ai-referent-detail-dialog ai-referent-packet-dialog" aria-label="Пакет документов">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть пакет" onClick={() => setOpen(false)} />}>Пакет документов</DialogTitle>
          <DialogContent className="ai-referent-detail-content ai-referent-packet-content">
            <p className="ai-referent-packet-context">{letterLabel || (kind === "journal" ? "Excel-журналы" : "Письмо и вложения")}</p>
            <p className="ai-referent-packet-help">Доступные документы и сохранённые версии. Оригиналы остаются на ПК референта.</p>
            {loading ? <Spinner label="Загружаем файлы" /> : null}
            {error ? <p role="alert">{error}</p> : null}
            {!loading && !error && files.length === 0 ? <p>Робот ещё не передал файлы этого письма.</p> : null}
            {files.map((file) => <button type="button" className="ai-referent-file" key={file.id} disabled={busy} onClick={() => void download(file)}>
              <Document20Regular aria-hidden="true" />
              <span className="ai-referent-file-info"><strong>{file.name.split("/").at(-1)}</strong><small>{Math.max(1, Math.round(file.byteSize / 1024))} КБ · {new Date(file.createdAt).toLocaleString("ru-RU")}</small></span>
              <ArrowDownload20Regular aria-hidden="true" />
            </button>)}
            <div className="ai-referent-detail-actions">
              <Button disabled={busy || loading} onClick={() => void refresh()}>Обновить</Button>
              <Button appearance="primary" disabled={busy || files.length === 0} onClick={() => void download()}>Скачать пакет ZIP</Button>
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </WorkspaceDialog>
  </>;
}
