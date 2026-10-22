import { useEffect, useRef, useState } from "react";
import type { DossierAccessRule, DossierAccessSettings, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { Button, Checkbox, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Select, Textarea } from "@fluentui/react-components";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { PersonPicker } from "./PersonPicker";
import { loadDossierAccess, saveDossierAccess } from "./workspace-api";

export function DossierAccessDialog({ token, people, departments, onClose, onSaved }: {
  readonly token: string; readonly people: readonly WorkspacePerson[];
  readonly departments: readonly WorkspaceDepartment[]; readonly onClose: () => void; readonly onSaved: () => void;
}) {
  const [settings, setSettings] = useState<DossierAccessSettings>();
  const [rules, setRules] = useState<readonly DossierAccessRule[]>([]);
  const [grantee, setGrantee] = useState("");
  const [scope, setScope] = useState<DossierAccessRule["scope"]>("employee");
  const [scopeId, setScopeId] = useState("");
  const [view, setView] = useState(true);
  const [edit, setEdit] = useState(false);
  const [photo, setPhoto] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [retry, setRetry] = useState(0);
  const saving = useRef(false);
  useEffect(() => {
    let active = true;
    loadDossierAccess(token).then((value) => { if (active) { setSettings(value); setRules(value.rules); setError(undefined); } })
      .catch((value: unknown) => { if (active) setError(value instanceof Error ? value.message : "Не удалось загрузить права"); });
    return () => { active = false; };
  }, [token, retry]);
  const activePeople = people.filter((p) => !p.status || p.status === "active");
  const close = () => { if (saving.current) return; if (dirty) setDiscard(true); else onClose(); };
  const add = () => {
    if (!grantee || (scope !== "all" && !scopeId) || (!view && !photo)) { setError("Выберите получателя, область и разрешения."); return; }
    if (rules.some((r) => r.granteeUserId === grantee && r.scope === scope && r.scopeId === (scope === "all" ? null : scopeId))) { setError("Такое правило уже есть. Удалите прежнее правило перед заменой."); return; }
    setRules([...rules, { granteeUserId: grantee, scope, scopeId: scope === "all" ? null : scopeId, view, edit, photoRoster: photo }]);
    setDirty(true); setError(undefined);
  };
  const save = async () => {
    if (!settings || saving.current) return;
    saving.current = true; setBusy(true); setError(undefined);
    try { await saveDossierAccess(token, { revision: settings.revision, rules, reason }); onSaved(); onClose(); }
    catch (value) { setError(value instanceof Error ? value.message : "Не удалось сохранить права"); }
    finally { saving.current = false; setBusy(false); }
  };
  return <WorkspaceDialog open onOpenChange={(_, data) => { if (!data.open) close(); }}><DialogSurface className="dossier-dialog" aria-label="Доступ к объективкам"><DialogBody>
    <DialogTitle>Доступ к объективкам</DialogTitle><DialogContent>
      <WorkspaceNotice tone="info">Каждый сотрудник видит и меняет свою анкету. Администраторы и назначенный кадровик имеют кадровый доступ; председатель и заместители — фотокарточки, но не полные чужие анкеты. Здесь выдаются дополнительные права.</WorkspaceNotice>
      {!settings && !error ? <p role="status">Загружаем правила…</p> : null}
      {settings ? <fieldset disabled={busy} className="dossier-form">
        <section className="dossier-section"><h3>Дополнительное правило</h3><div className="dossier-grid">
          <Field label="Кому предоставить доступ"><PersonPicker people={activePeople} departments={departments} token={token} value={grantee} onChange={(id) => setGrantee(id ?? "")} label="Получатель доступа к объективкам" /></Field>
          <Field label="Область доступа"><Select value={scope} onChange={(_, data) => { setScope(data.value as DossierAccessRule["scope"]); setScopeId(""); }}><option value="employee">Конкретный сотрудник</option><option value="department">Подразделение</option><option value="all">Вся организация</option></Select></Field>
          {scope === "employee" ? <Field label="Чья объективка"><PersonPicker people={activePeople} departments={departments} token={token} value={scopeId} onChange={(id) => setScopeId(id ?? "")} label="Сотрудник для области доступа" /></Field> : scope === "department" ? <Field label="Подразделение (без вложенных)"><Select value={scopeId} onChange={(_, data) => setScopeId(data.value)}><option value="">Выберите подразделение</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field> : <p>Все активные сотрудники организации.</p>}
        </div><div className="dossier-rule-checks"><Checkbox label="Просмотр объективки" checked={view} onChange={(_, data) => { setView(data.checked === true); if (!data.checked) setEdit(false); }} /><Checkbox label="Редактирование объективки" checked={edit} onChange={(_, data) => { setEdit(data.checked === true); if (data.checked) setView(true); }} /><Checkbox label="Фотокарточки" checked={photo} onChange={(_, data) => setPhoto(data.checked === true)} /></div>
        <Button disabled={rules.length >= 200} onClick={add}>Добавить правило в список</Button></section>
        <section className="dossier-section"><h3>Явные правила · {rules.length}</h3>
          {!rules.length ? <p>Дополнительный доступ не выдан.</p> : <ul className="dossier-rules">{rules.map((r, index) => <li key={`${r.granteeUserId}:${r.scope}:${r.scopeId}`}><div><strong>{people.find((p) => p.id === r.granteeUserId)?.name ?? "Сотрудник"}</strong><span>{r.scope === "all" ? "Вся организация" : r.scope === "employee" ? people.find((p) => p.id === r.scopeId)?.name ?? "Сотрудник" : departments.find((d) => d.id === r.scopeId)?.name ?? "Подразделение"}</span><small>{[r.view && "Просмотр", r.edit && "Редактирование", r.photoRoster && "Фотокарточки"].filter(Boolean).join(" · ")}</small></div><Button onClick={() => { setRules(rules.filter((_, i) => i !== index)); setDirty(true); }}>Убрать правило {index + 1}</Button></li>)}</ul>}
        </section><Field label="Основание изменения доступа"><Textarea required minLength={3} maxLength={500} value={reason} onChange={(_, data) => setReason(data.value)} /></Field><p>Добавление и удаление вступят в силу только после сохранения. История фиксирует автора и основание.</p>
      </fieldset> : null}
    </DialogContent><div className="dossier-feedback">{error ? <WorkspaceNotice tone="error" role="alert" actions={!settings ? <Button onClick={() => setRetry((n) => n + 1)}>Повторить</Button> : undefined}>{error}</WorkspaceNotice> : null}{discard ? <WorkspaceNotice tone="warning" role="alert" actions={<><Button onClick={onClose}>Закрыть без сохранения</Button><Button onClick={() => setDiscard(false)}>Продолжить</Button></>}>Изменения прав ещё не сохранены.</WorkspaceNotice> : null}</div>
    <DialogActions><Button disabled={busy} onClick={close}>Закрыть</Button><Button appearance="primary" disabled={!settings || busy || !dirty || reason.trim().length < 3} onClick={() => void save()}>{busy ? "Сохраняем…" : "Сохранить права"}</Button></DialogActions>
  </DialogBody></DialogSurface></WorkspaceDialog>;
}
