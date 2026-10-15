import { WorkspaceSectionHeader } from "./WorkspaceSectionHeader";
import { lazy, Suspense, useCallback, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SpatialBoard, SpatialCard, SpatialLane } from "./SpatialBoard";
import { useMiddleMousePan } from "./useMiddleMousePan";
import { ProcessWorkflowDesigner } from "./ProcessWorkflowDesigner";
import { DecisionReason } from "./DecisionReason";
import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { ChatIconPicker } from "./ChatAvatar";
import type { ChatAvatarIconKey } from "@yuksalish/contracts";
import { currentTripWorkflow, tripColumns, tripDropAction } from "./trip-board";
import type { AssistantActionDraft, OfficeFilePreview, TripAction, TripRequest, TripRequestInput, TripStage, WorkflowDefinition, WorkflowPosition, WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { Avatar, Badge, Button, Checkbox, DialogSurface, DialogTitle, Textarea, useRestoreFocusTarget } from "@fluentui/react-components";
import { Input } from "./WorkspaceInput";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { workflowStageColor } from "./workflow-stage-colors";
import { Add24Regular, Chat24Regular, Dismiss20Regular, Edit24Regular, Search20Regular } from "@fluentui/react-icons";
import { EmployeeProfileLink } from "./EmployeeProfileLink";
import { WorkspaceDateTimePicker } from "./WorkspaceDateTimePicker";
import { EmployeeScopeSwitch } from "./EmployeeScopeSwitch";
import { SlidingSegmented } from "./SlidingSegmented";
import { employeeScope, type EmployeeScope } from "./employee-scope";
import { assistantPeopleIds } from "./assistant-form-handoff";
import { TripSignaturePad } from "./TripSignaturePad";
import { WorkspaceFileDropzone } from "./WorkspaceFileDropzone";
import type { FileViewerSource } from "./FileViewer";

const ExternalFileViewer = lazy(() => import("./FileViewer").then(module => ({ default: module.ExternalFileViewer })));

const actionLabels: Readonly<Record<TripAction, string>> = {
  submit: "Отправить первому заместителю", resubmit: "Отправить повторно", approve: "Согласовать",
  return: "Вернуть на доработку", reject: "Отклонить", move: "Перемещено администратором",
  withdraw: "Отозвать заявку", annul: "Аннулировать приказ",
};
const moveLabels: Readonly<Record<TripAction, string>> = {
  submit: "Передать →", resubmit: "Повторно →", approve: "Согласовать →",
  return: "На доработку", reject: "Отклонить", move: "Переместить",
  withdraw: "Отозвать", annul: "Аннулировать",
};
const dateLabel = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
const isFinished = (request: TripRequest) => ["approved", "rejected", "annulled"].includes(request.status);
const needsNewSignature = (request: TripRequest) => (request.workflowVersion ?? 1) >= 2 &&
  (!(request.hasEmployeeSignature || (request.briefAttachmentName && request.originalSignatureConfirmed)) ||
    (!request.briefText && !request.briefAttachmentName));

interface TripApprovalsViewProps {
  readonly assistantDraft?: AssistantActionDraft;
  readonly focusRequestId?: string;
  readonly requests: readonly TripRequest[];
  readonly people: readonly WorkspacePerson[];
  readonly departments?: readonly WorkspaceDepartment[];
  readonly currentUser: WorkspacePerson;
  readonly onCreate: (payload: TripRequestInput) => Promise<TripRequest | undefined>;
  readonly onUpdate: (request: TripRequest, payload: TripRequestInput) => Promise<TripRequest | undefined>;
  readonly onDelete?: (request: TripRequest) => Promise<void>;
  readonly onAction: (request: TripRequest, action: TripAction, comment?: string, targetStage?: TripStage) => Promise<TripRequest | undefined>;
  readonly onUploadBrief?: (requestId: string, file: File) => Promise<TripRequest | undefined>;
  readonly onRemoveBrief?: (requestId: string) => Promise<TripRequest | undefined>;
  readonly onUploadSignature?: (requestId: string, content: Blob) => Promise<TripRequest | undefined>;
  readonly onSetOriginalSignature?: (requestId: string, confirmed: boolean) => Promise<TripRequest | undefined>;
  readonly onLoadBriefOffice?: (requestId: string, sheet: number, offset: number, signal?: AbortSignal) => Promise<OfficeFilePreview>;
  readonly onDownloadDocument?: (requestId: string, kind: "attachment" | "brief" | "order" | "order-preview", signal?: AbortSignal) => Promise<Blob | undefined>;
  readonly onOpenChat?: (chatId: string) => void;
  readonly renderTripChat?: (request: TripRequest) => ReactNode;
  readonly workflow?: WorkflowDefinition;
  readonly positions?: readonly WorkflowPosition[];
  readonly canManageWorkflow?: boolean;
  readonly onSaveWorkflow?: (workflow: WorkflowDefinition) => Promise<void> | void;
  readonly onPublishWorkflow?: (workflow: WorkflowDefinition) => Promise<WorkflowDefinition | undefined> | WorkflowDefinition | undefined;
}
interface TripFormState {
  chatIconKey?: ChatAvatarIconKey;
  purpose: string; destination: string; startDate: string; endDate: string;
  employeeIds: readonly string[]; briefText: string; expenseSource: string;
}
function emptyForm(currentUserId: string): TripFormState {
  const today = new Date().toISOString().slice(0, 10);
  return { purpose: "", destination: "", startDate: today, endDate: today,
    employeeIds: [currentUserId], briefText: "", expenseSource: "" };
}

export function TripApprovalsView({ focusRequestId, requests, people, departments, currentUser, onCreate, onUpdate, onDelete, onAction, onUploadBrief, onRemoveBrief, onUploadSignature, onSetOriginalSignature, onLoadBriefOffice, onDownloadDocument, onOpenChat, renderTripChat, workflow, positions = [], canManageWorkflow = false, onSaveWorkflow, onPublishWorkflow, assistantDraft }: TripApprovalsViewProps) {
  const boardPan = useMiddleMousePan<HTMLDivElement>();
  const restoreFocusTarget = useRestoreFocusTarget();
  const [selectedId, setSelectedId] = useState(focusRequestId ?? "");
  const [detailOpen, setDetailOpen] = useState(Boolean(focusRequestId));
  const [pendingDecision, setPendingDecision] = useState<{ id: string; action: "return" | "reject" | "withdraw" | "annul" }>();
  const [confirmDeleteId, setConfirmDeleteId] = useState("");
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(
    assistantDraft?.kind === "trip" ? "create" : null,
  );
  const [formOpen, setFormOpen] = useState(assistantDraft?.kind === "trip");
  const [form, setForm] = useState<TripFormState>(() =>
    assistantDraft?.kind === "trip" ? {
      purpose: "",
      destination: assistantDraft.fields.destination ?? "",
      startDate: (assistantDraft.fields.startDate ?? "").slice(0, 10),
      endDate: (assistantDraft.fields.endDate ?? "").slice(0, 10),
      employeeIds: assistantDraft.fields.employees?.trim()
        ? assistantPeopleIds(assistantDraft.fields, "employees", people, currentUser.id) : [currentUser.id],
      briefText: "", expenseSource: "",
    } : emptyForm(currentUser.id));
  const [employeeListScope, setEmployeeListScope] = useState<EmployeeScope>("central");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [section, setSection] = useState<"requests" | "designer">("requests");
  const [filter, setFilter] = useState<"running" | "approved" | "all" | "finished">("running");
  const [query, setQuery] = useState("");
  const [employeeQuery, setEmployeeQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const briefFileRef = useRef<HTMLInputElement>(null);
  const pendingCreatedRef = useRef<TripRequest | undefined>(undefined);
  const [briefFile, setBriefFile] = useState<File>();
  const [documentPreview, setDocumentPreview] = useState<FileViewerSource & {
    updatedAt: string; kind: "attachment" | "brief" | "order" | "order-preview";
  }>();
  const [previewedBriefVersion, setPreviewedBriefVersion] = useState("");
  const [error, setError] = useState("");
  const selected = requests.find((request) => request.id === selectedId);
  const canChooseOthers = ["manager", "admin", "superadmin"].includes(currentUser.role);
  const isAdministrator = ["admin", "superadmin"].includes(currentUser.role);
  const workflowTripNodes = workflow?.nodes
    .filter((node) => tripColumns.some((column) => column.key === node.id))
    .sort((left, right) => left.positionX - right.positionX);
  const allTripColumns = workflowTripNodes?.length === tripColumns.length
    ? workflowTripNodes.map((node) => ({
        ...tripColumns.find((column) => column.key === node.id)!,
        label: node.label,
        color: workflowStageColor(
          node.config.stageColor,
          tripColumns.find((column) => column.key === node.id)!.color,
        ),
      }))
    : tripColumns;
  const displayTripColumns = allTripColumns.filter((column) => column.key !== "hr");
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const personLink = (id: string, children: ReactNode, className?: string) => <EmployeeProfileLink userId={people.some((person) => person.id === id) ? id : undefined} personName={personName(id)} className={className}>{children}</EmployeeProfileLink>;
  const runningCount = requests.filter((request) => !isFinished(request)).length;
  const finishedCount = requests.length - runningCount;
  const actionableCount = requests.filter((request) => request.allowedActions.some(
    (action) => !["withdraw", "annul"].includes(action),
  )).length;
  const revisionCount = requests.filter((request) => request.status === "needs_revision").length;
  const filterCounts = { running: runningCount, approved: requests.filter((request) => request.status === "approved").length, all: requests.length, finished: finishedCount };
  const visibleRequests = requests.filter((request) => {
    if (filter === "running" && isFinished(request)) return false;
    if (filter === "approved" && request.status !== "approved") return false;
    if (filter === "finished" && !isFinished(request)) return false;
    return [request.number, request.purpose, request.destination, request.stageLabel, ...request.employeeIds.map(personName)]
      .join(" ").toLocaleLowerCase("ru-RU").includes(query.trim().toLocaleLowerCase("ru-RU"));
  });

  const openRequest = (id: string) => { pendingCreatedRef.current = undefined; setBriefFile(undefined); setDocumentPreview(undefined); setPreviewedBriefVersion(""); setFormOpen(false); setFormMode(null); setSelectedId(id); setDetailOpen(true); setPendingDecision(undefined); setConfirmDeleteId(""); setError(""); };
  const closeDetail = () => { if (!busyRef.current) { setDetailOpen(false); setPendingDecision(undefined); setConfirmDeleteId(""); setError(""); } };
  const closeForm = () => { if (!busyRef.current) { if (pendingCreatedRef.current) { setSelectedId(pendingCreatedRef.current.id); setDetailOpen(true); } pendingCreatedRef.current = undefined; setBriefFile(undefined); setFormOpen(false); setFormMode(null); setError(""); } };
  const create = () => { pendingCreatedRef.current = undefined; setBriefFile(undefined); setDetailOpen(false); setForm(emptyForm(currentUser.id)); setEmployeeQuery(""); setFormMode("create"); setFormOpen(true); setError(""); };

  const chooseBriefFile = (file?: File) => {
    if (!file) return;
    if (!file.size || file.size > 10 * 1024 * 1024 || !/\.(pdf|docx|jpe?g|png)$/i.test(file.name)) {
      setBriefFile(undefined);
      setError("Выберите PDF, DOCX, JPG или PNG размером до 10 МиБ.");
      return;
    }
    setBriefFile(file);
    setError("");
  };

  const save = async () => {
    if (busyRef.current) return;
    if (!form.destination.trim() || !form.startDate || !form.endDate || !form.employeeIds.length) {
      setError("Укажите место, даты и хотя бы одного участника поездки."); return;
    }
    if (form.endDate < form.startDate) { setError("Дата окончания не может быть раньше даты начала."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const payload: TripRequestInput = { ...form, purpose: form.purpose.trim(), destination: form.destination.trim() };
      const existing = formMode === "edit" ? selected : pendingCreatedRef.current;
      const saved = existing ? await onUpdate(existing, payload) : await onCreate(payload);
      if (!saved) { setError("Не удалось сохранить поездку. Проверьте данные и подключение к серверу."); return; }
      if (formMode === "create") pendingCreatedRef.current = saved;
      setSelectedId(saved.id);
      if (briefFile) {
        const uploaded = await onUploadBrief?.(saved.id, briefFile);
        if (!uploaded) {
          setError("Черновик сохранён, но билдирги не загрузилась. Проверьте файл или подключение и повторите сохранение — новая поездка не создастся.");
          return;
        }
      }
      pendingCreatedRef.current = undefined;
      setBriefFile(undefined);
      setPreviewedBriefVersion("");
      setFormOpen(false);
      setDetailOpen(true);
      setFormMode(null);
    } catch { setError("Не удалось сохранить поездку. Попробуйте ещё раз."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const changeBrief = async (request: TripRequest, file?: File, remove = false) => {
    if (busyRef.current || (!remove && !file)) return;
    if (file && (!file.size || file.size > 10 * 1024 * 1024)) {
      setError("Файл билдирги должен быть не больше 10 МиБ."); return;
    }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const updated = remove
        ? await onRemoveBrief?.(request.id)
        : file ? await onUploadBrief?.(request.id, file) : undefined;
      if (!updated) setError("Не удалось сохранить документ. Проверьте формат файла и подключение.");
      else { setDocumentPreview(undefined); setPreviewedBriefVersion(""); }
    } catch { setError("Не удалось сохранить документ. Попробуйте ещё раз."); }
    finally { busyRef.current = false; setBusy(false); if (briefFileRef.current) briefFileRef.current.value = ""; }
  };
  const saveSignature = async (request: TripRequest, content: Blob): Promise<boolean> => {
    if (busyRef.current || !onUploadSignature) return false;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const updated = await onUploadSignature(request.id, content);
      if (!updated) { setError("Не удалось сохранить подпись. Проверьте формат PNG."); return false; }
      return true;
    } catch { setError("Не удалось сохранить подпись. Попробуйте ещё раз."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const confirmOriginalSignature = async (request: TripRequest, confirmed: boolean) => {
    if (busyRef.current || !onSetOriginalSignature) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const updated = await onSetOriginalSignature(request.id, confirmed);
      if (!updated) setError("Не удалось сохранить подтверждение подписи. Повторите попытку.");
    } catch { setError("Не удалось сохранить подтверждение подписи. Повторите попытку."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const loadDocumentPreview = useCallback(async (file: FileViewerSource, signal?: AbortSignal) => {
    const content = await onDownloadDocument?.(file.id, documentPreview?.kind ?? "attachment", signal);
    if (!content) throw new Error("Не удалось открыть документ поездки");
    if (!signal?.aborted && documentPreview?.kind === "attachment") setPreviewedBriefVersion(`${file.id}:${documentPreview.updatedAt}`);
    return content;
  }, [onDownloadDocument, documentPreview]);
  const loadBriefOffice = useCallback(async (file: FileViewerSource, sheet: number, offset: number, signal?: AbortSignal) => {
    if (!onLoadBriefOffice) throw new Error("Предпросмотр DOCX недоступен");
    const content = await onLoadBriefOffice(file.id, sheet, offset, signal);
    if (!signal?.aborted && documentPreview?.kind === "attachment") setPreviewedBriefVersion(`${file.id}:${documentPreview.updatedAt}`);
    return content;
  }, [onLoadBriefOffice, documentPreview]);
  const openDocument = (request: TripRequest, kind: "attachment" | "brief" | "order" | "order-preview") => {
    const original = kind === "attachment" || (kind === "brief" && request.originalSignatureConfirmed);
    setDocumentPreview({
      id: request.id, kind, updatedAt: request.updatedAt,
      fileName: original ? request.briefAttachmentName ?? "bildirgi" : kind === "brief" ? "bildirgi-signed.pdf"
        : kind === "order" ? `prikaz-${request.orderNumber ?? request.number}.pdf` : "prikaz-preview.pdf",
      contentType: original ? request.briefAttachmentType ?? "" : "application/pdf",
      byteSize: original ? request.briefAttachmentSize ?? 0 : 0,
    });
  };
  const downloadDocument = async (
    request: TripRequest, kind: "attachment" | "brief" | "order" | "order-preview",
  ) => {
    if (!onDownloadDocument || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const content = await onDownloadDocument(request.id, kind);
      if (!content) { setError("Документ не удалось открыть. Повторите попытку."); return; }
      const url = URL.createObjectURL(content);
      const link = document.createElement("a");
      link.href = url;
      link.download = kind === "attachment" ? request.briefAttachmentName ?? "bildirgi"
        : kind === "brief" ? request.originalSignatureConfirmed ? request.briefAttachmentName ?? "bildirgi" : "bildirgi-signed.pdf"
          : kind === "order" ? `prikaz-${request.orderNumber ?? request.number}.pdf`
            : "prikaz-preview.pdf";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Не удалось скачать документ. Попробуйте ещё раз."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const commitAction = async (request: TripRequest, action: TripAction, comment?: string, targetStage?: TripStage) => {
    if (busyRef.current || (action === "move" ? !isAdministrator || !targetStage : !request.allowedActions.includes(action))) return false;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const updated = action === "move"
        ? await onAction(request, action, comment, targetStage)
        : await onAction(request, action, comment);
      if (!updated) { setError("Не удалось изменить стадию. Проверьте подключение и актуальные права на заявку."); return false; }
      if (updated.status === "approved") setFilter("approved");
      if (updated.status === "annulled") setFilter("finished");
      return true;
    } catch { setError("Не удалось изменить стадию. Карточка остаётся на прежнем месте."); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const act = async (request: TripRequest, action: TripAction) => {
    if (busyRef.current || !request.allowedActions.includes(action)) return;
    if (action === "return" || action === "reject" || action === "withdraw" || action === "annul") {
      openRequest(request.id); setPendingDecision({ id: request.id, action }); return;
    }
    await commitAction(request, action);
  };
  const deleteRequest = async (request: TripRequest) => {
    if (busyRef.current || !request.canDelete || !onDelete) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await onDelete(request);
      setConfirmDeleteId(""); setSelectedId(""); setDetailOpen(false);
    } catch { setError("Не удалось удалить заявку. Проверьте подключение и её текущий статус."); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const feedback = error ? <p className="trip-feedback error" role="alert">{error}</p> : null;

  return (
    <section className="workspace-view bp7-view trips-view trip-view workflow-process-view" aria-label="Согласование поездок">
      <WorkspaceSectionHeader motif="trips" className="bp7-header workflow-hero-header">
        <div><span className="view-kicker">Согласования · Командировки</span><h1>Согласование поездок</h1><p>Перетащите карточку на доступную стадию или откройте её для решения.</p>{canManageWorkflow && workflow ? <SlidingSegmented className="process-view-tabs" role="group" aria-label="Разделы поездок"><button type="button" className={section === "requests" ? "active" : ""} aria-pressed={section === "requests"} onClick={() => setSection("requests")}>Текущие поездки</button><button type="button" className={section === "designer" ? "active" : ""} aria-pressed={section === "designer"} onClick={() => setSection("designer")}>Конструктор маршрутов</button></SlidingSegmented> : null}</div>
        <Button {...restoreFocusTarget} className="ws-section-header-primary" appearance="primary" icon={<Add24Regular />} onClick={create}>Новая командировка</Button>
      </WorkspaceSectionHeader>

      {section === "designer" && workflow && onSaveWorkflow && onPublishWorkflow ? <><p className="trip-document-reminder">Для этапа «Согласование первого заместителя» выберите должность или конкретного сотрудника, затем сохраните и опубликуйте маршрут. Новые отправки закрепляют выбранного согласующего; уже отправленные заявки сохраняют прежнее назначение. Председатель и подпись приказа по-прежнему определяются настройками HR.</p><ProcessWorkflowDesigner workflow={currentTripWorkflow(workflow, positions)} processName="Маршрут поездок" accent="trip" people={people} departments={departments} positions={positions} onSave={onSaveWorkflow} onPublish={onPublishWorkflow} /></> : <>
      <section className="ws2-process-overview trip-overview" aria-label="Сводка по командировкам">
        <button type="button" className="ws2-process-focus" onClick={() => setFilter("running")}>
          <strong>{actionableCount}</strong>
          <span>Ожидают действий</span>
        </button>
        <div className="ws2-process-metrics">
          <div><strong>{runningCount}</strong><span>в работе</span></div>
          <div className={revisionCount ? "attention" : ""}><strong>{revisionCount}</strong><span>на доработке</span></div>
          <div><strong>{finishedCount}</strong><span>завершено</span></div>
        </div>
      </section>

      <div className="trip-commandbar ws2-process-toolbar">
        <SlidingSegmented className="ws2-segmented" role="group" aria-label="Вид поездок">
          <button type="button" className={view === "kanban" ? "active" : ""} aria-pressed={view === "kanban"} onClick={() => setView("kanban")}>Канбан</button>
          <button type="button" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>Список</button>
        </SlidingSegmented>
        <Input contentBefore={<Search20Regular />} className="trip-search" aria-label="Поиск поездок" placeholder="Цель, город, сотрудник или номер" value={query} onChange={(_, data) => setQuery(data.value)} />
        <SlidingSegmented className="ws2-segmented" role="group" aria-label="Фильтр поездок">
          {([["running", "В работе"], ["approved", "Утверждено"], ["all", "Все"], ["finished", "Завершённые"]] as const).map(([key, label]) => <button type="button" key={key} className={filter === key ? "active" : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}<span className="approval-filter-count">{filterCounts[key]}</span></button>)}
        </SlidingSegmented>
      </div>
      {feedback}
      {view === "kanban" && visibleRequests.some((request) => request.stage === "hr") ? <p className="trip-board-help">Заявка прежнего маршрута на кадровом этапе доступна во вкладке «Список».</p> : null}
      {visibleRequests.length === 0 ? <p className="trip-board-help">{requests.length ? "По выбранным фильтрам поездок нет. Измените поиск или выберите «Все»." : "Поездок пока нет. Создайте первую командировку — она появится в колонке «Запуск»."}</p> : null}
      {view === "kanban" ? (
        <SpatialBoard canDrop={(id, target) => { const request = requests.find(item => item.id === id); const action = request && tripDropAction(request, target as TripStage, isAdministrator); return !busy && !!action && !(request && (action === "submit" || action === "resubmit") && needsNewSignature(request)); }} onMove={async (id, target) => { const request = requests.find(item => item.id === id); const targetStage = target as TripStage; const action = request && tripDropAction(request, targetStage, isAdministrator); if (request && action && !((action === "submit" || action === "resubmit") && needsNewSignature(request))) { if (action === "move") await commitAction(request, action, `Перенос на этап «${displayTripColumns.find((column) => column.key === targetStage)?.label ?? targetStage}»`, targetStage); else await act(request, action); } }}>
        <div className="approval-kanban trip-kanban middle-pan-surface" role="region" tabIndex={0} aria-label="Стадии поездок" aria-busy={busy} {...boardPan}>
          {displayTripColumns.map((column) => {
            const items = visibleRequests.filter((request) => request.stage === column.key);
            return <SpatialLane id={column.key} key={column.key} data-stage-key={column.key} className={`approval-column trip-column `}
              style={{ "--approval-stage-color": column.color, "--approval-stage-ink": "#111111" } as CSSProperties}
              aria-label={`${column.label}: ${items.length} поездок`}>
              <header><strong title={column.label}>{column.label}</strong><span className="approval-column-count" aria-label={`${items.length} поездок`}>{items.length}</span></header>
              <div className="approval-column-total" aria-label={`${items.length} поездок на этапе «${column.label}»`}><span>Поездок на этапе</span><strong>{items.length}</strong></div>
              <div className="approval-column-stack" tabIndex={0} aria-label={`Поездки на этапе «${column.label}»`}>
                {items.map((request) => {
                  const forward = request.allowedActions.find((action) => action === "submit" || action === "resubmit" || action === "approve");
                  const movable = !busy && displayTripColumns.some((target) => { const action = tripDropAction(request, target.key, isAdministrator); return action && !((action === "submit" || action === "resubmit") && needsNewSignature(request)); });
                  return <SpatialCard id={request.id} lane={column.key} label={request.purpose || request.destination} disabled={!movable} key={request.id} data-trip-id={request.id} className={`approval-board-card trip-board-card ${movable ? "movable" : ""}`}>
                    <button type="button" className="approval-card-open" aria-label={`Открыть поездку ${request.number}: ${request.purpose || request.destination}`} onClick={() => openRequest(request.id)}>
                      <span className="approval-card-topline"><span>{request.number}</span>{request.status === "needs_revision" ? <em>Доработка</em> : null}</span>
                      <strong>{request.purpose || request.destination}</strong>
                      {request.purpose ? <span className="trip-card-destination">{request.destination}</span> : null}
                      <span className="approval-card-project">{dateLabel(request.startDate)} — {dateLabel(request.endDate)}</span>
                      {personLink(request.requesterUserId, <><Avatar size={24} name={personName(request.requesterUserId)} color="colorful" /><span>{personName(request.requesterUserId)}</span></>, "approval-card-owner")}
                      <span className="approval-card-meta"><span>{request.stageLabel}</span><span>{request.employeeIds.length} участн.</span></span>
                    </button>
                    <footer><span>{movable ? "Можно перенести" : request.statusLabel}</span>{request.chatId && onOpenChat ? <Button size="small" className="context-chat-button" appearance="subtle" icon={<Chat24Regular />} aria-label={`Открыть чат поездки ${request.number}`} onClick={() => onOpenChat(request.chatId!)} /> : null}{forward ? <Button size="small" appearance="subtle" disabled={busy || ((forward === "submit" || forward === "resubmit") && needsNewSignature(request))} aria-label={`${forward === "submit" && request.workflowVersion === 3 ? "Отправить первому заместителю" : actionLabels[forward]}: ${request.number}`} onClick={() => void act(request, forward)}>{moveLabels[forward]}</Button> : null}</footer>
                  </SpatialCard>;
                })}
                {!items.length ? <div className="approval-column-empty">Нет поездок</div> : null}
              </div>
            </SpatialLane>;
          })}
        </div>
        </SpatialBoard>
      ) : (
        <div className="trip-list" aria-label="Список поездок">{visibleRequests.map((request) => <button className="trip-list-item" key={request.id} onClick={() => openRequest(request.id)} type="button">
          <span><strong>{request.number}</strong><Badge appearance="tint">{request.stageLabel}</Badge></span><b>{request.destination}</b>{request.purpose ? <p>{request.purpose}</p> : null}<small>{request.startDate} — {request.endDate} · {request.employeeIds.length} сотруд. · {request.statusLabel}</small>
        </button>)}</div>
      )}
      </>}
      <Dialog open={(detailOpen && Boolean(selected)) || formOpen} onOpenChange={(_, data) => {
        if (!data.open && !busyRef.current) {
          if (formOpen) closeForm();
          else closeDetail();
        }
      }}>
        <DialogSurface className={`trip-dialog ${formMode !== null ? "record-composer-dialog" : "context-record-dialog"}`} aria-labelledby={formMode !== null ? "trip-composer-title" : undefined}>
          {formMode === null && selected ? <div className="context-record-workspace"><article className="trip-detail">
            <header><div><span>{selected.number}</span><DialogTitle>{selected.destination}</DialogTitle><p>{selected.startDate} — {selected.endDate}</p></div><Button autoFocus appearance="subtle" icon={<Dismiss20Regular />} disabled={busy} onClick={closeDetail} aria-label="Закрыть карточку поездки" /></header>
            <Badge className="trip-detail-status" appearance="tint" color={selected.status === "rejected" ? "danger" : selected.status === "approved" ? "success" : "informative"}>{selected.statusLabel}</Badge>
            <div className="trip-detail-stages" aria-label="Маршрут согласования">{displayTripColumns.filter((column) => selected.workflowVersion === 3 || column.key !== "deputy_approval").filter((column) => column.key !== (selected.stage === "rejected" ? "approved" : "rejected")).map((column) => <span key={column.key} aria-current={selected.stage === column.key ? "step" : undefined} style={{ "--approval-stage-color": column.color } as CSSProperties}>{column.label}</span>)}</div>
            {feedback}
            {pendingDecision?.id === selected.id ? <DecisionReason key={`${selected.id}:${pendingDecision.action}`} title={pendingDecision.action === "return" ? "Что нужно исправить?" : pendingDecision.action === "withdraw" ? "Причина отзыва заявки" : pendingDecision.action === "annul" ? "Причина аннулирования приказа" : "Причина отклонения"} onCancel={() => setPendingDecision(undefined)} onConfirm={(reason) => commitAction(selected, pendingDecision.action, reason)} /> : null}
            {selected.purpose ? <div className="trip-purpose"><span>Цель поездки</span><p>{selected.purpose}</p></div> : null}
            <dl className="bp7-facts"><div><dt>Инициатор</dt><dd>{personLink(selected.requesterUserId, personName(selected.requesterUserId))}</dd></div><div><dt>Период</dt><dd>{selected.startDate} — {selected.endDate}</dd></div></dl>
            <div className="trip-employees"><h3>Сотрудники</h3>{selected.employeeIds.map((id) => <span key={id}>{personLink(id, personName(id), "trip-employee-link")}</span>)}</div>
            {(selected.workflowVersion ?? 1) >= 2 ? <section className="trip-document-panel" aria-label="Документы поездки">
              <div className="trip-document-heading"><div><h3>Билдирги и приказ</h3><p>Проверьте данные, оригинал и подпись до отправки первому заместителю.</p></div>{selected.orderNumber ? <Badge appearance="tint" color="success">Приказ № {selected.orderNumber}</Badge> : null}</div>
              <dl className="trip-document-facts">{selected.expenseSource ? <div><dt>Источник расходов</dt><dd>{selected.expenseSource}</dd></div> : null}<div><dt>Текст билдирги</dt><dd>{selected.briefText || (selected.briefAttachmentName ? "См. приложенный оригинал" : "Не добавлен")}</dd></div></dl>
              <div className="trip-document-files">
                {selected.canEdit && onUploadBrief ? <><input ref={briefFileRef} className="sr-only" type="file" accept=".pdf,.docx,.jpg,.jpeg,.png" aria-label="Загрузить оригинал билдирги" onChange={(event) => { const file = event.target.files?.[0]; if (file) void changeBrief(selected, file); }} /><Button type="button" disabled={busy} onClick={() => briefFileRef.current?.click()}>{selected.briefAttachmentName ? "Заменить оригинал" : "Прикрепить оригинал"}</Button></> : null}
                {selected.briefAttachmentName ? <><Button type="button" disabled={busy} onClick={() => openDocument(selected, "attachment")}>Открыть оригинал · {selected.briefAttachmentName}</Button>{selected.canEdit && onRemoveBrief ? <Button type="button" disabled={busy} onClick={() => void changeBrief(selected, undefined, true)}>Убрать оригинал</Button> : null}</> : null}
                {selected.hasSignedBrief ? <Button type="button" disabled={busy} onClick={() => openDocument(selected, "brief")}>{selected.originalSignatureConfirmed ? "Открыть подписанный оригинал" : "Открыть подписанную билдирги PDF"}</Button> : null}
                {selected.stage === "manager_approval" ? <Button type="button" disabled={busy} onClick={() => openDocument(selected, "order-preview")}>Предпросмотр приказа</Button> : null}
                {selected.hasOrderPdf ? <Button type="button" appearance="primary" disabled={busy} onClick={() => openDocument(selected, "order")}>Открыть утверждённый приказ PDF</Button> : null}
              </div>
              {selected.canEdit && selected.requesterUserId === currentUser.id && selected.briefAttachmentName && onSetOriginalSignature ? <div className="trip-original-signature-choice"><Checkbox checked={Boolean(selected.originalSignatureConfirmed)} disabled={busy || (!selected.originalSignatureConfirmed && previewedBriefVersion !== `${selected.id}:${selected.updatedAt}`)} label="Оригинал билдирги уже подписан мной" onChange={(_, data) => void confirmOriginalSignature(selected, Boolean(data.checked))} /><p>{selected.originalSignatureConfirmed ? "Используем прикреплённый оригинал без дополнительной подписи. Снимите отметку, если нужно подписать в системе." : selected.briefAttachmentName.toLowerCase().endsWith(".docx") ? "Откройте документ. Встроенный просмотр Word показывает текст; для проверки подписи скачайте оригинал в просмотрщике." : "Сначала откройте и проверьте оригинал целиком. Если подпись уже есть в файле, подтвердите это здесь."}</p></div> : null}
              {selected.canEdit && selected.requesterUserId === currentUser.id && onUploadSignature && !selected.originalSignatureConfirmed ? <TripSignaturePad saved={selected.hasEmployeeSignature} disabled={busy} onSave={(content) => saveSignature(selected, content)} /> : null}
              {selected.canEdit && needsNewSignature(selected) ? <p className="trip-document-reminder">Перед отправкой добавьте текст или оригинал билдирги и подтвердите подпись: в прикреплённом оригинале либо в системе. После исправления заявки подпись нужно подтвердить снова. Если данные менял суперадмин, подпись подтверждает инициатор.</p> : null}
              {selected.status === "approved" ? <p role="status" className="trip-document-approved">Приказ зарегистрирован и подписан председателем. Участникам направлены уведомления.</p> : null}
              {selected.status === "annulled" ? <p role="status" className="trip-document-reminder">Приказ аннулирован. Исходный подписанный документ и история решений сохранены.</p> : null}
            </section> : selected.stage === "hr" ? <p className="trip-document-reminder">Эта поездка проходит прежний маршрут через кадровую службу.</p> : null}
            <div className="bp7-actions">
              {selected.canEdit ? <Button disabled={busy || Boolean(pendingDecision)} icon={<Edit24Regular />} onClick={() => { pendingCreatedRef.current = undefined; setBriefFile(undefined); setForm({ purpose: selected.purpose, destination: selected.destination, startDate: selected.startDate, endDate: selected.endDate, employeeIds: selected.employeeIds, briefText: selected.briefText ?? "", expenseSource: selected.expenseSource ?? "" }); setEmployeeQuery(""); setError(""); setFormMode("edit"); }}>Изменить</Button> : null}
              {selected.canDelete && onDelete ? <Button disabled={busy || Boolean(pendingDecision)} onClick={() => setConfirmDeleteId(selected.id)}>Удалить заявку</Button> : null}
              {selected.allowedActions.map((action) => <Button className={`trip-decision-action action-${action}`} disabled={busy || Boolean(pendingDecision) || ((action === "submit" || action === "resubmit") && needsNewSignature(selected))} appearance={action === "approve" || action === "submit" || action === "resubmit" ? "primary" : "secondary"} key={action} onClick={() => void act(selected, action)}>{action === "approve" && (selected.workflowVersion ?? 1) >= 2 && selected.stage === "manager_approval" ? "Утвердить и выпустить приказ" : action === "approve" && selected.stage === "deputy_approval" ? "Согласовать и передать председателю" : action === "submit" && selected.workflowVersion === 3 ? "Отправить первому заместителю" : action === "submit" && selected.workflowVersion === 2 ? "Отправить председателю" : actionLabels[action]}</Button>)}
              {isAdministrator && (selected.workflowVersion ?? 1) === 1 ? displayTripColumns.filter((column) => column.key !== selected.stage).map((column) => <Button data-stage={column.key} disabled={busy || Boolean(pendingDecision)} key={`move:${column.key}`} onClick={() => void commitAction(selected, "move", `Перенос на этап «${column.label}»`, column.key)}>{column.label}</Button>) : null}
            </div>
            {confirmDeleteId === selected.id ? <div className="trip-delete-confirm" role="group" aria-label="Подтверждение удаления заявки"><p>Удалить заявку из рабочего списка? История и документы останутся в архиве системы.</p><Button appearance="primary" disabled={busy} onClick={() => void deleteRequest(selected)}>Да, удалить</Button><Button disabled={busy} onClick={() => setConfirmDeleteId("")}>Отмена</Button></div> : null}
            <div className="bp7-history"><h3>История решений</h3>{[...selected.actions].reverse().map((entry) => <div key={entry.id}><i /><p><strong>{entry.action === "created" ? "Заявка создана" : entry.action === "deleted" ? "Заявка удалена" : actionLabels[entry.action]}</strong><span>{personLink(entry.actorUserId, personName(entry.actorUserId))} · {new Date(entry.createdAt).toLocaleString("ru-RU")}</span>{entry.comment ? <small>{entry.comment}</small> : null}</p></div>)}</div>
          </article>{renderTripChat ? renderTripChat(selected) : <div className="embedded-chat-unavailable">Чат поездки недоступен.</div>}</div> : formMode !== null ? (
          <form className="bp7-modal trip-form record-composer" noValidate aria-busy={busy} onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <RecordComposer title={formMode === "create" ? "Создать заявку на поездку" : "Изменить заявку на поездку"} titleId="trip-composer-title" eyebrow="Согласование поездок" busy={busy} error={error} submitLabel="Сохранить" onClose={closeForm}
              hint="После сохранения проверьте билдирги и подтвердите подпись в оригинале либо подпишите в системе."
              stages={<div className="record-stages" tabIndex={0} role="region" aria-label="Маршрут согласования">{displayTripColumns.filter((column) => column.key !== "rejected" && column.key !== "hr").map((column) => <span key={column.key} aria-current={column.key === (formMode === "edit" ? selected?.stage : "launch") ? "step" : undefined} style={{ "--record-stage-color": column.color } as CSSProperties}>{column.label}</span>)}</div>}
              aside={<>
                <RecordSummary title="Сводка поездки"><div className="record-summary-title">{form.destination.trim() || "Место поездки не указано"}</div>
                  <dl className="record-summary-facts"><div><dt>Даты</dt><dd>{form.startDate || "Не указано"} — {form.endDate || "Не указано"}</dd></div><div><dt>Инициатор</dt><dd>{formMode === "edit" && selected ? personLink(selected.requesterUserId, personName(selected.requesterUserId)) : personLink(currentUser.id, currentUser.name)}</dd></div><div><dt>Участников</dt><dd>{form.employeeIds.length}</dd></div></dl>
                  <ul className="record-summary-people">{form.employeeIds.map((id) => <EmployeeProfileLink as="li" key={id} userId={people.some((person) => person.id === id) ? id : undefined} personName={personName(id)}>{personName(id)}</EmployeeProfileLink>)}</ul>
                </RecordSummary>
                <section className="record-summary-card record-summary-note"><h3>Что произойдёт дальше</h3><p>Выбранный оригинал билдирги загрузится вместе с черновиком. Проверьте файл и подтвердите подпись в оригинале либо поставьте её в системе. Первый заместитель согласует заявку, затем председатель утвердит её или вернёт на уточнение.</p><p>После утверждения приказ получит отдельный номер серии WS и появится во вкладке «Утверждено».</p></section>
              </>}>
              <RecordSection title="Билдирги" description="Укажите место поездки, напишите текст или выберите готовый оригинал. Файл загрузится при сохранении черновика."><div className="record-field-grid">
                <label className="record-field-wide">Куда едем<Input aria-label="Куда едем" aria-required autoFocus placeholder="Город, страна или место встречи" value={form.destination} onChange={(_, data) => setForm({ ...form, destination: data.value })} /></label>
                <div className="record-field-wide trip-composer-brief-file">
                  <WorkspaceFileDropzone label="Оригинал билдирги" hint="PDF, DOCX, JPG или PNG · до 10 МиБ" actionLabel={briefFile ? "Заменить файл" : "Выбрать файл"} files={briefFile ? [briefFile] : []} accept=".pdf,.docx,.jpg,.jpeg,.png" disabled={busy} ariaLabel="Загрузить билдирги" onFiles={(files) => chooseBriefFile(files[0])} />
                  {briefFile ? <Button type="button" appearance="subtle" onClick={() => { setBriefFile(undefined); setError(""); }}>Убрать выбранный файл</Button> : null}
                  {formMode === "edit" && selected?.briefAttachmentName ? <p>Сейчас прикреплён: {selected.briefAttachmentName}. Новый файл заменит его после сохранения.</p> : null}
                </div>
                <label className="record-field-wide">Текст билдирги<Textarea aria-label="Текст билдирги" resize="vertical" rows={5} placeholder="Опишите основание, мероприятие и цель поездки" value={form.briefText} onChange={(_, data) => setForm({ ...form, briefText: data.value })} /></label>
              </div></RecordSection>
              {formMode === "create" && <RecordSection title="Иконка чата поездки" description="По умолчанию — самолёт. После создания иконку можно изменить в чате."><ChatIconPicker value={form.chatIconKey ?? "plane"} onChange={(chatIconKey) => setForm({ ...form, chatIconKey })} disabled={busy} /></RecordSection>}
              <RecordSection title="Даты поездки"><div className="record-field-grid">
                <label>Дата начала<WorkspaceDateTimePicker mode="date" ariaLabel="Дата начала" required value={form.startDate} onChange={(value) => setForm({ ...form, startDate: value })} /></label>
                <label>Дата окончания<WorkspaceDateTimePicker mode="date" ariaLabel="Дата окончания" required value={form.endDate} min={form.startDate} onChange={(value) => setForm({ ...form, endDate: value })} /></label>
              </div></RecordSection>
              <RecordSection title="Участники поездки" description={canChooseOthers ? "Отметьте сотрудников, которые отправятся в поездку. Поиск не сбрасывает выбор." : "Вы можете создать поездку для себя."}>
                {canChooseOthers && departments ? <EmployeeScopeSwitch value={employeeListScope} onChange={setEmployeeListScope} label="Группа участников поездки" /> : null}
                {canChooseOthers ? <Input aria-label="Найти участника поездки" placeholder="Имя или должность" value={employeeQuery} onChange={(_, data) => setEmployeeQuery(data.value)} /> : null}
                <fieldset className="employee-picker"><legend className="sr-only">Выбор участников</legend>{people.filter((person) => (canChooseOthers || person.id === currentUser.id) && (!canChooseOthers || !departments || employeeScope(person.departmentId, departments) === employeeListScope) && `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru-RU").includes(employeeQuery.trim().toLocaleLowerCase("ru-RU"))).map((person) => <Checkbox checked={form.employeeIds.includes(person.id)} key={person.id} label={<span className="workspace-person-choice"><Avatar name={person.name} size={24} color="colorful" aria-hidden="true" /><span>{person.name}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</span></span>} onChange={(_, data) => setForm({ ...form, employeeIds: data.checked ? [...form.employeeIds, person.id] : form.employeeIds.filter((id) => id !== person.id) })} />)}</fieldset>
                {canChooseOthers && !people.some((person) => (!departments || employeeScope(person.departmentId, departments) === employeeListScope) && `${person.name} ${person.jobTitle ?? ""}`.toLocaleLowerCase("ru-RU").includes(employeeQuery.trim().toLocaleLowerCase("ru-RU"))) ? <p role="status">Сотрудники не найдены. Измените поиск или группу.</p> : null}
              </RecordSection>
            </RecordComposer>
          </form>) : null}
        </DialogSurface>
      </Dialog>
      {documentPreview ? <Suspense fallback={<span role="status">Открываем документ…</span>}><ExternalFileViewer key={`${documentPreview.id}:${documentPreview.kind}:${documentPreview.updatedAt}`} attachment={documentPreview} onClose={() => setDocumentPreview(undefined)} onLoad={loadDocumentPreview} onLoadOffice={loadBriefOffice} onDownload={() => { const request = requests.find(item => item.id === documentPreview.id); if (request) return downloadDocument(request, documentPreview.kind); }} /></Suspense> : null}
    </section>
  );
}
