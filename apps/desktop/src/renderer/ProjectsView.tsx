import { useRef, useState } from "react";
import { useModalFocus } from "./useModalFocus";
import { DecisionReason } from "./DecisionReason";

import type {
  ProjectInput,
  ProjectStage,
  WorkspacePerson,
  WorkspaceProject,
} from "@yuksalish/contracts";
import { Badge, Button, Input, Textarea } from "@fluentui/react-components";
import { Add24Regular, ArrowRight24Regular, Edit24Regular } from "@fluentui/react-icons";

const stages: readonly ProjectStage[] = ["start", "preparation", "approval", "success", "failure"];
const stageLabels: Readonly<Record<ProjectStage, string>> = {
  start: "Начало",
  preparation: "Подготовка",
  approval: "Согласование",
  success: "Успех",
  failure: "Провал",
};
const nextStages: Readonly<Record<ProjectStage, readonly ProjectStage[]>> = {
  start: ["preparation"],
  preparation: ["start", "approval"],
  approval: ["preparation", "success", "failure"],
  success: ["approval"],
  failure: ["approval"],
};

interface ProjectsViewProps {
  readonly projects: readonly WorkspaceProject[];
  readonly people: readonly WorkspacePerson[];
  readonly currentUser: WorkspacePerson;
  readonly onCreate: (payload: ProjectInput) => Promise<WorkspaceProject | undefined>;
  readonly onUpdate: (
    project: WorkspaceProject,
    payload: ProjectInput,
  ) => Promise<WorkspaceProject | undefined>;
  readonly onMove: (
    project: WorkspaceProject,
    stage: ProjectStage,
    comment?: string,
  ) => Promise<WorkspaceProject | undefined>;
}

interface ProjectFormState {
  code: string;
  title: string;
  description: string;
  managerUserId: string;
  startDate: string;
  endDate: string;
  budget: string;
  spentBudget: string;
  currency: "UZS" | "USD" | "EUR";
}

function emptyForm(managerUserId: string): ProjectFormState {
  return {
    code: "",
    title: "",
    description: "",
    managerUserId,
    startDate: "",
    endDate: "",
    budget: "0",
    spentBudget: "0",
    currency: "UZS",
  };
}

function projectForm(project: WorkspaceProject): ProjectFormState {
  return {
    code: project.code,
    title: project.title,
    description: project.description,
    managerUserId: project.managerUserId,
    startDate: project.startDate ?? "",
    endDate: project.endDate ?? "",
    budget: String(project.budget),
    spentBudget: String(project.spentBudget),
    currency: project.currency,
  };
}

function payloadFromForm(form: ProjectFormState): ProjectInput | undefined {
  const budget = Number(form.budget);
  const spentBudget = Number(form.spentBudget);
  if (!form.code.trim() || !form.title.trim() || !form.managerUserId) return undefined;
  if (!Number.isSafeInteger(budget) || !Number.isSafeInteger(spentBudget)) return undefined;
  if (budget < 0 || spentBudget < 0 || spentBudget > budget) return undefined;
  return {
    code: form.code.trim(),
    title: form.title.trim(),
    description: form.description.trim(),
    managerUserId: form.managerUserId,
    startDate: form.startDate || null,
    endDate: form.endDate || null,
    budget,
    spentBudget,
    currency: form.currency,
  };
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value) + ` ${currency}`;
}

