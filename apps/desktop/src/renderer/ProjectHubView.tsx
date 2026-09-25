import { useCallback, useEffect, useState } from "react";
import { Button, DialogSurface, Input, Textarea } from "@fluentui/react-components";
import { Add24Regular, ArrowClockwise24Regular, CheckmarkCircle24Regular, Dismiss20Regular } from "@fluentui/react-icons";
import type {
  ProjectHubItem, ProjectHubItemInput, ProjectHubOverview, ProjectHubProject,
  ProjectHubProjectInput, ProjectHubRequest, ProjectHubWorkstream, WorkspacePerson,
} from "@yuksalish/contracts";
import {
  createProjectHubRequest, createProjectHubRequestDraft, submitProjectHubRequestDraft,
  decideProjectHubRequest, loadProjectHub,
  loadProjectHubRequests, loadProjectHubRequestTargets, publishProjectHubEvent, saveProjectHubItem,
  saveProjectHubProject, saveProjectHubWorkstream, setProjectHubItemStatus,
  uploadWorkspaceAttachment, downloadWorkspaceAttachment, commentProjectHubItem,
} from "./workspace-api";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { WorkspaceSelect } from "./WorkspaceSelect";
import { SpatialBoard, SpatialCard, SpatialLane } from "./SpatialBoard";

type ViewMode = "projects" | "funding";
type FormMode = "project" | "workstream" | "item" | "request" | "status" | null;

interface Props {
  readonly mode: ViewMode;
  readonly token: string;
  readonly people: readonly WorkspacePerson[];
  readonly currentUserId: string;
  readonly canCreateProject: boolean;
  readonly canCreateRequest: boolean;
  readonly canViewFunding: boolean;
  readonly focusId?: string;
  readonly onOpenCalendar?: (eventId: string) => void;
}

const emptyHub: ProjectHubOverview = { projects: [], workstreams: [], items: [], requests: [] };
const itemStatus: Record<ProjectHubItem["status"], string> = {
  planned: "Запланировано", active: "В работе", completed: "Завершено",
  rejected: "Отклонено", cancelled: "Отменено",
};
const requestStatus: Record<ProjectHubRequest["status"], string> = {
  draft: "Черновик", pending: "На согласовании", approved: "Согласовано", rejected: "Отклонено",
};

function formatMoney(value: number | bigint, currency: string): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "Срок не указан";
  return new Date(value).toLocaleString("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function localDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Не удалось выполнить действие. Повторите попытку.";
}

function emptyProject(currentUserId: string): ProjectHubProjectInput {
  return { code: "", title: "", description: "", managerUserId: currentUserId,
    responsibleUserIds: [], approverUserIds: [], startDate: null, endDate: null,
    budget: 0, currency: "UZS", accessStatus: "open", lifecycleStatus: "active" };
}

function emptyItem(workstreamId = ""): ProjectHubItemInput {
  return { workstreamId, kind: "task", title: "", description: "", startsAt: null, dueAt: null,
    budget: 0, assigneeUserIds: [] };
}

