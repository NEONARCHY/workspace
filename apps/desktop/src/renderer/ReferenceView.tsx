import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, DialogSurface } from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise20Regular, Document20Regular, Edit20Regular } from "@fluentui/react-icons";
import type {
  ReferenceDirectory, ReferenceExpert, ReferenceExpertFields, ReferencePartner,
  ReferencePartnerFields, ReferenceProfileFields, ReferenceTemplate,
  ReferenceTemplateFields, ReferenceTemplateVersion, WorkspacePerson,
} from "@yuksalish/contracts";
import { WorkspaceDialog } from "./WorkspaceDialog";
import { WorkspaceNotice } from "./WorkspaceNotice";
import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { ExternalFileViewer, type FileViewerSource } from "./FileViewer";
import {
  createReferenceExpert, createReferencePartner, createReferenceTemplate,
  downloadReferenceTemplate, loadReferenceDirectory, previewReferenceTemplate,
  saveReferenceExpert, saveReferencePartner, saveReferenceProfile,
  saveReferenceTemplate, uploadReferenceTemplate,
} from "./workspace-api";
import "./reference-view.css";

interface Props {
  readonly token: string;
  readonly canCreate: boolean;
  readonly canEdit: boolean;
  readonly people: readonly WorkspacePerson[];
}

type Tab = "profile" | "partners" | "experts" | "templates";
type Editor =
  | { readonly kind: "profile" }
  | { readonly kind: "partner"; readonly original?: ReferencePartner }
  | { readonly kind: "expert"; readonly original?: ReferenceExpert }
  | { readonly kind: "template"; readonly original?: ReferenceTemplate };
type Preview = { readonly template: ReferenceTemplate; readonly version: ReferenceTemplateVersion };

const tabs: readonly { key: Tab; label: string }[] = [
  { key: "profile", label: "Юксалиш" },
  { key: "partners", label: "Организации" },
  { key: "experts", label: "Эксперты" },
  { key: "templates", label: "Шаблоны" },
];
const profileFields: readonly { key: keyof ReferenceProfileFields; label: string }[] = [
  { key: "legalName", label: "Официальное название" },
  { key: "shortName", label: "Краткое название" },
  { key: "tin", label: "ИНН" },
  { key: "registeredAddress", label: "Юридический адрес" },
  { key: "postalAddress", label: "Почтовый адрес" },
  { key: "bankName", label: "Банк" },
  { key: "bankCode", label: "Код банка" },
  { key: "bankAccount", label: "Расчётный счёт" },
  { key: "phone", label: "Телефон" },
  { key: "email", label: "Электронная почта" },
  { key: "website", label: "Сайт" },
];
const emptyPartner: ReferencePartnerFields = {
  name: "", kind: "partner", tin: "", address: "", contactPerson: "",
  phone: "", email: "", website: "", notes: "",
};
const emptyExpert: ReferenceExpertFields = {
  name: "", specialization: "", partnerId: null, phone: "", email: "", notes: "",
};
const emptyTemplate: ReferenceTemplateFields = {
  title: "", kind: "project", locale: "ru", description: "",
};
const partnerKinds = {
  partner: "Партнёр", donor: "Донор", government: "Госорган",
  contractor: "Подрядчик", other: "Другая организация",
} as const;
const templateKinds = {
  project: "Проект", grant: "Грант", budget: "Бюджет",
  letter: "Письмо", other: "Другое",
} as const;
const locales = { ru: "Русский", uz_cyrl: "Ўзбекча", uz_latn: "O‘zbekcha" } as const;
const changeLabels: Readonly<Record<string, string>> = {
  "reference.profile.updated": "Изменены реквизиты",
  "reference.partner.created": "Добавлена организация",
  "reference.partner.updated": "Изменена организация",
  "reference.expert.created": "Добавлен эксперт",
  "reference.expert.updated": "Изменён эксперт",
  "reference.template.created": "Создана карточка шаблона",
  "reference.template.updated": "Изменён шаблон",
  "reference.template.file_uploaded": "Загружена версия шаблона",
};

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить действие. Попробуйте снова.";
}

function ReferenceField({ label, value, onChange, required = false, multiline = false }: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly required?: boolean;
  readonly multiline?: boolean;
}) {
  return <label className="reference-field"><span>{label}{required ? " *" : ""}</span>
    {multiline
      ? <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} required={required} />
      : <input value={value} onChange={(event) => onChange(event.target.value)} required={required} />}
  </label>;
}

