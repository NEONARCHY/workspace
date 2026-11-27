import { russianDateTimeFormatter } from "./date-time-format";
import { WorkspaceNotice } from "./WorkspaceNotice";
import type { DossierContext } from "@yuksalish/contracts";
import { DossiersWorkspace } from "./DossiersWorkspace";
import { loadDossierContext } from "./workspace-api";
import { SkeletonBlock } from "./LoadingSkeleton";
import { HrStaffTable } from "./HrStaffTable";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useModalFocus } from "./useModalFocus";
import type { HrOverview, HrProfile, HrRegister, HrWorkbookPreview, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { Badge, Button, Portal, Tab, TabList } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import { Add20Regular, ArrowClockwise20Regular, Checkmark20Regular, Dismiss20Regular, DocumentArrowDown20Regular, DocumentArrowUp20Regular, PersonEdit20Regular } from "@fluentui/react-icons";
import { actHrRegister, createHrProfile, generateHrRegister, importHrProfiles, loadHrOverview, previewHrWorkbook, saveHrProfile, saveHrSettings, terminateHrProfile } from "./workspace-api";
import { PersonPicker } from "./PersonPicker";
import { HrHiringView } from "./HrHiringView";
import { employeeDisplayName } from "./employee-display-name";

type TabKey = "staff" | "tenure" | "registers" | "hiring" | "dossiers" | "photos";
const today = () => new Date().toISOString().slice(0, 10);
const month = () => new Date().toISOString().slice(0, 7);
const calculationDate = (value?: string) => value ? russianDateTimeFormatter({ dateStyle: "long" }).format(new Date(`${value}T00:00:00`)) : "…";
const statusLabel: Record<string, string> = { draft: "Черновик HR", pending_chair: "На подписи председателя", approved: "Передан бухгалтеру", returned: "Возвращён HR", closed: "Закрыт" };

interface Props { readonly token: string; readonly people: readonly WorkspacePerson[]; readonly departments?: readonly WorkspaceDepartment[]; readonly currentUser: WorkspacePerson; }

function exportCsv(register: HrRegister) {
  const rows = [["ФИО", "Должность", "Стаж", "Надбавка"], ...register.items.map((item) => [item.fullName, item.jobTitle ?? "", `${item.serviceYears} г. ${item.serviceMonths} мес. ${item.serviceDays} дн.`, `${item.allowancePercent}%`])];
  const blob = new Blob(["\uFEFF" + rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = `реестр-стажа-${register.period}.csv`; anchor.click(); URL.revokeObjectURL(anchor.href);
}

export function HrView({ token, people, departments, currentUser }: Props) {
  const [hiringOpened, setHiringOpened] = useState(false);
  const [dossierContext, setDossierContext] = useState<DossierContext>();
  const [dossierContextError, setDossierContextError] = useState(false);
  const [dossierRetry, setDossierRetry] = useState(0);
  useEffect(() => {
    let active = true;
    loadDossierContext(token).then((value) => { if (active) { setDossierContext(value); setDossierContextError(false); } })
      .catch(() => { if (active) setDossierContextError(true); });
    return () => { active = false; };
  }, [token, dossierRetry]);
  const [data, setData] = useState<HrOverview>(); const [tab, setTab] = useState<TabKey>("staff");
  const personnelTab = tab === "dossiers" || tab === "photos";
  const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false); const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false); const [fullName, setFullName] = useState(""); const [jobTitle, setJobTitle] = useState(""); const [employmentDate, setEmploymentDate] = useState(today()); const [anchorDate, setAnchorDate] = useState(today());
  const [profileUserId, setProfileUserId] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workbookPreview, setWorkbookPreview] = useState<HrWorkbookPreview>();
  const workbookInput = useRef<HTMLInputElement>(null);
  const [years, setYears] = useState("0"); const [months, setMonths] = useState("0"); const [days, setDays] = useState("0"); const [reason, setReason] = useState("");
  const active = useRef(false);
  const pendingLoad = useRef<AbortController | undefined>(undefined);
  const load = useCallback(async () => {
    if (!active.current) return;
    pendingLoad.current?.abort();
    const controller = new AbortController(); pendingLoad.current = controller;
    setBusy(true); setError(undefined);
    try { const next = await loadHrOverview(token, controller.signal); if (!controller.signal.aborted) setData(next); }
    catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : "Не удалось загрузить HR"); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [token]);
  useEffect(() => {
    let cancelled = false; active.current = true;
    queueMicrotask(() => { if (!cancelled) void load(); });
    return () => { cancelled = true; active.current = false; pendingLoad.current?.abort(); };
  }, [load]);
  const isConfigured = Boolean(data?.settings.hrUserId); const isHr = ["admin", "superadmin"].includes(currentUser.role) || data?.settings.hrUserId === currentUser.id;
  const isChair = ["admin", "superadmin"].includes(currentUser.role) || data?.settings.chairUserId === currentUser.id;
  const isAccountant = ["admin", "superadmin"].includes(currentUser.role) || data?.settings.accountantUserId === currentUser.id;
  const profileIndex = useMemo(() => (data?.profiles ?? []).map(item => ({
    profile: { ...item, fullName: employeeDisplayName(item.fullName) },
    text: `${item.fullName} ${item.jobTitle ?? ""}`.toLocaleLowerCase("ru"),
  })), [data?.profiles]);
  const search = query.toLocaleLowerCase("ru");
  const profiles = useMemo(() => profileIndex.filter(item => item.text.includes(search)).map(item => item.profile), [profileIndex, search]);
  const profilePeople = useMemo(() => {
    const terminated = new Set(data?.profiles.filter(profile => profile.employmentStatus === "terminated").map(profile => profile.userId));
    return people.filter(person => (!person.status || person.status === "active") && !terminated.has(person.id));
  }, [people, data?.profiles]);
  const summary = useMemo(() => (data?.profiles ?? []).reduce((counts, profile) => ({
    active: counts.active + Number(profile.employmentStatus === "active"),
    allowance: counts.allowance + Number(profile.allowancePercent > 0),
    terminated: counts.terminated + Number(profile.employmentStatus === "terminated"),
  }), { active: 0, allowance: 0, terminated: 0 }), [data?.profiles]);
  const terminate = useCallback((profile: HrProfile) => {
    const terminationReason = window.prompt("Основание увольнения (не менее 3 символов):");
    if (terminationReason && terminationReason.length >= 3) void terminateHrProfile(token, profile.id, { terminatedOn: today(), terminationReason })
      .then(load).catch((value: unknown) => setError(value instanceof Error ? value.message : "Ошибка"));
  }, [token, load]);
  const selectProfileUser = (userId: string) => {
    const person = profilePeople.find((item) => item.id === userId);
    const profile = data?.profiles.find((item) => item.userId === userId);
    setProfileUserId(userId); setFullName(person?.name ?? ""); setJobTitle(person?.jobTitle ?? "");
    setEmploymentDate(profile?.employmentDate ?? (userId ? "" : today()));
    // Overview tenure is calculated at calculatedAt, not at the original anchor.
    setAnchorDate(data?.calculatedAt ?? today());
    setYears(String(profile?.serviceYears ?? 0)); setMonths(String(profile?.serviceMonths ?? 0));
    setDays(String(profile?.serviceDays ?? 0)); setReason(""); setError(undefined);
  };
  const canSave = fullName.trim().length >= 3 && reason.trim().length >= 3 && employmentDate && anchorDate
    && [[years, 100], [months, 11], [days, 30]].every(([value, max]) =>
      String(value).trim() !== "" && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= Number(max));
  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true); setError(undefined);
    const payload = { employmentDate, serviceAnchorDate: anchorDate, serviceYears: Number(years),
      serviceMonths: Number(months), serviceDays: Number(days), serviceReason: reason.trim() };
    try {
      if (profileUserId) await saveHrProfile(token, profileUserId, payload);
      else await createHrProfile(token, { ...payload, fullName: fullName.trim(), jobTitle: jobTitle.trim() || null });
      setEditorOpen(false); selectProfileUser(""); await load();
    } catch (value) { setError(value instanceof Error ? value.message : "Не удалось сохранить стаж"); setBusy(false); }
  };
  const previewImport = async (file: File) => { setBusy(true); setError(undefined); try { setWorkbookPreview(await previewHrWorkbook(token, file)); } catch (value) { setError(value instanceof Error ? value.message : "Не удалось прочитать файл Excel"); } finally { setBusy(false); } };
  const confirmImport = async () => { if (!workbookPreview) return; setBusy(true); try { const result = await importHrProfiles(token, { sourceLabel: workbookPreview.sourceLabel, rows: workbookPreview.rows }); setWorkbookPreview(undefined); setError(`Импорт завершён: создано ${result.created}, уже было в списке ${result.alreadyImported}.`); await load(); } catch (value) { setError(value instanceof Error ? value.message : "Не удалось импортировать карточки"); setBusy(false); } };
  const action = async (register: HrRegister, type: "submit" | "approve" | "return" | "account") => { const comment = type === "return" ? window.prompt("Причина возврата обязательна:") ?? undefined : undefined; if (type === "return" && !comment) return; setBusy(true); try { await actHrRegister(token, register.id, type, comment); await load(); } catch (value) { setError(value instanceof Error ? value.message : "Не удалось изменить реестр"); setBusy(false); } };
  return <section className="workspace-view workspace-queue hr-view" aria-label="HR — кадровое пространство">
    <WorkspaceSectionHeader motif="hr" className="section-toolbar hr-toolbar">
      <div><span className="hr-kicker">ЛЮДИ И КАДРОВЫЕ ПРОЦЕССЫ</span><h1>HR · Кадровое пространство</h1>
        <p>Сотрудники, стаж, приём на работу и согласования.</p></div>
      <div className="toolbar-actions"><Button icon={<ArrowClockwise20Regular />} disabled={busy} onClick={() => void load()}>Обновить</Button></div>
    </WorkspaceSectionHeader>
    <div className={`hr-command-bar${personnelTab ? " dossier-hidden" : ""}`}><span>Расчёт стажа на <strong>{calculationDate(data?.calculatedAt)}</strong></span>
      {isHr ? <div className="hr-command-actions">
        <input ref={workbookInput} className="hr-file-input" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { const [file] = Array.from(event.target.files ?? []); event.currentTarget.value = ""; if (file) void previewImport(file); }} />
        <Button icon={<DocumentArrowUp20Regular />} disabled={busy} onClick={() => workbookInput.current?.click()}>Импорт Excel</Button>
        <Button appearance="primary" icon={<Add20Regular />} disabled={busy} onClick={() => { selectProfileUser(""); setEditorOpen(true); }}>Кадровая карточка</Button>
        {currentUser.role === "superadmin" && isConfigured ? <Button onClick={() => setSettingsOpen(true)}>Настроить маршрут</Button> : null}
      </div> : null}
    </div>
    {!personnelTab && data && !isConfigured ? <WorkspaceNotice tone="info" className="hr-alert"><strong>Назначьте участников маршрута</strong><span>Superadmin должен указать HR, председателя и главного бухгалтера в настройках HR перед запуском первого реестра.</span>{currentUser.role === "superadmin" ? <Button appearance="primary" onClick={() => setSettingsOpen(true)}>Настроить маршрут</Button> : null}</WorkspaceNotice> : null}
    {!personnelTab && error ? <WorkspaceNotice tone="error" className="hr-alert hr-error" role="alert" actions={!data ? <Button onClick={() => void load()}>Повторить</Button> : undefined}>{error}</WorkspaceNotice> : null}
    <TabList className="hr-tabs" aria-label="Разделы HR" selectedValue={tab} onTabSelect={(_, value) => { setTab(value.value as TabKey); if (value.value === "hiring") setHiringOpened(true); }}><Tab value="staff">Сотрудники</Tab><Tab value="tenure">Иш стажи</Tab><Tab value="registers">Месячные реестры</Tab><Tab value="hiring">Приём на работу</Tab><Tab value="dossiers">Объективки</Tab>{dossierContext?.canViewPhotoRoster ? <Tab value="photos">Фотокарточки</Tab> : null}</TabList>
    {dossierContextError ? <WorkspaceNotice tone="warning" actions={<Button onClick={() => setDossierRetry((n) => n + 1)}>Повторить проверку прав</Button>}>Не удалось проверить доступ к фотокарточкам.</WorkspaceNotice> : null}
    {personnelTab ? <DossiersWorkspace key={`${currentUser.id}:${tab}`} token={token} people={people} departments={departments} context={dossierContext} mode={tab === "photos" ? "photos" : "dossiers"} /> : null}
    {hiringOpened ? <div hidden={tab !== "hiring"}><HrHiringView key={currentUser.id} token={token} /></div> : null}
    {tab === "hiring" || personnelTab ? null : tab !== "registers" ? <><div className="hr-summary"><div><strong>{(data ? summary.active : undefined) ?? <SkeletonBlock width="48px" height="28px" />}</strong><span>активных карточек</span></div><div><strong>{(data ? summary.allowance : undefined) ?? <SkeletonBlock width="48px" height="28px" />}</strong><span>с надбавкой</span></div><div><strong>{(data ? summary.terminated : undefined) ?? <SkeletonBlock width="48px" height="28px" />}</strong><span>уволенных в истории</span></div></div><div className="hr-controls"><Input value={query} onChange={(_, value) => setQuery(value.value)} placeholder="Поиск по сотруднику или должности" aria-label="Поиск кадровой карточки" /></div><HrStaffTable profiles={profiles} filterKey={query} loading={!data && !error} loaded={Boolean(data)} canEdit={isHr} onTerminate={terminate} /></> : <section className="hr-registers"><div className="hr-register-actions">{isHr ? <Button appearance="primary" disabled={busy} onClick={() => void generateHrRegister(token, month()).then(load).catch((value: unknown) => setError(value instanceof Error ? value.message : "Ошибка"))}>Создать реестр за {month()}</Button> : null}<span>Черновик создаётся один раз для периода и фиксирует стаж на последний день месяца.</span></div>{data?.registers.map((register) => <article key={register.id} className="hr-register-card"><header><div><h2>{register.period} · версия {register.version}</h2><p>{register.items.length} сотрудников · {statusLabel[register.status] ?? register.status}</p></div><Badge appearance="tint" color={register.status === "closed" ? "success" : register.status === "returned" ? "danger" : "brand"}>{statusLabel[register.status] ?? register.status}</Badge></header>{register.returnComment ? <p className="hr-return">Возврат: {register.returnComment}</p> : null}<div className="hr-register-footer"><Button icon={<DocumentArrowDown20Regular />} onClick={() => exportCsv(register)}>CSV для бухгалтерии</Button>{isHr && ["draft", "returned"].includes(register.status) ? <Button appearance="primary" icon={<Checkmark20Regular />} onClick={() => void action(register, "submit")}>Отправить председателю</Button> : null}{isChair && register.status === "pending_chair" ? <><Button appearance="primary" onClick={() => void action(register, "approve")}>Подписать</Button><Button onClick={() => void action(register, "return")}>Вернуть HR</Button></> : null}{isAccountant && register.status === "approved" ? <Button appearance="primary" onClick={() => void action(register, "account")}>Подтвердить расчёт</Button> : null}</div></article>)}</section>}
    {editorOpen ? <HrEditor label="Кадровая карточка" busy={busy} error={error} onClose={() => setEditorOpen(false)}>
      <div><span className="hr-kicker">КАДРОВЫЕ ДАННЫЕ</span><h2>Кадровая карточка</h2>
        <p>Выберите сотрудника Workspace, чтобы дата приёма учитывалась в отпусках. Его существующая карточка откроется для изменения. Без выбора создаётся отдельная карточка, не связанная с аккаунтом.</p></div>
      <PersonPicker label="Сотрудник кадровой карточки" people={profilePeople} departments={departments}
        value={profileUserId} onChange={selectProfileUser} disabled={busy} />
      <div className="hr-form-grid">
        <label>ФИО<input value={fullName} readOnly={Boolean(profileUserId)} disabled={busy} onChange={(event) => setFullName(event.target.value)} placeholder="Фамилия Имя Отчество" /></label>
        <label>Должность<input value={jobTitle} readOnly={Boolean(profileUserId)} disabled={busy} onChange={(event) => setJobTitle(event.target.value)} placeholder="Например: специалист" /></label>
        <label>Дата приёма в организацию<input type="date" aria-label="Дата приёма" value={employmentDate} onChange={(event) => setEmploymentDate(event.target.value)} disabled={busy} /></label>
        <label>Дата подтверждения стажа<input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} disabled={busy} /></label>
        <label>Лет<input type="number" min="0" max="100" disabled={busy} value={years} onChange={(event) => setYears(event.target.value)} /></label>
        <label>Месяцев<input type="number" min="0" max="11" disabled={busy} value={months} onChange={(event) => setMonths(event.target.value)} /></label>
        <label>Дней<input type="number" min="0" max="30" disabled={busy} value={days} onChange={(event) => setDays(event.target.value)} /></label>
        <label className="hr-reason">Основание<textarea maxLength={2000} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например: подтверждено трудовой книжкой" /></label>
      </div>
      <footer><Button disabled={busy} onClick={() => setEditorOpen(false)}>Отмена</Button>
        <Button appearance="primary" icon={<PersonEdit20Regular />} disabled={!canSave || busy} onClick={() => void save()}>Сохранить карточку</Button></footer>
    </HrEditor> : null}
    {workbookPreview ? <HrEditor label="Проверка импорта Excel" busy={busy} error={error} onClose={() => setWorkbookPreview(undefined)}><div><span className="hr-kicker">ПРОВЕРКА ИМПОРТА</span><h2>Карточки из Excel</h2><p>Найдено {workbookPreview.rows.length} сотрудников. Контрольная дата стажа: {workbookPreview.controlDate}.</p></div><div className="hr-preview-list">{workbookPreview.rows.slice(0, 8).map((item) => <div key={item.sourceRow}><strong>{item.fullName}</strong><span>{item.jobTitle ?? "Должность не указана"} · {item.serviceYears} г. {item.serviceMonths} мес. {item.serviceDays} дн.</span></div>)}{workbookPreview.rows.length > 8 ? <p>…и ещё {workbookPreview.rows.length - 8} сотрудников.</p> : null}</div><p>После подтверждения будут созданы только новые карточки. Повторный импорт этого же файла не создаст дубликаты.</p><footer><Button disabled={busy} onClick={() => setWorkbookPreview(undefined)}>Отмена</Button><Button appearance="primary" icon={<Checkmark20Regular />} disabled={busy} onClick={() => void confirmImport()}>Подтвердить импорт</Button></footer></HrEditor> : null}
    {settingsOpen && data ? <HrSettingsDialog people={people} departments={departments} settings={data.settings} busy={busy} error={error} onClose={() => setSettingsOpen(false)} onSave={async (settings) => { setBusy(true); try { await saveHrSettings(token, settings); setSettingsOpen(false); await load(); } catch (value) { setError(value instanceof Error ? value.message : "Не удалось сохранить маршрут"); setBusy(false); } }} /> : null}
  </section>;
}

