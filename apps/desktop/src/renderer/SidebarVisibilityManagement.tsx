import { useEffect, useState } from "react";
import type { DirectoryBootstrap, NavigationKey, SidebarVisibility, WorkspacePerson } from "@yuksalish/contracts";
import { Button, Checkbox, DialogSurface, Field, Spinner } from "@fluentui/react-components";
import { Dismiss20Regular, Navigation24Regular } from "@fluentui/react-icons";
import { PersonPicker } from "./PersonPicker";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { fallbackModules } from "./module-catalog";
import { loadSidebarVisibility, saveSidebarVisibility } from "./workspace-api";

const sections: readonly { key: NavigationKey; label: string }[] = [
  ...fallbackModules.flatMap((item) => item.key === "assistant" || item.key === "projects" ? [] : [{ key: item.key, label: item.label.ru }]),
  { key: "notifications", label: "Уведомления" },
];

export function SidebarVisibilityManagement({ token, directory, currentUser, initialUserId, onClose }: {
  readonly token: string; readonly directory: DirectoryBootstrap; readonly currentUser: WorkspacePerson;
  readonly initialUserId?: string; readonly onClose: () => void;
}) {
  const people: WorkspacePerson[] = directory.employees
    .filter((employee) => employee.role !== "superadmin" || currentUser.role === "superadmin")
    .map((employee) => ({ id: employee.id, username: employee.username, name: employee.name,
      role: employee.role, departmentId: employee.departmentId, jobTitle: employee.jobTitle,
      initials: employee.name.split(" ").map((part) => part[0]).slice(0, 2).join(""), color: "brand" }));
  const [userId, setUserId] = useState(() => people.find((person) => person.id === initialUserId)?.id ?? people[0]?.id ?? "");
  const [saved, setSaved] = useState<SidebarVisibility>();
  const [hidden, setHidden] = useState<readonly NavigationKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectEmployee = (id: string) => {
    setUserId(id); setSaved(undefined); setHidden([]); setError(""); setNotice(""); setLoading(!!id);
  };
  const reload = () => {
    setSaved(undefined); setLoading(true); setError(""); setNotice(""); setAttempt((value) => value + 1);
  };
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void loadSidebarVisibility(token, userId).then((value) => {
      if (active) { setSaved(value); setHidden(value.hiddenKeys); }
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Не удалось загрузить меню сотрудника");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, userId, attempt]);
  const changed = saved?.userId === userId && (hidden.length !== saved.hiddenKeys.length || hidden.some((key) => !saved.hiddenKeys.includes(key)));
  const save = async () => {
    if (!saved || busy || !changed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await saveSidebarVisibility(token, userId, hidden, saved.revision);
      setSaved(value); setHidden(value.hiddenKeys); setNotice("Меню сохранено. Изменения применяются на устройствах сотрудника.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить меню. Повторите попытку.");
    } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(_, data) => { if (!data.open && !busy && data.type === "escapeKeyDown") onClose(); }}><DialogSurface className="sidebar-visibility-dialog" aria-label="Настройка меню сотрудника"><form className="sidebar-visibility-management" aria-label="Меню сотрудника" onSubmit={(event) => { event.preventDefault(); void save(); }} aria-busy={busy || loading}>
    <header><span className="sidebar-visibility-icon" aria-hidden="true"><Navigation24Regular /></span><div><h2>Меню сотрудника</h2><p>Оставьте в боковом меню только нужные разделы.</p></div><Button type="button" appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть настройку меню" disabled={busy} onClick={onClose} /></header>
    <div className="sidebar-visibility-scroll">
      <Field label="Сотрудник"><PersonPicker token={token} people={people} departments={directory.departments} value={userId} label="Сотрудник для настройки меню" disabled={busy} onChange={selectEmployee} /></Field>
      <p className="sidebar-visibility-explanation">Скрытие убирает кнопку, но не меняет права доступа. Для ограничения доступа используйте «Права модулей». Настройки профиля остаются доступны.</p>
      {loading && userId ? <div className="sidebar-visibility-loading"><Spinner size="small" label="Загружаем меню" /></div> : saved?.userId === userId ? <>
        <div className="sidebar-visibility-list-head"><strong>Показывать в меню</strong><Button type="button" appearance="subtle" disabled={busy || !hidden.length} onClick={() => { setHidden([]); setNotice(""); }}>Вернуть все кнопки</Button></div>
        <div className="sidebar-visibility-list">{sections.map((section) => <Checkbox key={section.key} label={section.label} checked={!hidden.includes(section.key)} disabled={busy} onChange={(_, data) => { setHidden((current) => data.checked ? current.filter((key) => key !== section.key) : [...current, section.key]); setNotice(""); }} />)}</div>
      </> : !error ? <p>Выберите сотрудника, чтобы настроить его меню.</p> : null}
      {error ? <div className="sidebar-visibility-error" role="alert"><span>{error}</span><Button type="button" disabled={busy || loading} onClick={reload}>Обновить настройки</Button></div> : null}
      {notice ? <p className="sidebar-visibility-notice" role="status">{notice}</p> : null}
    </div>
    <footer><span>{saved ? `${hidden.filter((key) => sections.some((section) => section.key === key)).length} скрыто` : "Изменения сохраняются только по кнопке"}</span><Button type="button" disabled={busy} onClick={onClose}>Закрыть</Button><Button type="submit" appearance="primary" disabled={busy || loading || !changed}>{busy ? "Сохраняем…" : "Сохранить меню"}</Button></footer>
  </form></DialogSurface></Dialog>;
}
