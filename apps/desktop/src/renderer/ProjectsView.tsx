import { useRef, useState } from "react";
import { useModalFocus } from "./useModalFocus";
import { DecisionReason } from "./DecisionReason";
import { RecordComposer, RecordSection, RecordSummary } from "./RecordComposer";
import { SpatialBoard, SpatialCard, SpatialLane } from "./SpatialBoard";
import { Avatar } from "@fluentui/react-components";

import type {
  ProjectInput,
  ProjectStage,
  WorkspacePerson,
  WorkspaceProject,
} from "@yuksalish/contracts";
import { Badge, Button, Input, Textarea } from "@fluentui/react-components";
import { Add24Regular, ArrowRight24Regular, Dismiss20Regular, Edit24Regular } from "@fluentui/react-icons";

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
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const closeForm = () => { if (!savingRef.current) setFormMode(null); };
  useModalFocus(formRef, formMode !== null, closeForm);
  const selected = projects.find((project) => project.id === selectedId) ?? projects[0];
  const canCreate = ["manager", "admin", "superadmin"].includes(currentUser.role);
  const personName = (id: string) => people.find((person) => person.id === id)?.name ?? "Сотрудник";
  const activeCount = projects.filter((project) => project.status !== "completed").length;
  const validBudget = form.budget.trim() !== "" && form.spentBudget.trim() !== ""
    && Number.isSafeInteger(Number(form.budget)) && Number.isSafeInteger(Number(form.spentBudget))
    && Number(form.budget) >= 0 && Number(form.spentBudget) >= 0 && Number(form.spentBudget) <= Number(form.budget);
  const remaining = validBudget ? money(Number(form.budget) - Number(form.spentBudget), form.currency) : "Проверьте суммы";
  const formStage = formMode === "edit" && selected ? selected.stage : "start";

  const save = async () => {
    if (savingRef.current) return;
    const payload = payloadFromForm(form);
    if (payload === undefined || !validBudget) {
      setFormError("Укажите код, название, руководителя и целые неотрицательные суммы. Потрачено не может превышать бюджет."); return;
    }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setFormError("Дата окончания не может быть раньше даты начала."); return;
    }
    savingRef.current = true; setSaving(true); setFormError("");
    try {
      const saved = formMode === "edit" && selected !== undefined ? await onUpdate(selected, payload) : await onCreate(payload);
      if (saved !== undefined) { setSelectedId(saved.id); setFormMode(null); }
      else setFormError("Не удалось сохранить проект. Проверьте подключение и повторите попытку.");
    } catch { setFormError("Не удалось сохранить проект. Введённые данные сохранены в форме."); }
    finally { savingRef.current = false; setSaving(false); }
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
            setFormError("");
            setFormMode("create");
          }}>Новый проект</Button>
        ) : null}
      </header>

      <SpatialBoard canDrop={(id, target) => { const project = projects.find(item => item.id === id); return !!project?.canMove && nextStages[project.stage].includes(target as ProjectStage); }} onPick={id => updateSelectedId(id)} onMove={async (id, target) => { const project = projects.find(item => item.id === id); if (project) await move(project, target as ProjectStage); }}>
      <div className="project-board" aria-label="Стадии проектов">
        {stages.map((stage) => {
          const items = projects.filter((project) => project.stage === stage);
          return (
            <SpatialLane id={stage}
              className={`project-column project-stage-${stage}`}
              key={stage}
            >
              <header><strong>{stageLabels[stage]}</strong><Badge appearance="tint">{items.length}</Badge></header>
              <div className="project-stack">
                {items.map((project) => (
                  <SpatialCard id={project.id} lane={stage} label={project.title} disabled={!project.canMove}
                    className={`project-card ${detailOpen && project.id === selected?.id ? "selected" : ""}`}
                    key={project.id}
                  >
                    <button className="spatial-card-open" type="button" onClick={() => setSelectedId(project.id)}>
                    <span className="project-code">{project.code}</span>
                    <strong>{project.title}</strong>
                    <small className="spatial-person"><Avatar size={24} name={personName(project.managerUserId)} color="colorful" />{personName(project.managerUserId)}</small>
                    <div className="budget-progress"><i style={{ width: `${project.budget ? Math.min(100, project.spentBudget / project.budget * 100) : 0}%` }} /></div>
                    <small>{money(project.spentBudget, project.currency)} из {money(project.budget, project.currency)}</small>
                    </button>
                  </SpatialCard>
                ))}
                {items.length === 0 ? <p className="empty-column">Перетащите проект сюда</p> : null}
              </div>
            </SpatialLane>
          );
        })}
      </div>
      </SpatialBoard>

      {selected !== undefined && detailOpen ? (
        <aside className="bp7-detail spatial-inspector">
          <Button className="project-inspector-close" appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть карточку проекта" onClick={() => setDetailOpen(false)} />
          <header>
            <div><span>{selected.code}</span><h2>{selected.title}</h2></div>
            {selected.canEdit ? <Button appearance="subtle" icon={<Edit24Regular />} onClick={() => {
              setForm(projectForm(selected));
              setFormError("");
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
        <div className="bp7-modal-backdrop record-composer-backdrop" role="presentation">
          <form ref={formRef} noValidate tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="project-composer-title" aria-busy={saving} className="bp7-modal record-composer" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <RecordComposer title={formMode === "create" ? "Создать проект" : "Изменить проект"} titleId="project-composer-title" eyebrow="Список проектов" busy={saving} error={formError} onClose={closeForm} submitLabel="Сохранить"
              hint={formMode === "create" ? "Проект появится в колонке «Начало» после сохранения." : "Изменение полей не меняет стадию проекта."}
              stages={<div className="record-stages" tabIndex={0} role="region" aria-label="Стадии проекта">{stages.map((stage) => <span key={stage} aria-current={stage === formStage ? "step" : undefined}>{stageLabels[stage]}</span>)}</div>}
              aside={<>
                <RecordSummary title="Сводка проекта"><div className="record-summary-title">{form.title.trim() || "Новый проект"}</div><p>{form.code.trim() || "Код ещё не указан"}</p><strong className="record-summary-amount">{remaining}</strong><p>Оставшийся бюджет</p>
                  <dl className="record-summary-facts"><div><dt>Руководитель</dt><dd>{personName(form.managerUserId)}</dd></div><div><dt>Период</dt><dd>{form.startDate || "Не указан"} — {form.endDate || "Не указан"}</dd></div><div><dt>Стадия</dt><dd>{stageLabels[formStage]}</dd></div></dl>
                </RecordSummary>
                <section className="record-summary-card record-summary-note"><h3>{formMode === "create" ? "Карточка ещё не сохранена" : "Редактирование карточки"}</h3><p>{formMode === "create" ? "После сохранения появится история проекта. Стадиями можно управлять на доске и в карточке проекта." : "История проекта и текущая стадия сохранятся. Бюджет и ответственного можно уточнить здесь."}</p></section>
              </>}>
              <RecordSection title="Общее" description="Код и название обязательны. Описание поможет команде понять задачу проекта.">
                <div className="record-field-grid">
                  <label className="record-field-wide">Название проекта<Input aria-label="Название проекта" aria-required value={form.title} placeholder="Например, развитие региональных инициатив" onChange={(_, data) => setForm({ ...form, title: data.value })} /></label>
                  <label className="record-field-wide">Описание проекта<Textarea aria-label="Описание проекта" resize="vertical" value={form.description} onChange={(_, data) => setForm({ ...form, description: data.value })} /></label>
                  <label>Код проекта<Input aria-label="Код проекта" aria-required value={form.code} placeholder="Например, YUK-2026" onChange={(_, data) => setForm({ ...form, code: data.value })} /></label>
                  <label>Статус проекта<output>{stageLabels[formStage]}</output><small>Стадия изменяется отдельно от полей.</small></label>
                </div>
              </RecordSection>
              <RecordSection title="Сроки и ответственность"><div className="record-field-grid">
                <label className="record-field-wide">Руководитель<select aria-label="Руководитель проекта" value={form.managerUserId} onChange={(event) => setForm({ ...form, managerUserId: event.target.value })}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
                <label>Начало<Input aria-label="Начало проекта" type="date" value={form.startDate} onChange={(_, data) => setForm({ ...form, startDate: data.value })} /></label>
                <label>Окончание<Input aria-label="Окончание проекта" type="date" value={form.endDate} onChange={(_, data) => setForm({ ...form, endDate: data.value })} /></label>
              </div></RecordSection>
              <RecordSection title="Бюджет" description="Все суммы — в валюте проекта, целыми единицами."><div className="record-field-grid">
                <label className="record-field-wide">Валюта проекта<select aria-label="Валюта проекта" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as ProjectFormState["currency"] })}><option>UZS</option><option>USD</option><option>EUR</option></select></label>
                <label>Бюджет проекта<Input aria-label="Бюджет проекта" type="number" min="0" value={form.budget} onChange={(_, data) => setForm({ ...form, budget: data.value })} /></label>
                <label>Потрачено<Input aria-label="Потрачено" type="number" min="0" value={form.spentBudget} onChange={(_, data) => setForm({ ...form, spentBudget: data.value })} /></label>
                <label className="record-field-wide">Оставшийся бюджет<output aria-label="Оставшийся бюджет">{remaining}</output><small>Рассчитывается автоматически: бюджет минус потрачено.</small></label>
              </div></RecordSection>
            </RecordComposer>
          </form>
        </div>
      ) : null}
    </section>
  );
}