function HrSettingsDialog({ people, departments, settings, busy, error, onClose, onSave }: { readonly people: readonly WorkspacePerson[]; readonly departments?: readonly WorkspaceDepartment[]; readonly settings: HrOverview["settings"]; readonly busy: boolean; readonly error?: string; readonly onClose: () => void; readonly onSave: (value: HrOverview["settings"]) => Promise<void>; }) {
  const [hrUserId, setHr] = useState(settings.hrUserId ?? ""); const [chairUserId, setChair] = useState(settings.chairUserId ?? ""); const [accountantUserId, setAccountant] = useState(settings.accountantUserId ?? "");
  const picker = (label: string, value: string, setValue: (value: string) => void) => <div className="scoped-person-field"><span>{label}</span><PersonPicker label={label} people={people} departments={departments} value={value} onChange={setValue} disabled={busy} emptyLabel="Не назначен" /></div>;
  return <HrEditor label="Маршрут HR" busy={busy} error={error} onClose={onClose}><div><span className="hr-kicker">НАСТРОЙКИ HR</span><h2>Участники маршрута</h2><p>Один и тот же человек может временно выполнять несколько ролей.</p></div><div className="hr-form-grid hr-route-form">{picker("HR", hrUserId, setHr)}{picker("Председатель", chairUserId, setChair)}{picker("Главный бухгалтер", accountantUserId, setAccountant)}</div><footer><Button disabled={busy} onClick={onClose}>Отмена</Button><Button appearance="primary" disabled={busy || !hrUserId || !chairUserId || !accountantUserId} onClick={() => void onSave({ hrUserId, chairUserId, accountantUserId })}>Сохранить маршрут</Button></footer></HrEditor>;
}

/** Preserve drafts while making the existing HR editor a real focus-contained layer. */
function HrEditor({ label, busy, error, onClose, children }: { readonly label: string; readonly busy: boolean; readonly error?: string; readonly onClose: () => void; readonly children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, true, () => { if (!busy) onClose(); });
  return <Portal><div className="hr-editor-scrim" onPointerDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="hr-editor" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
      <div className="hr-editor-topline"><span>HR / Кадровые документы</span><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть кадровую форму" disabled={busy} onClick={onClose} /></div>
      <div className="hr-editor-body">{error ? <WorkspaceNotice tone="error" className="hr-alert hr-error" role="alert">{error}</WorkspaceNotice> : null}{children}</div>
    </div>
  </div></Portal>;
}