export function ProjectHubView({ mode, token, people, currentUserId, canCreateProject,
  canCreateRequest, canViewFunding, focusId, onOpenCalendar }: Props) {
  const [hub, setHub] = useState<ProjectHubOverview>(emptyHub);
  const [requests, setRequests] = useState<readonly ProjectHubRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [asOf, setAsOf] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(focusId ?? "");
  const [selectedRequestId, setSelectedRequestId] = useState(focusId ?? "");
  const [selectedWorkstreamId, setSelectedWorkstreamId] = useState("");
  const [selectedItemId, setSelectedItemId] = useState("");
  const [fundingProjectId, setFundingProjectId] = useState("");
  const [fundingWorkstreamId, setFundingWorkstreamId] = useState("");
  const [statusTarget, setStatusTarget] = useState<"rejected" | "cancelled">("cancelled");
  const [statusComment, setStatusComment] = useState("");
  const [itemComment, setItemComment] = useState("");
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingProjectId, setEditingProjectId] = useState<string>();
  const [editingItemId, setEditingItemId] = useState<string>();
  const [editingWorkstreamId, setEditingWorkstreamId] = useState<string>();
  const [workstreamForm, setWorkstreamForm] = useState({ title: "", description: "", startDate: "", endDate: "" });
  const [projectForm, setProjectForm] = useState<ProjectHubProjectInput>(() => emptyProject(currentUserId));
  const [itemForm, setItemForm] = useState<ProjectHubItemInput>(emptyItem);
  const [requestForm, setRequestForm] = useState({ itemId: "", title: "", purpose: "", amount: "", approvalDueAt: "" });
  const [requestFiles, setRequestFiles] = useState<readonly File[]>([]);
  const [requestDraftId, setRequestDraftId] = useState("");
  const [uploadedFileCount, setUploadedFileCount] = useState(0);
  const [decisionComment, setDecisionComment] = useState("");
  const [filter, setFilter] = useState("active");

  const reload = useCallback(async (propagateError = false) => {
    setLoading(true); setLoadError("");
    try {
      const [freshHub, freshRequests] = await Promise.all([
        mode === "projects" ? loadProjectHub(token) : canCreateRequest ? loadProjectHubRequestTargets(token) : Promise.resolve(emptyHub),
        canViewFunding || mode === "funding" ? loadProjectHubRequests(token) : Promise.resolve([]),
      ]);
      setHub(freshHub); setRequests(freshRequests);
      setAsOf(Date.now());
      setSelectedProjectId((current) => current || freshHub.projects[0]?.id || "");
      setSelectedRequestId((current) => current || freshRequests[0]?.id || "");
      setFundingProjectId((current) => current || freshHub.projects[0]?.id || "");
    } catch (error) { setLoadError(errorText(error)); if (propagateError) throw error; }
    finally { setLoading(false); }
  }, [token, mode, canViewFunding, canCreateRequest]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);
  const selectedProject = hub.projects.find((project) => project.id === selectedProjectId);
  const selectedRequest = requests.find((request) => request.id === selectedRequestId);
  const projectItems = hub.items.filter((item) => item.projectId === selectedProjectId);
  const projectWorkstreams = hub.workstreams.filter((workstream) => workstream.projectId === selectedProjectId);
  const selectedWorkstream = projectWorkstreams.find((workstream) => workstream.id === selectedWorkstreamId);
  const workstreamItems = projectItems.filter((item) => item.workstreamId === selectedWorkstreamId);
  const selectedItem = workstreamItems.find((item) => item.id === selectedItemId);
  const fundingWorkstreams = hub.workstreams.filter((workstream) => workstream.projectId === fundingProjectId);
  const fundingItems = hub.items.filter((item) => item.workstreamId === fundingWorkstreamId);
  const requestProject = hub.projects.find((project) => project.id === (mode === "funding" ? fundingProjectId : selectedProjectId));
  const projectRequests = requests.filter((request) => request.projectId === selectedProjectId);
  const visibleProjects = hub.projects.filter((project) => filter === "all" || project.lifecycleStatus === filter);
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const overview = (() => {
    const active = projectItems.filter((item) => item.status === "planned" || item.status === "active");
    return { overdue: active.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < asOf).length,
      upcoming: active.filter((item) => item.dueAt && new Date(item.dueAt).getTime() >= asOf && new Date(item.dueAt).getTime() <= asOf + 20 * 86_400_000).length,
      planned: active.length, plannedBudget: active.reduce((total, item) => total + BigInt(item.budget), 0n),
      completed: projectItems.filter((item) => item.status === "completed").length,
      rejected: projectItems.filter((item) => item.status === "rejected").length };
  })();

  const mutate = async (operation: () => Promise<unknown>, closeForm = false) => {
    if (busy) return;
    setBusy(true); setActionError("");
    try { await operation(); if (closeForm) setFormMode(null); await reload(); }
    catch (error) { setActionError(errorText(error)); }
    finally { setBusy(false); }
  };

  const startProject = (project?: ProjectHubProject) => {
    setEditingProjectId(project?.id);
    setProjectForm(project ? { code: project.code, title: project.title, description: project.description,
      managerUserId: project.managerUserId, responsibleUserIds: project.responsibleUserIds,
      approverUserIds: project.approverUserIds, startDate: project.startDate ?? null,
      endDate: project.endDate ?? null, budget: project.budget, currency: project.currency,
      accessStatus: project.accessStatus, lifecycleStatus: project.lifecycleStatus } : emptyProject(currentUserId));
    setActionError(""); setFormMode("project");
  };
  const startWorkstream = (workstream?: ProjectHubWorkstream) => {
    setEditingWorkstreamId(workstream?.id);
    setWorkstreamForm({ title: workstream?.title ?? "", description: workstream?.description ?? "",
      startDate: workstream?.startDate ?? "", endDate: workstream?.endDate ?? "" });
    setActionError(""); setFormMode("workstream");
  };
  const startItem = (item?: ProjectHubItem, workstreamId?: string) => {
    setEditingItemId(item?.id);
    setItemForm(item ? { workstreamId: item.workstreamId, kind: item.kind, title: item.title, description: item.description,
      startsAt: item.startsAt ?? null, dueAt: item.dueAt ?? null, budget: item.budget,
      assigneeUserIds: item.assigneeUserIds } : emptyItem(workstreamId));
    setActionError(""); setFormMode("item");
  };
  const startRequest = (item: ProjectHubItem) => {
    setSelectedProjectId(item.projectId);
    setFundingProjectId(item.projectId); setFundingWorkstreamId(item.workstreamId);
    setRequestForm({ itemId: item.id, title: `Согласование: ${item.title}`, purpose: "", amount: "", approvalDueAt: "" });
    setRequestFiles([]); setRequestDraftId(""); setUploadedFileCount(0);
    setActionError(""); setFormMode("request");
  };
  const sendRequest = async () => {
    const amount = Number(requestForm.amount);
    if (!requestProject || !requestForm.itemId) {
      setActionError("Выберите проект, направление и работу."); return;
    }
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setActionError("Введите положительную целую сумму."); return;
    }
    const payload = { itemId: requestForm.itemId, title: requestForm.title,
      purpose: requestForm.purpose, amount,
      approvalDueAt: new Date(requestForm.approvalDueAt).toISOString() };
    await mutate(async () => {
      if (!requestFiles.length && !requestDraftId) {
        const created = await createProjectHubRequest(token, requestProject.id, payload);
        setSelectedRequestId(created.id);
        return;
      }
      let draftId = requestDraftId;
      if (!draftId) {
        const draft = await createProjectHubRequestDraft(token, requestProject.id, payload);
        draftId = draft.id;
        setRequestDraftId(draftId);
      }
      for (let index = uploadedFileCount; index < requestFiles.length; index += 1) {
        await uploadWorkspaceAttachment(token, "project_funding_request", draftId, requestFiles[index]!);
        setUploadedFileCount(index + 1);
      }
      const submitted = await submitProjectHubRequestDraft(token, draftId);
      setSelectedRequestId(submitted.id);
    }, true);
  };
  const startStatus = (item: ProjectHubItem, status: "rejected" | "cancelled") => {
    setSelectedItemId(item.id); setStatusTarget(status); setStatusComment("");
    setActionError(""); setFormMode("status");
  };
  const moveItem = async (itemId: string, status: string) => {
    const item = workstreamItems.find((candidate) => candidate.id === itemId);
    if (!item || !selectedProject) throw new Error("Работа не найдена. Обновите проект.");
    setActionError("");
    try {
      await setProjectHubItemStatus(token, selectedProject.id, item.id,
        status as ProjectHubItem["status"], item.status);
      await reload(true);
    } catch (error) { setActionError(errorText(error)); throw error; }
  };
  const addApprover = (userId: string) => {
    if (!userId || projectForm.approverUserIds.includes(userId)) return;
    setProjectForm({ ...projectForm, approverUserIds: [...projectForm.approverUserIds, userId] });
  };
  const moveApprover = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= projectForm.approverUserIds.length) return;
    const next = [...projectForm.approverUserIds];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setProjectForm({ ...projectForm, approverUserIds: next });
  };
  const downloadFile = async (attachmentId: string, fileName: string) => {
    setActionError("");
    try {
      const blob = await downloadWorkspaceAttachment(token, attachmentId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = fileName; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { setActionError(errorText(error)); }
  };

  if (loading && !hub.projects.length && !requests.length) return <section className="project-hub-view" aria-busy="true"><p>Загружаем проектное пространство…</p></section>;
  if (loadError && !hub.projects.length && !requests.length) return <section className="project-hub-view"><h1>{mode === "projects" ? "Проекты" : "Проектные заявки"}</h1><p role="alert">{loadError}</p><Button onClick={() => void reload()}>Повторить</Button></section>;

  return <section className="project-hub-view workspace-view" aria-label={mode === "projects" ? "Проекты" : "Проектные заявки"}>
    <header className="project-hub-header">
      <div><span className="view-kicker">ПРОЕКТНОЕ ПРОСТРАНСТВО</span><h1>{mode === "projects" ? "Проекты" : "Проектные заявки"}</h1>
        <p>{mode === "projects" ? "Планируйте работу, бюджет и решения в одной карточке проекта." : "Отдельный маршрут денежных решений по проектам."}</p></div>
      <div className="project-hub-header-side"><div className="project-hub-hero-summary" aria-label={mode === "projects" ? `Всего проектов: ${hub.projects.length}` : `Всего проектных заявок: ${requests.length}`}><strong>{mode === "projects" ? hub.projects.length : requests.length}</strong><span>{mode === "projects" ? "проектов в пространстве" : "заявок в пространстве"}</span></div><div className="project-hub-header-actions"><Button icon={<ArrowClockwise24Regular />} onClick={() => void reload()} disabled={loading}>Обновить</Button>
        {mode === "projects" && canCreateProject ? <Button className="project-hub-primary-action" appearance="primary" icon={<Add24Regular />} onClick={() => startProject()}>Новый проект</Button> : null}
        {mode === "funding" && canCreateRequest ? <Button className="project-hub-primary-action" appearance="primary" icon={<Add24Regular />} onClick={() => { setFundingProjectId((id) => id || hub.projects[0]?.id || ""); setFundingWorkstreamId(""); setRequestForm({ itemId: "", title: "", purpose: "", amount: "", approvalDueAt: "" }); setRequestFiles([]); setRequestDraftId(""); setUploadedFileCount(0); setActionError(""); setFormMode("request"); }}>Новая проектная заявка</Button> : null}</div></div>
    </header>
    {loadError ? <p className="project-hub-error" role="alert">{loadError}</p> : null}
    {mode === "projects" ? <div className="project-hub-layout">
      <aside className="project-hub-index" aria-label="Список новых проектов">
        <div className="project-hub-index-top"><div><span className="view-kicker">ПОРТФЕЛЬ</span><strong>Ваши проекты</strong><small>{visibleProjects.length} в выбранном срезе</small></div><WorkspaceSelect aria-label="Фильтр проектов" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="active">Активные</option><option value="completed">Завершённые</option><option value="all">Все</option></WorkspaceSelect></div>
        {visibleProjects.map((project) => <button type="button" key={project.id} className={`project-hub-project ${project.id === selectedProjectId ? "selected" : ""}`} aria-current={project.id === selectedProjectId ? "true" : undefined} onClick={() => { setSelectedProjectId(project.id); setSelectedWorkstreamId(""); setSelectedItemId(""); }}>
          <span>{project.code} · {project.accessStatus === "closed" ? "Закрытый" : "Открытый"}</span><strong>{project.title}</strong><small>{personName(project.managerUserId)}</small>
          <span className="project-hub-mini-budget">{formatMoney(project.approvedAmount, project.currency)} согласовано из {formatMoney(project.budget, project.currency)}</span>
        </button>)}
        {!visibleProjects.length ? <p className="project-hub-empty">Пока нет проектов с таким статусом.</p> : null}
      </aside>
      <main className="project-hub-canvas">
        {selectedProject ? <>
          <div className="project-hub-title"><div><span className="view-kicker">{selectedProject.code} · {selectedProject.lifecycleStatus === "active" ? "В РАБОТЕ" : "ЗАВЕРШЁН"}</span><h2>{selectedProject.title}</h2><p>{selectedProject.description || "Описание проекта ещё не добавлено."}</p></div>
            {selectedProject.canEdit ? <Button onClick={() => startProject(selectedProject)}>Настроить проект</Button> : null}</div>
          <div className="project-hub-metrics" aria-label="Обзор проекта">
            <div><span>Бюджет</span><strong>{formatMoney(selectedProject.budget, selectedProject.currency)}</strong><small>План проекта</small></div>
            <div><span>Согласовано</span><strong>{formatMoney(selectedProject.approvedAmount, selectedProject.currency)}</strong><small>По проектным заявкам</small></div>
            <div><span>Остаток</span><strong>{formatMoney(Math.max(0, selectedProject.budget - selectedProject.approvedAmount), selectedProject.currency)}</strong><small>До бюджета</small></div>
            <div className={overview.plannedBudget > BigInt(selectedProject.budget) ? "attention" : ""}><span>План работ</span><strong>{formatMoney(overview.plannedBudget, selectedProject.currency)}</strong><small>{overview.plannedBudget > BigInt(selectedProject.budget) ? "План превышает бюджет" : "По активным задачам и мероприятиям"}</small></div>
            <div className={overview.overdue || overview.rejected ? "attention" : ""}><span>Требует внимания</span><strong>{overview.overdue + overview.rejected}</strong><small>{overview.overdue} просрочено · {overview.rejected} отклонено</small></div>
          </div>
          <div className="project-hub-context"><span>Руководитель: <strong>{personName(selectedProject.managerUserId)}</strong></span><span>Срок: <strong>{selectedProject.endDate || "Не указан"}</strong></span><span>В ближайшие 20 дней: <strong>{overview.upcoming}</strong></span><span>Завершено: <strong>{overview.completed}</strong></span></div>
          <section className="project-hub-work" aria-label="Направления и работы проекта"><div className="project-hub-section-head"><div><span className="view-kicker">ПЛАН И ИСПОЛНЕНИЕ</span><h3>{selectedWorkstream ? selectedWorkstream.title : "Направления проекта"}</h3><p>{selectedWorkstream ? "Задачи, мероприятия и решения внутри направления" : `${projectWorkstreams.length} направлений · ${overview.planned} активных работ · ${overview.completed} завершено`}</p></div>{selectedWorkstream ? <Button onClick={() => { setSelectedWorkstreamId(""); setSelectedItemId(""); }}>← К проекту</Button> : selectedProject.canEdit && selectedProject.lifecycleStatus === "active" ? <Button icon={<Add24Regular />} onClick={() => startWorkstream()}>Добавить направление</Button> : null}</div>
            {!selectedWorkstream ? <div className="project-hub-workstream-grid">{projectWorkstreams.map((workstream) => {
              const items = projectItems.filter((item) => item.workstreamId === workstream.id);
              const live = items.filter((item) => item.status === "planned" || item.status === "active");
              const late = live.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < asOf).length;
              return <button type="button" className="project-hub-workstream-card" key={workstream.id} onClick={() => { setSelectedWorkstreamId(workstream.id); setSelectedItemId(""); }}>
                <span className="view-kicker">НАПРАВЛЕНИЕ · {workstream.endDate ? `ДО ${workstream.endDate}` : "БЕЗ СРОКА"}</span><strong>{workstream.title}</strong><span>{workstream.description || "Описание ещё не добавлено"}</span>
                <span className="project-hub-workstream-numbers"><b>{items.filter((item) => item.kind === "task").length}</b> задач · <b>{items.filter((item) => item.kind === "event").length}</b> мероприятий · <b>{items.filter((item) => item.status === "completed").length}</b> завершено{late ? ` · ${late} просрочено` : ""}</span>
                <span className="project-hub-workstream-open">Открыть направление →</span>
              </button>;
            })}{!projectWorkstreams.length ? <div className="project-hub-empty">Сначала добавьте направление, например «Проведение форума».</div> : null}</div> : <>
              <div className="project-hub-subproject-summary"><p>{selectedWorkstream.description || "Описание направления ещё не добавлено."}</p><span>Начало: <strong>{selectedWorkstream.startDate || "Не указано"}</strong></span><span>Срок: <strong>{selectedWorkstream.endDate || "Не указан"}</strong></span><span>Задач: <strong>{workstreamItems.filter((item) => item.kind === "task").length}</strong></span><span>Мероприятий: <strong>{workstreamItems.filter((item) => item.kind === "event").length}</strong></span><span>В работе: <strong>{workstreamItems.filter((item) => item.status === "active").length}</strong></span><span>Завершено: <strong>{workstreamItems.filter((item) => item.status === "completed").length}</strong></span><span>Отклонено: <strong>{workstreamItems.filter((item) => item.status === "rejected").length}</strong></span><span>Просрочено: <strong>{workstreamItems.filter((item) => item.dueAt && new Date(item.dueAt).getTime() < asOf && ["planned", "active"].includes(item.status)).length}</strong></span><span>Заявок: <strong>{workstreamItems.reduce((total, item) => total + item.requestCount, 0)}</strong></span><span>Плановый бюджет: <strong>{formatMoney(workstreamItems.reduce((total, item) => total + item.budget, 0), selectedProject.currency)}</strong></span></div>
              <div className="project-hub-subproject-actions">{selectedProject.canEdit && selectedProject.lifecycleStatus === "active" ? <><Button onClick={() => startWorkstream(selectedWorkstream)}>Настроить направление</Button><Button icon={<Add24Regular />} onClick={() => startItem(undefined, selectedWorkstream.id)}>Задача или мероприятие</Button></> : null}</div>
              {workstreamItems.length ? <div className="project-hub-workspace"><SpatialBoard canDrop={(id, lane) => { const item = workstreamItems.find((candidate) => candidate.id === id); return !!item && item.kind === "task" && selectedProject.canEdit && selectedProject.lifecycleStatus === "active" && !["cancelled", "rejected"].includes(lane) && item.status !== "cancelled" && lane !== item.status; }} onMove={moveItem} onPick={setSelectedItemId}>
                <div className="project-hub-task-board" role="region" aria-label={`Работы направления ${selectedWorkstream.title}`}>{(["planned", "active", "completed", "rejected", "cancelled"] as const).map((status) => <SpatialLane id={status} key={status} className={`project-hub-task-lane ${status}`} aria-label={itemStatus[status]}><div className="project-hub-lane-head"><h4>{itemStatus[status]}</h4><span>{workstreamItems.filter((item) => item.status === status).length}</span></div>{workstreamItems.filter((item) => item.status === status).map((item) => <SpatialCard id={item.id} lane={status} label={item.title} key={item.id} disabled={!selectedProject.canEdit || item.kind !== "task" || item.status === "cancelled" || selectedProject.lifecycleStatus !== "active"} className={`project-hub-task-card ${selectedItemId === item.id ? "selected" : ""}`}><button type="button" onClick={() => setSelectedItemId(item.id)}><small>{item.kind === "task" ? "Задача" : "Мероприятие"} · {formatDate(item.dueAt)}</small><strong>{item.title}</strong><span>{item.assigneeUserIds.map(personName).join(", ") || "Исполнитель не назначен"}</span>{item.requestCount ? <small>{item.approvedRequestCount} из {item.requestCount} заявок согласовано</small> : null}</button></SpatialCard>)}</SpatialLane>)}</div>
              </SpatialBoard><aside className="project-hub-item-detail" aria-label="Карточка проектной работы">{selectedItem ? <><span className="view-kicker">{selectedItem.kind === "task" ? "ПРОЕКТНАЯ ЗАДАЧА" : "МЕРОПРИЯТИЕ"}</span><h4>{selectedItem.title}</h4><p>{selectedItem.description || "Без описания"}</p><div className="project-hub-item-facts"><span>Состояние: <strong>{itemStatus[selectedItem.status]}</strong></span><span>Срок: <strong>{formatDate(selectedItem.dueAt)}</strong></span><span>Плановый бюджет: <strong>{formatMoney(selectedItem.budget, selectedProject.currency)}</strong></span><span>Исполнители: <strong>{selectedItem.assigneeUserIds.map(personName).join(", ") || "Не назначены"}</strong></span></div>
                {selectedProject.canEdit && selectedProject.lifecycleStatus === "active" ? <div className="project-hub-item-actions"><Button onClick={() => startItem(selectedItem)}>Изменить</Button>{selectedItem.status !== "cancelled" ? <><label>Состояние<WorkspaceSelect aria-label={`Состояние: ${selectedItem.title}`} value={selectedItem.status} onChange={(event) => { const next = event.target.value as ProjectHubItem["status"]; if (next === "cancelled" || next === "rejected") startStatus(selectedItem, next); else void mutate(() => setProjectHubItemStatus(token, selectedProject.id, selectedItem.id, next, selectedItem.status)); }}><option value="planned">Запланировано</option><option value="active">В работе</option><option value="completed">Завершено</option>{selectedItem.kind === "task" ? <option value="rejected">Отклонить с причиной…</option> : null}<option value="cancelled">Отменить с причиной…</option></WorkspaceSelect></label>{selectedItem.kind === "task" ? <Button onClick={() => startStatus(selectedItem, "rejected")}>Отклонить с причиной</Button> : null}<Button onClick={() => startStatus(selectedItem, "cancelled")}>Отменить с причиной</Button></> : null}{selectedItem.kind === "event" && !selectedItem.calendarEventId ? <Button onClick={() => void mutate(() => publishProjectHubEvent(token, selectedProject.id, selectedItem.id))}>Опубликовать в календаре</Button> : null}</div> : null}
                {selectedItem.calendarEventId && onOpenCalendar ? <Button appearance="subtle" onClick={() => onOpenCalendar(selectedItem.calendarEventId!)}>Открыть в календаре ↗</Button> : null}
                {canCreateRequest && selectedProject.lifecycleStatus === "active" && selectedItem.status !== "cancelled" && (selectedProject.canEdit || selectedProject.responsibleUserIds.includes(currentUserId) || selectedItem.assigneeUserIds.includes(currentUserId)) ? <Button onClick={() => startRequest(selectedItem)}>Новая проектная заявка</Button> : null}
                <h5>Заявки</h5><div className="project-hub-linked">{projectRequests.filter((request) => request.itemId === selectedItem.id).map((request) => <span key={request.id} className={`project-hub-request-pill ${request.status}`}>{request.status === "approved" ? <CheckmarkCircle24Regular aria-hidden="true" /> : null}{request.title} · {requestStatus[request.status]}</span>)}{!selectedItem.requestCount ? "Заявок пока нет" : null}{selectedItem.requestCount && !projectRequests.some((request) => request.itemId === selectedItem.id) ? `${selectedItem.approvedRequestCount} из ${selectedItem.requestCount} согласовано` : null}</div>
                <h5>Обсуждение и история</h5><div className="project-hub-action-history">{selectedItem.actions.map((action, index) => <p key={`${action.createdAt}:${index}`}><strong>{personName(action.actorUserId)}</strong> · {action.action === "comment" ? "комментарий" : `${itemStatus[action.fromStatus as ProjectHubItem["status"]] || "Статус"} → ${itemStatus[action.toStatus as ProjectHubItem["status"]] || "Статус"}`} · {formatDate(action.createdAt)}{action.comment ? <small>{action.comment}</small> : null}</p>)}{!selectedItem.actions.length ? <p>История пока пуста.</p> : null}</div>
                {(selectedProject.canEdit || selectedProject.responsibleUserIds.includes(currentUserId) || selectedItem.assigneeUserIds.includes(currentUserId)) ? <form className="project-hub-comment-form" onSubmit={(event) => { event.preventDefault(); if (!itemComment.trim()) return; void mutate(async () => { await commentProjectHubItem(token, selectedProject.id, selectedItem.id, itemComment); setItemComment(""); }); }}><label>Новый комментарий<Textarea value={itemComment} onChange={(_, data) => setItemComment(data.value)} maxLength={4000} /></label><Button type="submit" disabled={busy || !itemComment.trim()}>Отправить</Button></form> : null}</> : <p className="project-hub-empty">Выберите задачу или мероприятие, чтобы увидеть детали, заявки и обсуждение.</p>}</aside></div> : <div className="project-hub-empty">В направлении пока нет задач и мероприятий.</div>}
            </>}
          </section>
          <section className="project-hub-route" aria-label="Порядок согласования"><div><span className="view-kicker">ДЕНЕЖНЫЕ РЕШЕНИЯ</span><h3>Маршрут согласования</h3><p>Новые заявки сохраняют действующий порядок; начатые идут по своей версии.</p></div><div>{selectedProject.approverUserIds.length ? selectedProject.approverUserIds.map((id, index) => <span key={id}><b>{index + 1}</b>{personName(id)}</span>) : <em>Согласующие ещё не назначены</em>}</div></section>
        </> : <div className="project-hub-empty">Выберите проект или создайте новый.</div>}
      </main>
    </div> : <div className="project-hub-funding-layout">
      <div className="project-hub-funding-overview" aria-label="Сводка проектных заявок">{(["draft", "pending", "approved", "rejected"] as const).map((status) => <div className={`project-hub-funding-stat ${status}`} key={status}><span>{requestStatus[status]}</span><strong>{requests.filter((request) => request.status === status).length}</strong><small>{status === "draft" ? "Личные черновики" : status === "pending" ? "Ожидают решения" : status === "approved" ? "Маршрут завершён" : "Сохранены в истории"}</small></div>)}</div>
      <div className="project-hub-funding-board" role="region" aria-label="Канбан проектных заявок">
        {(["draft", "pending", "approved", "rejected"] as const).map((status) => <section className={`project-hub-funding-lane ${status}`} key={status} aria-label={requestStatus[status]}>
          <div className="project-hub-lane-head"><h3>{requestStatus[status]}</h3><span>{requests.filter((request) => request.status === status).length}</span></div>
          {requests.filter((request) => request.status === status).map((request) => <button type="button" key={request.id} aria-current={selectedRequestId === request.id ? "true" : undefined} className={`project-hub-funding-card ${selectedRequestId === request.id ? "selected" : ""}`} onClick={() => { setSelectedRequestId(request.id); setDecisionComment(""); }}><span>{request.projectTitle} · {request.itemTitle}</span><strong>{request.title}</strong><b>{formatMoney(request.amount, request.currency)}</b><small>{status === "pending" && request.approverUserIds[request.currentStep] ? `Сейчас: ${personName(request.approverUserIds[request.currentStep]!)}` : requestStatus[status]}</small>{request.approvalDueAt ? <small className={status === "pending" && new Date(request.approvalDueAt).getTime() < asOf ? "overdue" : ""}>Срок: {formatDate(request.approvalDueAt)}</small> : null}</button>)}
          {!requests.some((request) => request.status === status) ? <p className="project-hub-lane-empty">Пока пусто</p> : null}
        </section>)}
        {!requests.length ? <p className="project-hub-empty">Доступных проектных заявок пока нет.</p> : null}
      </div>
      <aside className="project-hub-funding-detail" aria-label="Карточка проектной заявки">{actionError ? <p className="project-hub-error" role="alert">{actionError}</p> : null}{selectedRequest ? <><span className="view-kicker">{selectedRequest.projectTitle} · {selectedRequest.itemTitle}</span><h2>{selectedRequest.title}</h2><p>{selectedRequest.purpose || "Назначение не указано"}</p><div className="project-hub-funding-amount">{formatMoney(selectedRequest.amount, selectedRequest.currency)}</div><div className={`project-hub-state ${selectedRequest.status}`}>{requestStatus[selectedRequest.status]}</div><p className={selectedRequest.status === "pending" && selectedRequest.approvalDueAt && new Date(selectedRequest.approvalDueAt).getTime() < asOf ? "project-hub-deadline-overdue" : ""}>Срок согласования: {formatDate(selectedRequest.approvalDueAt)}</p>
        <h3>Файлы</h3><div className="project-hub-files">{selectedRequest.attachments.map((file) => <Button appearance="subtle" key={file.id} onClick={() => void downloadFile(file.id, file.fileName)}>{file.fileName}</Button>)}{!selectedRequest.attachments.length ? <p>Файлов пока нет.</p> : null}</div>
        {(selectedRequest.status === "draft" || selectedRequest.status === "pending") && selectedRequest.requesterUserId === currentUserId ? <label className="project-hub-upload">Прикрепить файл<input type="file" aria-label="Прикрепить файл" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void mutate(() => uploadWorkspaceAttachment(token, "project_funding_request", selectedRequest.id, file)); event.target.value = ""; }} /><small>До 25 МБ. Файл станет доступен участникам после отправки.</small></label> : null}
        {selectedRequest.status === "draft" && selectedRequest.requesterUserId === currentUserId ? <Button appearance="primary" disabled={busy} onClick={() => void mutate(() => submitProjectHubRequestDraft(token, selectedRequest.id))}>Отправить на согласование</Button> : null}
        <h3>Порядок решений</h3><ol className="project-hub-steps">{selectedRequest.approverUserIds.map((id, index) => <li key={id} className={index < selectedRequest.currentStep ? "done" : index === selectedRequest.currentStep && selectedRequest.status === "pending" ? "current" : ""}><span>{personName(id)}</span><small>{index < selectedRequest.currentStep ? "Согласовано" : index === selectedRequest.currentStep && selectedRequest.status === "pending" ? "Ожидает решения" : "Следующий"}</small></li>)}</ol>
        {selectedRequest.canDecide ? <div className="project-hub-decide"><label>Комментарий к решению<Textarea value={decisionComment} onChange={(_, data) => setDecisionComment(data.value)} /></label><div><Button appearance="primary" disabled={busy} onClick={() => void mutate(() => decideProjectHubRequest(token, selectedRequest.id, "approve", decisionComment))}>Согласовать</Button><Button disabled={busy || !decisionComment.trim()} onClick={() => void mutate(() => decideProjectHubRequest(token, selectedRequest.id, "reject", decisionComment))}>Отклонить</Button></div></div> : null}
        <h3>История</h3><div className="project-hub-action-history">{selectedRequest.actions.map((action, index) => <p key={`${action.createdAt}:${index}`}><strong>{personName(action.actorUserId)}</strong> · {action.action === "submit" ? "отправил" : action.action === "approve" ? "согласовал" : "отклонил"} · {formatDate(action.createdAt)}{action.comment ? <small>{action.comment}</small> : null}</p>)}</div>
      </> : <div className="project-hub-empty">Выберите заявку, чтобы увидеть маршрут и решение.</div>}</aside>
    </div>}
    {actionError && formMode === null && mode === "projects" ? <p role="alert" className="project-hub-error">{actionError}</p> : null}

    <Dialog open={formMode !== null} onOpenChange={(_, data) => { if (!data.open && !busy) setFormMode(null); }}><DialogSurface className="project-hub-dialog" aria-labelledby="project-hub-dialog-title">
       <div className="project-hub-dialog-head"><div><span className="view-kicker">ПРОЕКТНОЕ ПРОСТРАНСТВО</span><h2 id="project-hub-dialog-title">{formMode === "project" ? editingProjectId ? "Настроить проект" : "Новый проект" : formMode === "workstream" ? editingWorkstreamId ? "Изменить направление" : "Новое направление" : formMode === "item" ? editingItemId ? "Изменить работу" : "Новая работа" : formMode === "status" ? statusTarget === "rejected" ? "Отклонить задачу" : "Отменить работу" : "Новая проектная заявка"}</h2></div><Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть" disabled={busy} onClick={() => setFormMode(null)} /></div>
      {formMode === "project" ? <form onSubmit={(event) => { event.preventDefault(); void mutate(() => saveProjectHubProject(token, projectForm, editingProjectId), true); }}><div className="project-hub-form-scroll"><div className="project-hub-fields"><label>Название проекта<Input required value={projectForm.title} onChange={(_, data) => setProjectForm({ ...projectForm, title: data.value })} /></label><label>Код проекта<Input required value={projectForm.code} onChange={(_, data) => setProjectForm({ ...projectForm, code: data.value })} /></label><label className="wide">Описание<Textarea value={projectForm.description} onChange={(_, data) => setProjectForm({ ...projectForm, description: data.value })} /></label><label>Руководитель<WorkspaceSelect value={projectForm.managerUserId} onChange={(event) => setProjectForm({ ...projectForm, managerUserId: event.target.value })}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</WorkspaceSelect></label><label>Бюджет<Input required type="number" min="0" value={String(projectForm.budget)} onChange={(_, data) => setProjectForm({ ...projectForm, budget: Number(data.value) })} /></label><label>Валюта<WorkspaceSelect value={projectForm.currency} onChange={(event) => setProjectForm({ ...projectForm, currency: event.target.value as ProjectHubProjectInput["currency"] })}><option>UZS</option><option>USD</option><option>EUR</option></WorkspaceSelect></label><label>Начало<Input type="date" value={projectForm.startDate ?? ""} onChange={(_, data) => setProjectForm({ ...projectForm, startDate: data.value || null })} /></label><label>Срок проекта<Input type="date" value={projectForm.endDate ?? ""} onChange={(_, data) => setProjectForm({ ...projectForm, endDate: data.value || null })} /></label><label>Доступ<WorkspaceSelect value={projectForm.accessStatus} onChange={(event) => setProjectForm({ ...projectForm, accessStatus: event.target.value as ProjectHubProjectInput["accessStatus"] })}><option value="open">Открытый</option><option value="closed">Закрытый</option></WorkspaceSelect></label><label>Состояние<WorkspaceSelect value={projectForm.lifecycleStatus} onChange={(event) => setProjectForm({ ...projectForm, lifecycleStatus: event.target.value as ProjectHubProjectInput["lifecycleStatus"] })}><option value="active">Активный</option><option value="completed">Завершённый</option></WorkspaceSelect></label></div>
        <fieldset className="project-hub-people"><legend>Другие ответственные</legend>{people.map((person) => <label key={person.id}><input type="checkbox" checked={projectForm.responsibleUserIds.includes(person.id)} onChange={(event) => setProjectForm({ ...projectForm, responsibleUserIds: event.target.checked ? [...projectForm.responsibleUserIds, person.id] : projectForm.responsibleUserIds.filter((id) => id !== person.id) })} />{person.name}</label>)}</fieldset>
        <fieldset className="project-hub-approvers"><legend>Порядок согласующих</legend><p>Порядок применяется к новым проектным заявкам.</p><WorkspaceSelect aria-label="Добавить согласующего" value="" onChange={(event) => addApprover(event.target.value)}><option value="">Выберите сотрудника</option>{people.filter((person) => !projectForm.approverUserIds.includes(person.id)).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</WorkspaceSelect>{projectForm.approverUserIds.map((id, index) => <div key={id}><b>{index + 1}</b><span>{personName(id)}</span><Button type="button" appearance="subtle" disabled={index === 0} onClick={() => moveApprover(index, -1)}>↑</Button><Button type="button" appearance="subtle" disabled={index === projectForm.approverUserIds.length - 1} onClick={() => moveApprover(index, 1)}>↓</Button><Button type="button" appearance="subtle" onClick={() => setProjectForm({ ...projectForm, approverUserIds: projectForm.approverUserIds.filter((value) => value !== id) })}>Убрать</Button></div>)}</fieldset></div><div className="project-hub-dialog-footer">{actionError ? <span role="alert">{actionError}</span> : null}<Button type="button" disabled={busy} onClick={() => setFormMode(null)}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy}>{busy ? "Сохраняем…" : "Сохранить проект"}</Button></div></form> : null}
      {formMode === "workstream" && selectedProject ? <form onSubmit={(event) => { event.preventDefault(); void mutate(() => saveProjectHubWorkstream(token, selectedProject.id, { ...workstreamForm, startDate: workstreamForm.startDate || null, endDate: workstreamForm.endDate || null }, editingWorkstreamId), true); }}><div className="project-hub-form-scroll"><p>Направление объединяет задачи и мероприятия в рамках проекта.</p><div className="project-hub-fields"><label className="wide">Название направления<Input required maxLength={240} value={workstreamForm.title} onChange={(_, data) => setWorkstreamForm({ ...workstreamForm, title: data.value })} placeholder="Например, Проведение форума" /></label><label className="wide">Описание<Textarea value={workstreamForm.description} onChange={(_, data) => setWorkstreamForm({ ...workstreamForm, description: data.value })} /></label><label>Начало<Input type="date" value={workstreamForm.startDate} onChange={(_, data) => setWorkstreamForm({ ...workstreamForm, startDate: data.value })} /></label><label>Срок направления<Input type="date" min={workstreamForm.startDate || undefined} value={workstreamForm.endDate} onChange={(_, data) => setWorkstreamForm({ ...workstreamForm, endDate: data.value })} /></label></div></div><div className="project-hub-dialog-footer">{actionError ? <span role="alert">{actionError}</span> : null}<Button type="button" disabled={busy} onClick={() => setFormMode(null)}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy}>Сохранить направление</Button></div></form> : null}
      {formMode === "item" && selectedProject ? <form onSubmit={(event) => { event.preventDefault(); void mutate(() => saveProjectHubItem(token, selectedProject.id, itemForm, editingItemId), true); }}><div className="project-hub-form-scroll"><div className="project-hub-fields"><label>Направление<WorkspaceSelect required value={itemForm.workstreamId} onChange={(event) => setItemForm({ ...itemForm, workstreamId: event.target.value })}>{projectWorkstreams.map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.title}</option>)}</WorkspaceSelect></label><label>Тип<WorkspaceSelect value={itemForm.kind} onChange={(event) => setItemForm({ ...itemForm, kind: event.target.value as ProjectHubItem["kind"] })}><option value="task">Задача</option><option value="event">Мероприятие</option></WorkspaceSelect></label><label>Название<Input required value={itemForm.title} onChange={(_, data) => setItemForm({ ...itemForm, title: data.value })} /></label><label className="wide">Описание<Textarea value={itemForm.description} onChange={(_, data) => setItemForm({ ...itemForm, description: data.value })} /></label><label>Начало<Input type="datetime-local" required={itemForm.kind === "event"} value={localDateTime(itemForm.startsAt)} onChange={(_, data) => setItemForm({ ...itemForm, startsAt: data.value ? new Date(data.value).toISOString() : null })} /></label><label>Срок / окончание<Input type="datetime-local" required={itemForm.kind === "event"} value={localDateTime(itemForm.dueAt)} onChange={(_, data) => setItemForm({ ...itemForm, dueAt: data.value ? new Date(data.value).toISOString() : null })} /></label><label>Плановый бюджет<Input type="number" min="0" required value={String(itemForm.budget)} onChange={(_, data) => setItemForm({ ...itemForm, budget: Number(data.value) })} /></label></div><fieldset className="project-hub-people"><legend>Исполнители</legend>{people.map((person) => <label key={person.id}><input type="checkbox" checked={itemForm.assigneeUserIds.includes(person.id)} onChange={(event) => setItemForm({ ...itemForm, assigneeUserIds: event.target.checked ? [...itemForm.assigneeUserIds, person.id] : itemForm.assigneeUserIds.filter((id) => id !== person.id) })} />{person.name}</label>)}</fieldset></div><div className="project-hub-dialog-footer">{actionError ? <span role="alert">{actionError}</span> : null}<Button type="button" disabled={busy} onClick={() => setFormMode(null)}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy}>Сохранить работу</Button></div></form> : null}
      {formMode === "request" ? <form onSubmit={(event) => { event.preventDefault(); void sendRequest(); }}><div className="project-hub-form-scroll"><p>Заявка пройдёт по маршруту выбранного проекта. Файлы можно добавить сейчас или позже. Заявка уйдёт на согласование после загрузки выбранных файлов.</p><fieldset className="project-hub-fields" disabled={!!requestDraftId}>{mode === "funding" ? <><label>Проект<WorkspaceSelect required value={fundingProjectId} onChange={(event) => { setFundingProjectId(event.target.value); setFundingWorkstreamId(""); setRequestForm({ ...requestForm, itemId: "" }); }}><option value="">Выберите проект</option>{hub.projects.filter((project) => project.lifecycleStatus === "active").map((project) => <option value={project.id} key={project.id}>{project.code} · {project.title}</option>)}</WorkspaceSelect></label><label>Направление<WorkspaceSelect required value={fundingWorkstreamId} onChange={(event) => { setFundingWorkstreamId(event.target.value); setRequestForm({ ...requestForm, itemId: "" }); }}><option value="">Выберите направление</option>{fundingWorkstreams.map((workstream) => <option value={workstream.id} key={workstream.id}>{workstream.title}</option>)}</WorkspaceSelect></label><label className="wide">Задача или мероприятие<WorkspaceSelect required value={requestForm.itemId} onChange={(event) => setRequestForm({ ...requestForm, itemId: event.target.value })}><option value="">Выберите работу</option>{fundingItems.filter((item) => item.status !== "cancelled").map((item) => <option value={item.id} key={item.id}>{item.kind === "task" ? "Задача" : "Мероприятие"} · {item.title}</option>)}</WorkspaceSelect></label></> : null}<label className="wide">Название<Input required value={requestForm.title} onChange={(_, data) => setRequestForm({ ...requestForm, title: data.value })} /></label><label>Сумма · {requestProject?.currency || "UZS"}<Input required type="number" min="1" value={requestForm.amount} onChange={(_, data) => setRequestForm({ ...requestForm, amount: data.value })} /></label><label>Крайний срок согласования<Input required type="datetime-local" value={requestForm.approvalDueAt} onChange={(_, data) => setRequestForm({ ...requestForm, approvalDueAt: data.value })} /></label><label className="wide">Назначение<Textarea value={requestForm.purpose} onChange={(_, data) => setRequestForm({ ...requestForm, purpose: data.value })} /></label></fieldset><div className="project-hub-request-files"><label>Файлы · необязательно<input type="file" multiple disabled={busy || !!requestDraftId} aria-label="Файлы заявки" onChange={(event) => { const added = Array.from(event.target.files ?? []); if (added.some((file) => file.size > 25 * 1024 * 1024)) { setActionError("Каждый файл должен быть не больше 25 МБ."); } else { setRequestFiles((current) => [...current, ...added]); setActionError(""); } event.target.value = ""; }} /></label><small>До 25 МБ на файл. Необязательно.</small>{requestFiles.map((file, index) => <div key={`${file.name}:${index}`}><span>{file.name} · {Math.ceil(file.size / 1024)} КБ {index < uploadedFileCount ? "· Загружен" : ""}</span>{!requestDraftId ? <Button type="button" appearance="subtle" onClick={() => setRequestFiles((current) => current.filter((_, candidate) => candidate !== index))}>Убрать</Button> : null}</div>)}{requestDraftId ? <p>Черновик сохранён: реквизиты уже зафиксированы. При ошибке можно повторить отправку без повторной загрузки принятых файлов.</p> : null}</div><div className="project-hub-route-preview">{requestProject?.approverUserIds.length ? requestProject.approverUserIds.map((id, index) => <span key={id}>{index + 1}. {personName(id)}</span>) : "Маршрут не настроен: руководитель должен добавить согласующих."}</div></div><div className="project-hub-dialog-footer">{actionError ? <span role="alert">{actionError}</span> : null}<Button type="button" disabled={busy} onClick={() => setFormMode(null)}>Отмена</Button><Button type="submit" appearance="primary" disabled={busy || !requestProject?.approverUserIds.length || !requestForm.itemId}>Отправить на согласование</Button></div></form> : null}
      {formMode === "status" && selectedProject && selectedItem ? <form onSubmit={(event) => { event.preventDefault(); void mutate(() => setProjectHubItemStatus(token, selectedProject.id, selectedItem.id, statusTarget, selectedItem.status, statusComment), true); }}><div className="project-hub-form-scroll"><p>{statusTarget === "rejected" ? "Отклонение вернёт задачу в список требующих внимания. Укажите, что нужно исправить." : "Отмена работы сохранится в истории проекта. Укажите понятную причину для участников."}</p><label className="project-hub-status-comment">{statusTarget === "rejected" ? "Причина отклонения" : "Причина отмены"}<Textarea required value={statusComment} onChange={(_, data) => setStatusComment(data.value)} maxLength={4000} /></label></div><div className="project-hub-dialog-footer">{actionError ? <span role="alert">{actionError}</span> : null}<Button type="button" disabled={busy} onClick={() => setFormMode(null)}>Назад</Button><Button type="submit" appearance="primary" disabled={busy || !statusComment.trim()}>{statusTarget === "rejected" ? "Подтвердить отклонение" : "Подтвердить отмену"}</Button></div></form> : null}
    </DialogSurface></Dialog>
  </section>;
}
