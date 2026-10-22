import { useEffect, useMemo, useState } from "react";
import type { DossierContext, DossierSummary, PersonnelPhotoCard, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { Badge, Button, Field, Select } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { TaskPersonAvatar } from "./TaskPersonAvatar";
import { DossierDialog } from "./DossierDialog";
import { DossierAccessDialog } from "./DossierAccessDialog";
import { RecordTablePager, useTablePage } from "./RecordTableTools";
import { loadDossierList, loadPersonnelPhotos } from "./workspace-api";
import "./record-lists.css";
import "./dossiers.css";

export function DossiersWorkspace({ token, people, departments = [], context, mode }: {
  readonly token: string; readonly people: readonly WorkspacePerson[];
  readonly departments?: readonly WorkspaceDepartment[]; readonly context?: DossierContext;
  readonly mode: "dossiers" | "photos";
}) {
  const [records, setRecords] = useState<readonly DossierSummary[]>([]);
  const [photos, setPhotos] = useState<readonly PersonnelPhotoCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("");
  const [selected, setSelected] = useState<string>();
  const [accessOpen, setAccessOpen] = useState(false);
  useEffect(() => {
    let active = true;
    const request = mode === "photos" ? loadPersonnelPhotos(token).then((value) => { if (active) setPhotos(value); }) : loadDossierList(token).then((value) => { if (active) setRecords(value); });
    request.then(() => { if (active) { setLoading(false); setError(undefined); } }).catch((value: unknown) => { if (active) { setError(value instanceof Error ? value.message : "Не удалось загрузить анкеты"); setLoading(false); } });
    return () => { active = false; };
  }, [token, mode, revision]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const rows = (mode === "photos" ? photos : records).filter((row) => (!department || row.departmentId === department) && `${row.fullName} ${row.jobTitle ?? ""}`.toLocaleLowerCase("ru").includes(query.toLocaleLowerCase("ru")));
  const paging = useTablePage(rows.length, `${query}:${department}:${mode}`);
  return <section className="dossiers-workspace" aria-label={mode === "photos" ? "Фотокарточки сотрудников" : "Объективки сотрудников"}>
    <header className="dossier-workspace-heading"><div><h2>{mode === "photos" ? "Фотокарточки" : "Объективки"}</h2><p>{mode === "photos" ? "Краткий реестр: только фото, ФИО, год рождения, образование и должность." : "Личные анкеты и подтверждённая история изменений. В списке только доступные вам сотрудники."}</p></div><div className="dossier-actions"><Button onClick={() => { setLoading(true); setRevision((n) => n + 1); }}>Обновить список</Button>{context?.canManageAccess ? <Button onClick={() => setAccessOpen(true)}>Настроить доступ</Button> : null}</div></header>
    <div className="dossier-filters"><Field label="Поиск сотрудника"><Input type="search" value={query} onChange={(_, data) => setQuery(data.value)} placeholder="ФИО или должность" /></Field><Field label="Подразделение"><Select value={department} onChange={(_, data) => setDepartment(data.value)}><option value="">Все доступные</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>{!loading && !error ? <span>{rows.length} сотрудников</span> : null}</div>
    {error ? <WorkspaceNotice tone="error" role="alert" actions={<Button onClick={() => { setLoading(true); setRevision((n) => n + 1); }}>Повторить загрузку</Button>}>{error}</WorkspaceNotice> : null}
    {loading ? <p role="status">Загружаем…</p> : !error ? <div className="record-table-frame"><div className="record-table-scroll" role="region" aria-label={mode === "photos" ? "Реестр фотокарточек" : "Список объективок"} tabIndex={0}><table className={`record-table dossier-table${mode === "photos" ? " dossier-photo-table" : ""}`}><thead><tr>{mode === "photos" ? <th>№</th> : null}<th>Сотрудник</th><th>Должность</th>{mode === "photos" ? <><th>Год рождения</th><th>Окончил вуз</th></> : <><th>Состояние</th><th>Обновлена</th><th>Действие</th></>}</tr></thead><tbody>
      {rows.slice(paging.start, paging.start + paging.size).map((row, index) => <tr key={row.userId}>{mode === "photos" ? <td>{paging.start + index + 1}</td> : null}<td><div className="dossier-person"><TaskPersonAvatar person={byId.get(row.userId)} token={token} size={48} fallbackName={row.fullName} /><strong>{row.fullName}</strong></div></td><td>{row.jobTitle ?? "Не указана"}</td>{"birthYear" in row ? <><td>{row.birthYear ?? "Не указано"}</td><td>{row.universities.join("; ") || "Не указано"}</td></> : <><td><Badge appearance="tint" color={row.status === "saved" ? "success" : "subtle"}>{row.status === "saved" ? "Сохранена" : row.status === "draft" ? "Черновик" : "Не заполнена"}</Badge></td><td>{row.updatedAt ? new Date(row.updatedAt).toLocaleString("ru-RU") : "—"}</td><td><Button onClick={() => setSelected(row.userId)} aria-label={`Объективка: ${row.fullName}`}>Открыть</Button></td></>}</tr>)}
    </tbody></table>{!rows.length ? <div className="record-empty">Сотрудники не найдены. Измените поиск или фильтр.</div> : null}</div><RecordTablePager total={rows.length} paging={paging} label="сотрудники" /></div> : null}
    <p className="dossier-next-stage">{mode === "photos" ? "Выгрузки Word, Excel и PDF подготовим после получения образца фотокарточек." : "Откройте объективку, чтобы заполнить поля вручную или импортировать DOCX и скачать Word/PDF по согласованному образцу."}</p>
    {selected ? <DossierDialog key={`${token}:${selected}`} token={token} userId={selected} people={people} onClose={() => setSelected(undefined)} onSaved={() => setRevision((n) => n + 1)} /> : null}
    {accessOpen ? <DossierAccessDialog token={token} people={people} departments={departments} onClose={() => setAccessOpen(false)} onSaved={() => setRevision((n) => n + 1)} /> : null}
  </section>;
}
