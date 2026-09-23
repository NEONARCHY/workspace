import { useCallback, useEffect, useState } from "react";
import type { AIReferentPacketFile, AIReferentPacketKind } from "@yuksalish/contracts";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, Spinner } from "@fluentui/react-components";
import { Dismiss20Regular, FolderOpen20Regular } from "@fluentui/react-icons";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { downloadAIReferentPacket, loadAIReferentPacket } from "./workspace-api";

export function saveReferentBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AIReferentFiles({ token, kind, ownerId }: {
  readonly token: string; readonly kind: AIReferentPacketKind; readonly ownerId: string;
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
    try { saveReferentBlob(await downloadAIReferentPacket(token, kind, ownerId, file), file?.name.split("/").at(-1) ?? `letter-${ownerId}.zip`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось скачать файл."); }
    finally { setBusy(false); }
  };
  return <>
    <Button icon={<FolderOpen20Regular />} onClick={() => setOpen(true)}>Пакет документов</Button>
    <WorkspaceDialog open={open} onOpenChange={(_event, data) => setOpen(data.open)}>
      <DialogSurface className="ai-referent-detail-dialog" aria-label="Пакет документов">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть пакет" onClick={() => setOpen(false)} />}>Пакет документов</DialogTitle>
          <DialogContent className="ai-referent-detail-content">
            <p>Письмо, вложения и сохранённые версии. Рабочие папки референта остаются на его компьютере.</p>
            {loading ? <Spinner label="Загружаем файлы" /> : null}
            {error ? <p role="alert">{error}</p> : null}
            {!loading && !error && files.length === 0 ? <p>Робот ещё не передал файлы этого письма.</p> : null}
            {files.map((file) => <button type="button" className="ai-referent-file" key={file.id} disabled={busy} onClick={() => void download(file)}>
              <span><strong>{file.name}</strong><small>{Math.max(1, Math.round(file.byteSize / 1024))} КБ · {new Date(file.createdAt).toLocaleString("ru-RU")}</small></span>
              <span>Скачать</span>
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
