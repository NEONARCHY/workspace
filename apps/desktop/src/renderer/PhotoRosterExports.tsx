import { useEffect, useRef, useState } from "react";
import type { PhotoRosterFormat } from "@yuksalish/contracts";
import { Button } from "@fluentui/react-components";
import { ArrowDownload20Regular } from "@fluentui/react-icons";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { downloadPersonnelPhotos } from "./workspace-api";
import { saveReferentBlob } from "./AIReferentFiles";

const formats = [
  { kind: "word", label: "Word", extension: "docx" },
  { kind: "excel", label: "Excel", extension: "xlsx" },
  { kind: "pdf", label: "PDF", extension: "pdf" },
] as const;

export function PhotoRosterExports({ token, userIds, disabled = false }: {
  readonly token: string;
  readonly userIds: readonly string[];
  readonly disabled?: boolean;
}) {
  const [busy, setBusy] = useState<PhotoRosterFormat>();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const download = async (format: typeof formats[number]) => {
    if (pending.current || disabled || !userIds.length || userIds.length > 500) return;
    pending.current = true; setBusy(format.kind); setError(""); setSuccess("");
    const selected = [...userIds];
    try {
      const blob = await downloadPersonnelPhotos(token, format.kind, { userIds: selected });
      if (!alive.current) return;
      saveReferentBlob(blob, `Фотокарточки сотрудников.${format.extension}`);
      setSuccess(`Файл ${format.label} подготовлен. Сотрудников: ${selected.length}.`);
    } catch (value) {
      if (alive.current) setError(value instanceof Error ? value.message : "Не удалось подготовить файл. Повторите скачивание.");
    } finally {
      pending.current = false;
      if (alive.current) setBusy(undefined);
    }
  };
  return <section className="photo-roster-exports" aria-label="Скачивание фотокарточек">
    <div className="photo-roster-export-row"><div><h3>Скачать найденных сотрудников · {userIds.length}</h3><p>Весь найденный список, включая другие страницы. Фото и сведения берутся из сохранённых профилей и объективок.</p></div>
      <div className="dossier-actions" role="group" aria-label="Формат фотокарточек">{formats.map(format => <Button key={format.kind} icon={<ArrowDownload20Regular />} disabled={disabled || Boolean(busy) || !userIds.length || userIds.length > 500} aria-label={`Скачать фотокарточки в ${format.label}`} onClick={() => void download(format)}>{format.label}</Button>)}</div></div>
    {userIds.length > 500 ? <WorkspaceNotice tone="warning">За один раз можно скачать до 500 сотрудников. Выберите подразделение или уточните поиск.</WorkspaceNotice> : null}
    {busy ? <p role="status">Готовим {formats.find(format => format.kind === busy)?.label} с фотографиями…</p> : null}
    {error ? <WorkspaceNotice tone="error" role="alert">{error} Файл не скачан. Можно повторить действие; при недоступности PDF остаются Word и Excel.</WorkspaceNotice> : null}
    {success ? <p role="status">{success}</p> : null}
  </section>;
}