export function ReferenceView({ token, canCreate, canEdit, people }: Props) {
  const [tab, setTab] = useState<Tab>("profile");
  const [directory, setDirectory] = useState<ReferenceDirectory>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [editor, setEditor] = useState<Editor>();
  const [profileDraft, setProfileDraft] = useState<ReferenceProfileFields>();
  const [partnerDraft, setPartnerDraft] = useState<ReferencePartnerFields>(emptyPartner);
  const [expertDraft, setExpertDraft] = useState<ReferenceExpertFields>(emptyExpert);
  const [templateDraft, setTemplateDraft] = useState<ReferenceTemplateFields>(emptyTemplate);
  const [archivedDraft, setArchivedDraft] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [uploadTarget, setUploadTarget] = useState<ReferenceTemplate>();
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setLoadError("");
    try { setDirectory(await loadReferenceDirectory(token)); }
    catch (error) { setLoadError(readableError(error)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => {
    let active = true;
    void loadReferenceDirectory(token).then((data) => {
      if (active) { setDirectory(data); setLoading(false); }
    }).catch((error: unknown) => {
      if (active) { setLoadError(readableError(error)); setLoading(false); }
    });
    return () => { active = false; };
  }, [token]);

  const openProfile = () => {
    if (!directory) return;
    setProfileDraft(directory.profile); setActionError(""); setEditor({ kind: "profile" });
  };
  const openPartner = (original?: ReferencePartner) => {
    setPartnerDraft(original ?? emptyPartner); setArchivedDraft(original?.archived ?? false);
    setActionError(""); setEditor({ kind: "partner", original });
  };
  const openExpert = (original?: ReferenceExpert) => {
    setExpertDraft(original ?? emptyExpert); setArchivedDraft(original?.archived ?? false);
    setActionError(""); setEditor({ kind: "expert", original });
  };
  const openTemplate = (original?: ReferenceTemplate) => {
    setTemplateDraft(original ?? emptyTemplate); setArchivedDraft(original?.archived ?? false);
    setActionError(""); setEditor({ kind: "template", original });
  };

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || !directory || busy) return;
    setBusy(true); setActionError("");
    try {
      if (editor.kind === "profile" && profileDraft) {
        await saveReferenceProfile(token, profileDraft, directory.profile.revision);
      } else if (editor.kind === "partner") {
        if (editor.original) await saveReferencePartner(token, editor.original.id, partnerDraft, editor.original.revision, archivedDraft);
        else await createReferencePartner(token, partnerDraft);
      } else if (editor.kind === "expert") {
        if (editor.original) await saveReferenceExpert(token, editor.original.id, expertDraft, editor.original.revision, archivedDraft);
        else await createReferenceExpert(token, expertDraft);
      } else if (editor.kind === "template") {
        if (editor.original) await saveReferenceTemplate(token, editor.original.id, templateDraft, editor.original.revision, archivedDraft);
        else await createReferenceTemplate(token, templateDraft);
      }
      setEditor(undefined);
      await refresh();
    } catch (error) { setActionError(readableError(error)); }
    finally { setBusy(false); }
  }

  async function upload(file: File) {
    if (!uploadTarget || busy) return;
    setBusy(true); setActionError("");
    try {
      await uploadReferenceTemplate(token, uploadTarget.id, uploadTarget.revision, file);
      setUploadTarget(undefined);
      await refresh();
    } catch (error) { setActionError(readableError(error)); }
    finally { setBusy(false); }
  }

  async function download(template: ReferenceTemplate, version: ReferenceTemplateVersion) {
    setActionError("");
    try {
      const blob = await downloadReferenceTemplate(token, template.id, version.id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = version.fileName; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { setActionError(readableError(error)); }
  }

  const match = (parts: readonly (string | null | undefined)[]) =>
    parts.join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const partners = directory?.partners.filter((item) => (showArchived || !item.archived)
    && match([item.name, item.tin, item.contactPerson, item.kind])) ?? [];
  const experts = directory?.experts.filter((item) => (showArchived || !item.archived)
    && match([item.name, item.specialization, item.email])) ?? [];
  const templates = directory?.templates.filter((item) => (showArchived || !item.archived)
    && (canEdit || item.versions.length > 0)
    && match([item.title, item.description, item.kind])) ?? [];
  const editorTitle = editor?.kind === "profile" ? "Реквизиты «Юксалиш»"
    : editor?.kind === "partner" ? `${editor.original ? "Изменить" : "Добавить"} организацию`
      : editor?.kind === "expert" ? `${editor.original ? "Изменить" : "Добавить"} эксперта`
        : `${editor?.original ? "Изменить" : "Добавить"} шаблон`;
  const previewSource: FileViewerSource | undefined = preview ? {
    id: preview.version.id, fileName: preview.version.fileName,
    contentType: preview.version.contentType, byteSize: preview.version.byteSize,
  } : undefined;

  return <section className="workspace-view reference-view" aria-label="Справочник">
    <WorkspaceSectionHeader motif="employees" className="reference-header">
      <div><span className="view-kicker">Проверенные сведения · документы · контакты</span>
        <h1>Справочник</h1>
        <p>Реквизиты «Юксалиш», организации, эксперты и рабочие шаблоны в одном месте.</p></div>
      <Button icon={<ArrowClockwise20Regular />} onClick={() => void refresh()} disabled={loading || busy}>Обновить</Button>
    </WorkspaceSectionHeader>

    <nav className="reference-tabs" aria-label="Разделы справочника">
      {tabs.map((item) => <button key={item.key} type="button" aria-current={tab === item.key ? "page" : undefined}
        className={tab === item.key ? "active" : ""} onClick={() => { setTab(item.key); setQuery(""); setActionError(""); }}>
        {item.label}
      </button>)}
    </nav>
    {loadError ? <WorkspaceNotice tone="error" role="alert">{loadError} <Button onClick={() => void refresh()}>Повторить</Button></WorkspaceNotice> : null}
    {actionError && !editor ? <WorkspaceNotice tone="error" role="alert">{actionError}</WorkspaceNotice> : null}
    {loading && !directory ? <p className="reference-empty">Загружаем справочник…</p> : null}
    {directory ? <div className="reference-content">
      {tab === "profile" ? <section className="reference-profile" aria-label="Реквизиты организации">
        <div className="reference-section-title"><div><span className="view-kicker">Единственная карточка нашей организации</span>
          <h2>«Юксалиш»</h2><p>Точные юридические данные заполняются ответственным сотрудником.</p></div>
          {canEdit ? <Button icon={<Edit20Regular />} onClick={openProfile}>Изменить</Button> : null}</div>
        <dl className="reference-profile-grid">{profileFields.map(({ key, label }) =>
          <div key={key}><dt>{label}</dt><dd>{directory.profile[key] || <span className="reference-muted">Не заполнено</span>}</dd></div>)}</dl>
        {directory.profile.updatedAt ? <p className="reference-footnote">Обновлено {new Date(directory.profile.updatedAt).toLocaleString("ru-RU")}</p> : null}
        {directory.changes.length ? <details className="reference-history"><summary>История изменений</summary>
          <ol>{directory.changes.map((change, index) => <li key={`${change.targetId}:${change.createdAt}:${index}`}>
            <span>{changeLabels[change.action] ?? "Изменение справочника"}</span>
            <small>{people.find((person) => person.id === change.actorUserId)?.name ?? "Сотрудник"} · {new Date(change.createdAt).toLocaleString("ru-RU")}</small>
          </li>)}</ol></details> : null}
      </section> : <>
        <div className="reference-toolbar"><div><h2>{tabs.find((item) => item.key === tab)?.label}</h2>
          <p>{tab === "partners" ? "Партнёры, доноры и контрагенты без повторяющихся карточек."
            : tab === "experts" ? "Люди, специализация и связанная организация."
              : "Утверждённые образцы документов с сохранением прежних версий."}</p></div>
          <div className="reference-toolbar-actions">
            <label className="reference-search"><span className="sr-only">Поиск по справочнику</span>
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" /></label>
            <label className="reference-archive-toggle"><input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Архив</label>
            {canCreate && (tab !== "templates" || canEdit) ? <Button appearance="primary" icon={<Add20Regular />} onClick={() => {
              if (tab === "partners") openPartner(); else if (tab === "experts") openExpert(); else openTemplate();
            }}>Добавить</Button> : null}
          </div></div>
        <div className="reference-records">
          {tab === "partners" && (partners.length ? partners.map((item) => <article className="reference-record" key={item.id}>
            <span className="reference-record-kind">{partnerKinds[item.kind]}{item.archived ? " · архив" : ""}</span>
            <h3>{item.name}</h3><p>{item.tin ? `ИНН ${item.tin}` : "ИНН не указан"}</p>
            {item.contactPerson ? <p>{item.contactPerson}</p> : null}
            {item.phone || item.email ? <p>{[item.phone, item.email].filter(Boolean).join(" · ")}</p> : null}
            {item.address ? <p>{item.address}</p> : null}
            {item.notes ? <p className="reference-note">{item.notes}</p> : null}
            {canEdit ? <Button icon={<Edit20Regular />} onClick={() => openPartner(item)}>Изменить</Button> : null}
          </article>) : <p className="reference-empty">Организаций по этому запросу нет.</p>)}
          {tab === "experts" && (experts.length ? experts.map((item) => <article className="reference-record" key={item.id}>
            <span className="reference-record-kind">Эксперт{item.archived ? " · архив" : ""}</span>
            <h3>{item.name}</h3><p>{item.specialization}</p>
            {item.partnerId ? <p>{directory.partners.find((partner) => partner.id === item.partnerId)?.name ?? "Организация в архиве"}</p> : null}
            {item.phone || item.email ? <p>{[item.phone, item.email].filter(Boolean).join(" · ")}</p> : null}
            {item.notes ? <p className="reference-note">{item.notes}</p> : null}
            {canEdit ? <Button icon={<Edit20Regular />} onClick={() => openExpert(item)}>Изменить</Button> : null}
          </article>) : <p className="reference-empty">Экспертов по этому запросу нет.</p>)}
          {tab === "templates" && (templates.length ? templates.map((item) => <article className="reference-record reference-template" key={item.id}>
            <span className="reference-record-kind">{templateKinds[item.kind]} · {locales[item.locale]}{item.archived ? " · архив" : ""}</span>
            <h3>{item.title}</h3>{item.description ? <p>{item.description}</p> : null}
            <div className="reference-template-versions">{item.versions.length ? item.versions.map((version) =>
              <div key={version.id}><Document20Regular aria-hidden="true" /><span>Версия {version.version} · {version.fileName}</span>
                <Button onClick={() => setPreview({ template: item, version })}>Посмотреть</Button>
                <Button onClick={() => void download(item, version)}>Скачать</Button></div>)
              : <p className="reference-muted">Файл ещё не загружен. Карточка не видна сотрудникам без права редактирования.</p>}</div>
            {canEdit ? <div className="reference-record-actions"><Button icon={<Edit20Regular />} onClick={() => openTemplate(item)}>Изменить</Button>
              {!item.archived ? <Button onClick={() => { setUploadTarget(item); fileInput.current?.click(); }} disabled={busy}>Загрузить новую версию</Button> : null}</div> : null}
          </article>) : <p className="reference-empty">Шаблонов по этому запросу нет.</p>)}
        </div>
      </>}
    </div> : null}
    <input ref={fileInput} type="file" className="reference-hidden-file" accept=".pdf,.docx,.xlsx" aria-label="Файл шаблона"
      onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />

    <WorkspaceDialog open={Boolean(editor)} modalType="modal" onOpenChange={(_, data) => { if (!data.open && !busy) setEditor(undefined); }}>
      <DialogSurface className="reference-dialog" aria-label={editorTitle}>
        <div className="reference-dialog-head"><h2 id="reference-dialog-title">{editorTitle}</h2>
          <Button appearance="subtle" onClick={() => setEditor(undefined)} disabled={busy}>Закрыть</Button></div>
        <form onSubmit={(event) => void save(event)}>
          <div className="reference-dialog-fields">
            {editor?.kind === "profile" && profileDraft ? profileFields.map(({ key, label }) =>
              <ReferenceField key={key} label={label} value={profileDraft[key]}
                multiline={key === "registeredAddress" || key === "postalAddress"}
                onChange={(value) => setProfileDraft((current) => current ? { ...current, [key]: value } : current)} />) : null}
            {editor?.kind === "partner" ? <>
              <ReferenceField label="Название" required value={partnerDraft.name} onChange={(name) => setPartnerDraft({ ...partnerDraft, name })} />
              <label className="reference-field"><span>Тип организации</span><select value={partnerDraft.kind}
                onChange={(event) => setPartnerDraft({ ...partnerDraft, kind: event.target.value as ReferencePartnerFields["kind"] })}>
                {Object.entries(partnerKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <ReferenceField label="ИНН" value={partnerDraft.tin} onChange={(tin) => setPartnerDraft({ ...partnerDraft, tin })} />
              <ReferenceField label="Адрес" value={partnerDraft.address} onChange={(address) => setPartnerDraft({ ...partnerDraft, address })} />
              <ReferenceField label="Контактное лицо" value={partnerDraft.contactPerson} onChange={(contactPerson) => setPartnerDraft({ ...partnerDraft, contactPerson })} />
              <ReferenceField label="Телефон" value={partnerDraft.phone} onChange={(phone) => setPartnerDraft({ ...partnerDraft, phone })} />
              <ReferenceField label="Электронная почта" value={partnerDraft.email} onChange={(email) => setPartnerDraft({ ...partnerDraft, email })} />
              <ReferenceField label="Сайт" value={partnerDraft.website} onChange={(website) => setPartnerDraft({ ...partnerDraft, website })} />
              <ReferenceField label="Примечание" multiline value={partnerDraft.notes} onChange={(notes) => setPartnerDraft({ ...partnerDraft, notes })} />
            </> : null}
            {editor?.kind === "expert" ? <>
              <ReferenceField label="Имя и фамилия" required value={expertDraft.name} onChange={(name) => setExpertDraft({ ...expertDraft, name })} />
              <ReferenceField label="Специализация" required value={expertDraft.specialization} onChange={(specialization) => setExpertDraft({ ...expertDraft, specialization })} />
              <label className="reference-field"><span>Организация</span><select value={expertDraft.partnerId ?? ""}
                onChange={(event) => setExpertDraft({ ...expertDraft, partnerId: event.target.value || null })}>
                <option value="">Не выбрана</option>{directory?.partners.filter((item) => !item.archived || item.id === expertDraft.partnerId).map((item) =>
                  <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <ReferenceField label="Телефон" value={expertDraft.phone} onChange={(phone) => setExpertDraft({ ...expertDraft, phone })} />
              <ReferenceField label="Электронная почта" value={expertDraft.email} onChange={(email) => setExpertDraft({ ...expertDraft, email })} />
              <ReferenceField label="Примечание" multiline value={expertDraft.notes} onChange={(notes) => setExpertDraft({ ...expertDraft, notes })} />
            </> : null}
            {editor?.kind === "template" ? <>
              <ReferenceField label="Название шаблона" required value={templateDraft.title} onChange={(title) => setTemplateDraft({ ...templateDraft, title })} />
              <label className="reference-field"><span>Назначение</span><select value={templateDraft.kind}
                onChange={(event) => setTemplateDraft({ ...templateDraft, kind: event.target.value as ReferenceTemplateFields["kind"] })}>
                {Object.entries(templateKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="reference-field"><span>Язык</span><select value={templateDraft.locale}
                onChange={(event) => setTemplateDraft({ ...templateDraft, locale: event.target.value as ReferenceTemplateFields["locale"] })}>
                {Object.entries(locales).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <ReferenceField label="Описание и правила применения" multiline value={templateDraft.description}
                onChange={(description) => setTemplateDraft({ ...templateDraft, description })} />
              {!editor.original ? <p className="reference-muted">После создания карточки загрузите первую версию PDF, DOCX или XLSX.</p> : null}
            </> : null}
            {editor && editor.kind !== "profile" && editor.original ? <label className="reference-archive-toggle">
              <input type="checkbox" checked={archivedDraft} onChange={(event) => setArchivedDraft(event.target.checked)} />
              В архиве (не показывать в обычном списке)</label> : null}
          </div>
          {actionError ? <WorkspaceNotice tone="error" role="alert">{actionError}</WorkspaceNotice> : null}
          <div className="reference-dialog-actions"><Button type="button" onClick={() => setEditor(undefined)} disabled={busy}>Отмена</Button>
            <Button type="submit" appearance="primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить"}</Button></div>
        </form>
      </DialogSurface>
    </WorkspaceDialog>

    {preview && previewSource ? <ExternalFileViewer attachment={previewSource} onClose={() => setPreview(undefined)}
      onLoad={() => downloadReferenceTemplate(token, preview.template.id, preview.version.id)}
      onLoadOffice={(_, sheet, offset, signal) => previewReferenceTemplate(token, preview.template.id, preview.version.id, sheet, offset, signal)}
      onDownload={() => download(preview.template, preview.version)} /> : null}
  </section>;
}