export function ProjectsView({ projects, people, currentUser, onCreate, onUpdate, onMove }: ProjectsViewProps) {
  const [selectedId, updateSelectedId] = useState(projects[0]?.id ?? "");
  const [detailOpen, setDetailOpen] = useState(false);
  const [failureId, setFailureId] = useState<string>();
  const setSelectedId = (id: string) => { updateSelectedId(id); setDetailOpen(true); };
  const [form, setForm] = useState<ProjectFormState>(() => emptyForm(currentUser.id));
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useModalFocus(formRef, formMode !== null, () => setFormMode(null));
  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];
  const canCreate = ["manager", "admin", "superadmin"].includes(currentUser.role);
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const activeCount = projects.filter((project) => project.status !== "completed").length;

  const save = async () => {
    const payload = payloadFromForm(form);
    if (payload === undefined) return;
    const saved = formMode === "edit" && selected !== undefined
      ? await onUpdate(selected, payload)
      : await onCreate(payload);
    if (saved !== undefined) {
      setSelectedId(saved.id);
      setFormMode(null);
    }
  };

  const move = async (project: WorkspaceProject, stage: ProjectStage) => {
    if (stage === "failure") { setSelectedId(project.id); setFailureId(project.id); return; }
    await onMove(project, stage);
  };

  return (
    <section className={`workspace-view bp7-view projects-view ${detailOpen && selected ? "detail-open" : ""}`} aria-label="Список проектов">
      <header className="bp7-header">
        <div>
          <span className="view-kicker">BP‑7 · Общая воронка</span>
          <h1>Список проектов</h1>
          <p>{projects.length} проектов · {activeCount} в работе · бюджеты сохраняются в валюте проекта</p>
        </div>
        {canCreate ? (
          <Button appearance="primary" icon={<Add24Regular />} onClick={() => {
            setForm(emptyForm(currentUser.id));
            setFormMode("create");
          }}>Новый проект</Button>
        ) : null}
      </header>

      <div className="project-board" aria-label="Стадии проектов">
        {stages.map((stage) => {
          const items = projects.filter((project) => project.stage === stage);
          return (
            <section
              className={`project-column project-stage-${stage}`}
              key={stage}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const project = projects.find((item) => item.id === event.dataTransfer.getData("text/project-id"));
                if (project?.canMove && nextStages[project.stage].includes(stage)) void move(project, stage);
              }}
            >
              <header><strong>{stageLabels[stage]}</strong><Badge appearance="tint">{items.length}</Badge></header>
              <div className="project-stack">
                {items.map((project) => (
                  <button
                    className={`project-card ${project.id === selected?.id ? "selected" : ""}`}
                    draggable={project.canMove}
                    key={project.id}
                    onDragStart={(event) => event.dataTransfer.setData("text/project-id", project.id)}
                    onClick={() => setSelectedId(project.id)}
                    type="button"
                  >
                    <span className="project-code">{project.code}</span>
                    <strong>{project.title}</strong>
                    <small>{personName(project.managerUserId)}</small>
                    <div className="budget-progress"><i style={{ width: `${project.budget ? Math.min(100, project.spentBudget / project.budget * 100) : 0}%` }} /></div>
                    <small>{money(project.spentBudget, project.currency)} из {money(project.budget, project.currency)}</small>
                  </button>
                ))}
                {items.length === 0 ? <p className="empty-column">Перетащите проект сюда</p> : null}
              </div>
            </section>
          );
        })}
      </div>

      {selected !== undefined ? (
        <aside className="bp7-detail">
          <Button className="compact-back" appearance="subtle" onClick={() => setDetailOpen(false)}>К проектам</Button>
          <header>
            <div><span>{selected.code}</span><h2>{selected.title}</h2></div>
            {selected.canEdit ? <Button appearance="subtle" icon={<Edit24Regular />} onClick={() => {
              setForm(projectForm(selected));
              setFormMode("edit");
            }}>Изменить</Button> : null}
          </header>
          <p>{selected.description || "Описание пока не добавлено."}</p>
          {failureId === selected.id ? <DecisionReason title="Причина провала проекта" onCancel={() => setFailureId(undefined)} onConfirm={async (reason) => Boolean(await onMove(selected, "failure", reason))} /> : null}
          <dl className="bp7-facts">
            <div><dt>Руководитель</dt><dd>{personName(selected.managerUserId)}</dd></div>
            <div><dt>Период</dt><dd>{selected.startDate || "—"} — {selected.endDate || "—"}</dd></div>
            <div><dt>Бюджет</dt><dd>{money(selected.budget, selected.currency)}</dd></div>
            <div><dt>Остаток</dt><dd>{money(selected.remainingBudget, selected.currency)}</dd></div>
          </dl>
          {selected.canMove ? (
            <div className="bp7-actions">
              {nextStages[selected.stage].map((stage) => (
                <Button key={stage} icon={<ArrowRight24Regular />} onClick={() => void move(selected, stage)}>
                  {stageLabels[stage]}
                </Button>
              ))}
            </div>
          ) : null}
          <div className="bp7-history">
            <h3>История проекта</h3>
            {[...selected.history].reverse().map((entry) => (
              <div key={entry.id}><i /><p><strong>{stageLabels[entry.toStage]}</strong><span>{personName(entry.actorUserId)} · {new Date(entry.createdAt).toLocaleString("ru-RU")}</span>{entry.comment ? <small>{entry.comment}</small> : null}</p></div>
            ))}
          </div>
        </aside>
      ) : null}

      {formMode !== null ? (
        <div className="bp7-modal-backdrop" role="presentation">
          <form ref={formRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={formMode === "create" ? "Создать проект" : "Изменить проект"} className="bp7-modal" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header><div><span>{formMode === "create" ? "Новая карточка" : "Редактирование"}</span><h2>{formMode === "create" ? "Создать проект" : selected?.title}</h2></div><Button appearance="subtle" onClick={() => setFormMode(null)}>Закрыть</Button></header>
            <div className="bp7-form-grid">
              <label>Код<Input value={form.code} onChange={(_, data) => setForm({ ...form, code: data.value })} /></label>
              <label>Название<Input value={form.title} onChange={(_, data) => setForm({ ...form, title: data.value })} /></label>
              <label>Руководитель<select value={form.managerUserId} onChange={(event) => setForm({ ...form, managerUserId: event.target.value })}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
              <label>Валюта<select value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as ProjectFormState["currency"] })}><option>UZS</option><option>USD</option><option>EUR</option></select></label>
              <label>Начало<Input type="date" value={form.startDate} onChange={(_, data) => setForm({ ...form, startDate: data.value })} /></label>
              <label>Окончание<Input type="date" value={form.endDate} onChange={(_, data) => setForm({ ...form, endDate: data.value })} /></label>
              <label>Бюджет<Input type="number" min="0" value={form.budget} onChange={(_, data) => setForm({ ...form, budget: data.value })} /></label>
              <label>Потрачено<Input type="number" min="0" value={form.spentBudget} onChange={(_, data) => setForm({ ...form, spentBudget: data.value })} /></label>
              <label className="span-two">Описание<Textarea resize="vertical" value={form.description} onChange={(_, data) => setForm({ ...form, description: data.value })} /></label>
            </div>
            <footer><Button onClick={() => setFormMode(null)}>Отмена</Button><Button appearance="primary" type="submit">Сохранить</Button></footer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
