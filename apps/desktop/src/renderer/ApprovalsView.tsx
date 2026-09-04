import { useCallback, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { useModalFocus } from "./useModalFocus";

import type {
  ApprovalNodeData,
  ApprovalNodeKind,
  ApprovalRequestSummary,
  PaymentRequestDetails,
  WorkflowDefinition,
  WorkspaceAttachment,
  WorkspacePerson,
  WorkflowPosition,
} from "@yuksalish/contracts";
import {
  Badge,
  Button,
  Input,
  Textarea,
  Tooltip,
} from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowDownload24Regular,
  BranchFork24Regular,
  CheckmarkCircle24Regular,
  CircleEdit24Regular,
  Delete24Regular,
  Money24Regular,
  Save24Regular,
} from "@fluentui/react-icons";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AttachmentPanel, PendingFilePicker } from "./AttachmentPanel";
import type { PaymentRequestInput } from "./workspace-api";
import { approvalColumnTotals, approvalStagePalette } from "./approval-board";
import { AnimatedAmount } from "./AnimatedAmount";

type ApprovalNode = Node<ApprovalNodeData>;
type ApprovalMode = "requests" | "designer";
type ApprovalBoardFilter = "all" | "actionable" | "revision" | "finished";
interface ApprovalEdgeData extends Record<string, unknown> {
  readonly outcome: string;
  readonly condition: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
}
type ApprovalEdge = Edge<ApprovalEdgeData>;

interface ApprovalsViewProps {
  readonly focusRequestId?: string;
  readonly canManage: boolean;
  readonly canCreateRequest: boolean;
  readonly currentUserId: string;
  readonly people: readonly WorkspacePerson[];
  readonly positions: readonly WorkflowPosition[];
  readonly requests: readonly ApprovalRequestSummary[];
  readonly attachments: readonly WorkspaceAttachment[];
  readonly workflow?: WorkflowDefinition;
  readonly onSaveWorkflow: (workflow: WorkflowDefinition) => void | Promise<void>;
  readonly onPublishWorkflow: (
    workflow: WorkflowDefinition,
  ) => WorkflowDefinition | undefined | Promise<WorkflowDefinition | undefined>;
  readonly onCreateRequest: (
    payload: PaymentRequestInput,
    primaryFiles: readonly File[],
    additionalFiles: readonly File[],
  ) => ApprovalRequestSummary | undefined | Promise<ApprovalRequestSummary | undefined>;
  readonly onAction: (
    requestId: string,
    action: "approve" | "reject" | "return" | "clarify" | "delegate" | "resubmit" | "cancel",
    options?: {
      readonly comment?: string;
      readonly nodeKey?: string;
      readonly delegateToUserId?: string;
    },
  ) => void | Promise<void>;
  readonly onReviseRequest: (
    request: ApprovalRequestSummary,
    payload: PaymentRequestInput,
    primaryFiles: readonly File[],
    additionalFiles: readonly File[],
  ) => ApprovalRequestSummary | undefined | Promise<ApprovalRequestSummary | undefined>;
  readonly onUploadAttachments: (
    request: ApprovalRequestSummary,
    files: readonly File[],
    documentRole?: "general" | "primary" | "additional",
  ) => void | Promise<void>;
  readonly onDownloadAttachment: (attachment: WorkspaceAttachment) => void | Promise<void>;
}

const initialNodes: ApprovalNode[] = [
  {
    id: "start",
    position: { x: 40, y: 170 },
    data: { label: "Новая заявка", kind: "start", detail: "Сотрудник отправил форму" },
    className: "workflow-node node-start",
  },
  {
    id: "manager",
    position: { x: 260, y: 80 },
    data: {
      label: "Руководитель отдела",
      kind: "approval",
      detail: "Один согласующий, срок 1 день",
    },
    className: "workflow-node node-approval",
  },
  {
    id: "amount",
    position: { x: 500, y: 80 },
    data: { label: "Сумма выше 50 млн?", kind: "condition", detail: "Поле: amount" },
    className: "workflow-node node-condition",
  },
  {
    id: "finance",
    position: { x: 740, y: 20 },
    data: {
      label: "Финансовый менеджер",
      kind: "approval",
      detail: "Проверка бюджета",
    },
    className: "workflow-node node-approval",
  },
  {
    id: "director",
    position: { x: 740, y: 150 },
    data: { label: "Директор", kind: "approval", detail: "Обязательное решение" },
    className: "workflow-node node-approval",
  },
  {
    id: "approved",
    position: { x: 980, y: 80 },
    data: { label: "Оплата согласована", kind: "end", detail: "Финальный статус" },
    className: "workflow-node node-end",
  },
  {
    id: "correction",
    position: { x: 500, y: 280 },
    data: {
      label: "Вернуть на доработку",
      kind: "correction",
      detail: "Комментарий обязателен",
    },
    className: "workflow-node node-correction",
  },
];

const initialEdges: ApprovalEdge[] = [
  { id: "e1", source: "start", target: "manager", data: { outcome: "submit", condition: {}, sortOrder: 0 }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e2", source: "manager", target: "amount", data: { outcome: "approve", condition: {}, sortOrder: 0 }, markerEnd: { type: MarkerType.ArrowClosed } },
  {
    id: "e3",
    source: "amount",
    target: "finance",
    label: "Да",
    data: { outcome: "true", condition: { field: "amount", operator: "gt", value: 50_000_000 }, sortOrder: 0 },
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e4",
    source: "amount",
    target: "director",
    label: "Нет",
    data: { outcome: "false", condition: { field: "amount", operator: "lte", value: 50_000_000 }, sortOrder: 0 },
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  { id: "e5", source: "finance", target: "director", data: { outcome: "approve", condition: {}, sortOrder: 0 }, markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e6", source: "director", target: "approved", data: { outcome: "approve", condition: {}, sortOrder: 0 }, markerEnd: { type: MarkerType.ArrowClosed } },
  {
    id: "e7",
    source: "manager",
    target: "correction",
    label: "Вернуть",
    data: { outcome: "return", condition: {}, sortOrder: 0 },
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  { id: "e8", source: "correction", target: "start", data: { outcome: "resubmit", condition: {}, sortOrder: 0 }, markerEnd: { type: MarkerType.ArrowClosed } },
];

const kindLabels: Readonly<Record<ApprovalNodeKind, string>> = {
  start: "Старт",
  approval: "Согласование",
  condition: "Условие",
  parallel: "Параллельные ветки",
  correction: "Доработка",
  end: "Завершение",
};

interface PaymentFormState {
  readonly transferType: NonNullable<PaymentRequestDetails["transferType"]> | "";
  readonly projectName: string;
  readonly projectCode: string;
  readonly sourceAccount: string;
  readonly destinationAccount: string;
  readonly requestPriority: "normal" | "urgent";
  readonly deadline: string;
  readonly comment: string;
  readonly tripPurpose: string;
  readonly tripStartDate: string;
  readonly tripEndDate: string;
  readonly employeeIds: readonly string[];
  readonly paymentPurpose: NonNullable<PaymentRequestDetails["paymentPurpose"]> | "";
  readonly paymentReason: string;
  readonly responsibleUserId: string;
}

function emptyPaymentForm(currentUserId: string): PaymentFormState {
  return {
    transferType: "",
    projectName: "",
    projectCode: "",
    sourceAccount: "",
    destinationAccount: "",
    requestPriority: "normal",
    deadline: "",
    comment: "",
    tripPurpose: "",
    tripStartDate: "",
    tripEndDate: "",
    employeeIds: [],
    paymentPurpose: "",
    paymentReason: "",
    responsibleUserId: currentUserId,
  };
}

function formFromDetails(
  details: PaymentRequestDetails,
  responsibleUserId: string,
): PaymentFormState {
  return {
    transferType: details.transferType ?? "",
    projectName: details.projectName,
    projectCode: details.projectCode,
    sourceAccount: details.sourceAccount,
    destinationAccount: details.destinationAccount,
    requestPriority: details.requestPriority,
    deadline: details.deadline?.slice(0, 16) ?? "",
    comment: details.comment,
    tripPurpose: details.tripPurpose,
    tripStartDate: details.tripStartDate ?? "",
    tripEndDate: details.tripEndDate ?? "",
    employeeIds: details.employeeIds,
    paymentPurpose: details.paymentPurpose ?? "",
    paymentReason: details.paymentReason,
    responsibleUserId,
  };
}

function requestPayload(
  title: string,
  amount: number,
  purpose: string,
  form: PaymentFormState,
): PaymentRequestInput {
  return {
    title,
    amount,
    currency: "UZS",
    purpose,
    transferType: form.transferType || null,
    projectName: form.projectName,
    projectCode: form.projectCode,
    sourceAccount: form.sourceAccount,
    destinationAccount: form.destinationAccount,
    requestPriority: form.requestPriority,
    deadline: form.deadline ? new Date(form.deadline).toISOString() : null,
    comment: form.comment,
    tripPurpose: form.tripPurpose,
    tripStartDate: form.tripStartDate || null,
    tripEndDate: form.tripEndDate || null,
    employeeIds: form.employeeIds,
    paymentPurpose: form.paymentPurpose || null,
    paymentReason: form.paymentReason,
    responsibleUserId: form.responsibleUserId,
  };
}

function workflowNodeConfig(data: ApprovalNodeData): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !["label", "kind", "detail"].includes(key)),
  );
}

function flowNodes(workflow?: WorkflowDefinition): ApprovalNode[] {
  if (workflow === undefined) return initialNodes;
  return workflow.nodes.map((node) => ({
    id: node.id,
    position: { x: node.positionX, y: node.positionY },
    data: { ...node.config, label: node.label, kind: node.kind, detail: node.detail },
    className: `workflow-node node-${node.kind}`,
  }));
}

function flowEdges(workflow?: WorkflowDefinition): ApprovalEdge[] {
  if (workflow === undefined) return initialEdges;
  return workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: { outcome: edge.outcome, condition: edge.condition, sortOrder: edge.sortOrder },
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

function latestReturnComment(request: ApprovalRequestSummary): string | undefined {
  return request.actions.slice().reverse().find(
    (action) => action.action === "return" && action.comment?.trim(),
  )?.comment ?? undefined;
}

interface ApprovalBoardColumn {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
}

interface ApprovalAdvancePlan {
  readonly nodeKey: string;
  readonly action: "approve" | "resubmit";
  readonly targetKeys: readonly string[];
}

function approvalBoardColumns(
  workflow: WorkflowDefinition | undefined,
  requests: readonly ApprovalRequestSummary[],
): ApprovalBoardColumn[] {
  const workflowNodes = workflow?.nodes ?? initialNodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    label: node.data.label,
  }));
  const nodeById = new Map(workflowNodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowDefinition["edges"][number][]>();
  for (const edge of workflow?.edges ?? initialEdges.map((edge, index) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    outcome: edge.data?.outcome ?? "approve",
    label: typeof edge.label === "string" ? edge.label : null,
    condition: edge.data?.condition ?? {},
    sortOrder: edge.data?.sortOrder ?? index,
  }))) {
    if (["return", "reject", "resubmit"].includes(edge.outcome)) continue;
    const current = outgoing.get(edge.source) ?? [];
    outgoing.set(edge.source, [...current, edge].sort((left, right) => left.sortOrder - right.sortOrder));
  }

  const ordered: ApprovalBoardColumn[] = [];
  const visited = new Set<string>();
  const visit = (nodeKey: string) => {
    if (visited.has(nodeKey)) return;
    visited.add(nodeKey);
    const node = nodeById.get(nodeKey);
    if (node !== undefined && !["condition", "parallel"].includes(node.kind)) {
      ordered.push({ key: node.id, label: node.label, kind: node.kind });
    }
    for (const edge of outgoing.get(nodeKey) ?? []) visit(edge.target);
  };
  const start = workflowNodes.find((node) => node.kind === "start");
  if (start !== undefined) visit(start.id);
  for (const node of workflowNodes) visit(node.id);

  const runtimeColumns = requests
    .flatMap((request) => request.activeStages)
    .filter((stage, index, stages) =>
      !ordered.some((column) => column.key === stage.key)
      && stages.findIndex((candidate) => candidate.key === stage.key) === index)
    .map((stage) => ({ key: stage.key, label: stage.label, kind: stage.kind }));
  const firstCorrectionOrEnd = ordered.findIndex((column) =>
    ["correction", "end"].includes(column.kind),
  );
  const insertionIndex = firstCorrectionOrEnd === -1 ? ordered.length : firstCorrectionOrEnd;
  ordered.splice(insertionIndex, 0, ...runtimeColumns);

  const regular = ordered.filter((column) => !["correction", "end"].includes(column.kind));
  const corrections = ordered.filter((column) => column.kind === "correction");
  const ends = ordered.filter((column) => column.kind === "end");
  return [...regular, ...corrections, ...ends];
}

function requestBoardColumn(
  request: ApprovalRequestSummary,
  columns: readonly ApprovalBoardColumn[],
): string {
  if (request.status === "approved") {
    return columns.find((column) =>
      column.kind === "end" && !/отмен|отклон/i.test(column.label),
    )?.key ?? columns.at(-1)?.key ?? "";
  }
  if (["rejected", "cancelled"].includes(request.status)) {
    return columns.find((column) =>
      column.kind === "end" && /отмен|отклон/i.test(column.label),
    )?.key ?? columns.at(-1)?.key ?? "";
  }
  if (request.status === "needs_revision") {
    return request.activeStages.find((stage) => stage.kind === "correction")?.key
      ?? columns.find((column) => column.kind === "correction")?.key
      ?? request.activeNodeKeys[0]
      ?? "";
  }
  return request.activeStages.find((stage) => stage.canAct)?.key
    ?? request.activeNodeKeys[0]
    ?? columns.find((column) => column.kind === "start")?.key
    ?? "";
}

function requestConditionValue(request: ApprovalRequestSummary, field: string): unknown {
  if (field === "amount") return request.amount;
  if (field === "currency") return request.currency;
  if (field === "purpose") return request.purpose;
  if (field === "title") return request.title;
  return request.details[field as keyof PaymentRequestDetails];
}

function conditionMatches(
  condition: Readonly<Record<string, unknown>>,
  request: ApprovalRequestSummary,
): boolean {
  const field = String(condition.field ?? "");
  const actual = requestConditionValue(request, field);
  const expected = condition.value;
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (condition.operator === "gt") return actual > expected;
  if (condition.operator === "gte") return actual >= expected;
  if (condition.operator === "lt") return actual < expected;
  if (condition.operator === "lte") return actual <= expected;
  return actual === expected;
}

function resolveVisibleTargets(
  workflow: WorkflowDefinition,
  request: ApprovalRequestSummary,
  source: string,
  outcome: string,
  visited = new Set<string>(),
): string[] {
  const visitKey = `${source}:${outcome}`;
  if (visited.has(visitKey)) return [];
  const nextVisited = new Set(visited).add(visitKey);
  const nodeById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const sortedEdges = workflow.edges
    .filter((edge) => edge.source === source && edge.outcome === outcome)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder);

  const resolveTarget = (targetKey: string, hiddenVisited = new Set<string>()): string[] => {
    if (hiddenVisited.has(targetKey)) return [];
    const nextHiddenVisited = new Set(hiddenVisited).add(targetKey);
    const target = nodeById.get(targetKey);
    if (target === undefined) return [];
    if (target.kind === "start") {
      return resolveVisibleTargets(workflow, request, target.id, "submit", nextVisited);
    }
    if (target.kind === "condition") {
      const branch = workflow.edges
        .filter((edge) => edge.source === target.id)
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .find((edge) => conditionMatches(edge.condition, request));
      return branch === undefined ? [] : resolveTarget(branch.target, nextHiddenVisited);
    }
    if (target.kind === "parallel") {
      return workflow.edges
        .filter((edge) => edge.source === target.id)
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .flatMap((edge) => resolveTarget(edge.target, nextHiddenVisited));
    }
    return [target.id];
  };

  return [...new Set(sortedEdges.flatMap((edge) => resolveTarget(edge.target)))];
}

function approvalAdvancePlan(
  request: ApprovalRequestSummary,
  workflow: WorkflowDefinition | undefined,
  currentUserId: string,
): ApprovalAdvancePlan | undefined {
  if (workflow === undefined || !["running", "needs_revision"].includes(request.status)) {
    return undefined;
  }
  const activeStage = request.status === "needs_revision"
    ? request.activeStages.find((stage) => stage.kind === "correction") ?? request.activeStages[0]
    : request.activeStages.find((stage) => stage.canAct);
  if (activeStage === undefined) return undefined;
  if (
    request.status === "needs_revision"
    && request.requesterId !== currentUserId
    && !activeStage.canAct
  ) return undefined;
  const action = request.status === "needs_revision" ? "resubmit" : "approve";
  const targetKeys = resolveVisibleTargets(workflow, request, activeStage.key, action);
  return targetKeys.length === 0 ? undefined : { nodeKey: activeStage.key, action, targetKeys };
}

const approvalActionLabels: Readonly<Record<string, string>> = {
  approve: "Согласовано",
  reject: "Отклонено",
  return: "Возвращено на доработку",
  clarify: "Запрошено уточнение",
  delegate: "Передано другому сотруднику",
  resubmit: "Повторно отправлено",
  cancel: "Отменено",
};

function formatMoney(amount: number, currency: string): string {
  return `${new Intl.NumberFormat("ru-RU").format(amount)} ${currency}`;
}

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString("ru-RU") : "Не указано";
}

interface PaymentFieldsProps {
  readonly form: PaymentFormState;
  readonly people: readonly WorkspacePerson[];
  readonly onChange: (form: PaymentFormState) => void;
  readonly revision?: boolean;
}

function PaymentFields({ form, people, onChange, revision = false }: PaymentFieldsProps) {
  const update = <Key extends keyof PaymentFormState>(
    key: Key,
    value: PaymentFormState[Key],
  ) => onChange({ ...form, [key]: value });
  const prefix = revision ? "Исправленные " : "";

  return (
    <div className="payment-fields">
      <section className="payment-form-section">
        <header>
          <span>01</span>
          <div>
            <strong>Проект и тип операции</strong>
            <small>Контекст, по которому бухгалтерия идентифицирует платёж</small>
          </div>
        </header>
        <div className="payment-field-grid">
          <label>
            Тип перевода
            <select
              aria-label={`${prefix}тип перевода`}
              value={form.transferType}
              onChange={(event) => update("transferType", event.target.value as PaymentFormState["transferType"])}
            >
              <option value="">Не выбран</option>
              <option value="Гонорар (с расчетом)">Гонорар (с расчетом)</option>
              <option value="Конвертация">Конвертация</option>
              <option value="Другие услуги">Другие услуги</option>
            </select>
          </label>
          <label>
            Приоритет
            <select
              aria-label={`${prefix}приоритет заявки`}
              value={form.requestPriority}
              onChange={(event) => update("requestPriority", event.target.value as PaymentFormState["requestPriority"])}
            >
              <option value="normal">Обычная</option>
              <option value="urgent">Срочная</option>
            </select>
          </label>
          <label>
            Название проекта
            <Input aria-label={`${prefix}название проекта`} value={form.projectName} onChange={(_event, data) => update("projectName", data.value)} />
          </label>
          <label>
            Код проекта
            <Input aria-label={`${prefix}код проекта`} value={form.projectCode} onChange={(_event, data) => update("projectCode", data.value)} />
          </label>
        </div>
      </section>

      <section className="payment-form-section">
        <header>
          <span>02</span>
          <div>
            <strong>Реквизиты платежа</strong>
            <small>Откуда, куда и на каком основании перечисляются средства</small>
          </div>
        </header>
        <div className="payment-field-grid">
          <label>
            Счёт или карта отправителя
            <Input aria-label={`${prefix}счёт или карта отправителя`} value={form.sourceAccount} onChange={(_event, data) => update("sourceAccount", data.value)} />
          </label>
          <label>
            Счёт или карта получателя
            <Input aria-label={`${prefix}счёт или карта получателя`} value={form.destinationAccount} onChange={(_event, data) => update("destinationAccount", data.value)} />
          </label>
          <label>
            Категория платежа
            <select
              aria-label={`${prefix}категория платежа`}
              value={form.paymentPurpose}
              onChange={(event) => update("paymentPurpose", event.target.value as PaymentFormState["paymentPurpose"])}
            >
              <option value="">Не выбрана</option>
              <option value="Мероприятия">Мероприятия</option>
              <option value="Гонорары">Гонорары</option>
              <option value="Зарплаты">Зарплаты</option>
              <option value="Перелеты">Перелеты</option>
              <option value="Оплата за услуги">Оплата за услуги</option>
              <option value="Другие">Другие</option>
            </select>
          </label>
          <label>
            Основание платежа
            <Input aria-label={`${prefix}основание платежа`} value={form.paymentReason} onChange={(_event, data) => update("paymentReason", data.value)} />
          </label>
        </div>
      </section>

      <section className="payment-form-section">
        <header>
          <span>03</span>
          <div>
            <strong>Срок и ответственность</strong>
            <small>Кто сопровождает заявку и к какой дате нужна оплата</small>
          </div>
        </header>
        <div className="payment-field-grid">
          <label>
            Ответственный
            <select aria-label={`${prefix}ответственный за заявку`} value={form.responsibleUserId} onChange={(event) => update("responsibleUserId", event.target.value)}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
              ))}
            </select>
          </label>
          <label>
            Срок оплаты
            <input aria-label={`${prefix}срок оплаты`} type="datetime-local" value={form.deadline} onChange={(event) => update("deadline", event.target.value)} />
          </label>
          <label className="payment-field-wide">
            Комментарий
            <Textarea aria-label={`${prefix}комментарий к заявке`} value={form.comment} onChange={(_event, data) => update("comment", data.value)} />
          </label>
        </div>
      </section>

      <details className="payment-trip-fields">
        <summary>Связать с командировкой <span>необязательно</span></summary>
        <div className="payment-trip-grid">
          <Input aria-label={`${prefix}цель поездки`} placeholder="Цель поездки" value={form.tripPurpose} onChange={(_event, data) => update("tripPurpose", data.value)} />
          <label>
            Начало
            <input aria-label={`${prefix}дата начала поездки`} type="date" value={form.tripStartDate} onChange={(event) => update("tripStartDate", event.target.value)} />
          </label>
          <label>
            Окончание
            <input aria-label={`${prefix}дата окончания поездки`} type="date" value={form.tripEndDate} onChange={(event) => update("tripEndDate", event.target.value)} />
          </label>
          <label className="payment-trip-employees">
            Сотрудники поездки
            <select
              multiple
              aria-label={`${prefix}сотрудники поездки`}
              value={[...form.employeeIds]}
              onChange={(event) => update("employeeIds", Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
              ))}
            </select>
          </label>
        </div>
      </details>
    </div>
  );
}

export function ApprovalsView({
  focusRequestId,
  canManage,
  canCreateRequest,
  currentUserId,
  people,
  positions,
  requests,
  attachments,
  workflow,
  onSaveWorkflow,
  onPublishWorkflow,
  onCreateRequest,
  onAction,
  onReviseRequest,
  onUploadAttachments,
  onDownloadAttachment,
}: ApprovalsViewProps) {
  const [mode, setMode] = useState<ApprovalMode>("requests");
  const [nodes, setNodes, onNodesChange] = useNodesState<ApprovalNode>(flowNodes(workflow));
  const [edges, setEdges, onEdgesChange] = useEdgesState<ApprovalEdge>(flowEdges(workflow));
  const [selectedNodeId, setSelectedNodeId] = useState<string>("amount");
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [creatingRequest, setCreatingRequest] = useState(false);
  const [requestTitle, setRequestTitle] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestPurpose, setRequestPurpose] = useState("");
  const [requestDetails, setRequestDetails] = useState<PaymentFormState>(
    emptyPaymentForm(currentUserId),
  );
  const [requestFiles, setRequestFiles] = useState<readonly File[]>([]);
  const [requestAdditionalFiles, setRequestAdditionalFiles] = useState<readonly File[]>([]);
  const [createError, setCreateError] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState(focusRequestId ?? "");
  const createPanelRef = useRef<HTMLElement>(null);
  const detailPanelRef = useRef<HTMLElement>(null);
  useModalFocus(createPanelRef, creatingRequest, () => setCreatingRequest(false));
  useModalFocus(detailPanelRef, requests.some((request) => request.id === selectedRequestId), () => setSelectedRequestId(""));
  const [boardFilter, setBoardFilter] = useState<ApprovalBoardFilter>("all");
  const [requestQuery, setRequestQuery] = useState("");
  const [draggedRequest, setDraggedRequest] = useState<{
    readonly requestId: string;
    readonly plan: ApprovalAdvancePlan;
  }>();
  const [dropColumnKey, setDropColumnKey] = useState("");
  const [movingRequestId, setMovingRequestId] = useState("");
  const [boardNotice, setBoardNotice] = useState("");
  const [editingRequestId, setEditingRequestId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editDetails, setEditDetails] = useState<PaymentFormState>(
    emptyPaymentForm(currentUserId),
  );
  const [editFiles, setEditFiles] = useState<readonly File[]>([]);
  const [editAdditionalFiles, setEditAdditionalFiles] = useState<readonly File[]>([]);
  const [editError, setEditError] = useState("");
  const [returnRequestId, setReturnRequestId] = useState("");
  const [returnNodeKey, setReturnNodeKey] = useState("");
  const [returnComment, setReturnComment] = useState("");
  const [decision, setDecision] = useState<{
    readonly requestId: string;
    readonly nodeKey: string;
    readonly action: "reject" | "clarify" | "delegate";
  }>();
  const [decisionComment, setDecisionComment] = useState("");
  const [delegateToUserId, setDelegateToUserId] = useState("");

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );
  const boardColumns = useMemo(
    () => approvalBoardColumns(workflow, requests),
    [requests, workflow],
  );
  const filteredRequests = useMemo(() => {
    const query = requestQuery.trim().toLocaleLowerCase("ru-RU");
    return requests.filter((request) => {
      const matchesQuery = !query || [
        request.number,
        request.title,
        request.purpose,
        request.details.projectName,
        request.details.projectCode,
      ].some((value) => value.toLocaleLowerCase("ru-RU").includes(query));
      if (!matchesQuery) return false;
      if (boardFilter === "actionable") {
        return approvalAdvancePlan(request, workflow, currentUserId) !== undefined;
      }
      if (boardFilter === "revision") return request.status === "needs_revision";
      if (boardFilter === "finished") {
        return ["approved", "rejected", "cancelled"].includes(request.status);
      }
      return true;
    });
  }, [boardFilter, currentUserId, requestQuery, requests, workflow]);
  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedRequestId),
    [requests, selectedRequestId],
  );
  const selectedRequestColumn = selectedRequest === undefined
    ? ""
    : requestBoardColumn(selectedRequest, boardColumns);
  const selectedRequestColumnIndex = boardColumns.findIndex(
    (column) => column.key === selectedRequestColumn,
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );

  const connect = useCallback(
    (connection: Connection) => {
      const source = nodes.find((node) => node.id === connection.source);
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            data: {
              outcome: source?.data.kind === "parallel" ? "branch" : "approve",
              condition: {},
              sortOrder: current.filter(
                (edge) => edge.source === connection.source,
              ).length,
            },
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          current,
        ),
      );
      setSaved(false);
    },
    [nodes, setEdges],
  );

  const updateSelected = (data: Partial<ApprovalNodeData>) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, ...data } as ApprovalNodeData }
          : node,
      ),
    );
    setSaved(false);
  };

  const addNode = (kind: ApprovalNodeKind) => {
    const id = `${kind}-${nodes.length + 1}`;
    const data: ApprovalNodeData = {
      label: kindLabels[kind],
      kind,
      detail: "Настройте правило",
    };
    setNodes((current) => [
      ...current,
      {
        id,
        position: { x: 380 + current.length * 18, y: 210 + current.length * 12 },
        data,
        className: `workflow-node node-${kind}`,
      },
    ]);
    setSelectedNodeId(id);
    setSaved(false);
  };

  const removeSelected = () => {
    if (selectedNode === undefined || selectedNode.data.kind === "start") return;
    setNodes((current) => current.filter((node) => node.id !== selectedNode.id));
    setEdges((current) =>
      current.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
    );
    setSelectedNodeId("start");
    setSaved(false);
  };

  const save = async () => {
    if (workflow === undefined) {
      setSaved(true);
      return;
    }
    const definition: WorkflowDefinition = {
      ...workflow,
      nodes: nodes.map((node) => ({
        id: node.id,
        kind: node.data.kind,
        label: node.data.label,
        detail: node.data.detail,
        positionX: node.position.x,
        positionY: node.position.y,
        config: workflowNodeConfig(node.data),
      })),
      edges: edges.map((edge, index) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        outcome: edge.data?.outcome ?? "approve",
        label: typeof edge.label === "string" ? edge.label : null,
        condition: edge.data?.condition ?? {},
        sortOrder: edge.data?.sortOrder ?? index,
      })),
    };
    try {
      await onSaveWorkflow(definition);
      setSaved(true);
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить маршрут");
    }
  };

  const createRequest = async () => {
    const amount = Number(requestAmount.replace(/\s/g, ""));
    if (!requestTitle.trim() || !Number.isFinite(amount) || amount <= 0) {
      setCreateError("Укажите название и положительную сумму заявки");
      return;
    }
    setCreateError("");
    const created = await onCreateRequest(
      requestPayload(requestTitle.trim(), amount, requestPurpose.trim(), requestDetails),
      requestFiles,
      requestAdditionalFiles,
    );
    if (created !== undefined) {
      setRequestTitle("");
      setRequestAmount("");
      setRequestPurpose("");
      setRequestDetails(emptyPaymentForm(currentUserId));
      setRequestFiles([]);
      setRequestAdditionalFiles([]);
      setCreatingRequest(false);
    } else {
      setCreateError("Сервер не подтвердил создание заявки");
    }
  };

  const startRevision = (request: ApprovalRequestSummary) => {
    setEditingRequestId(request.id);
    setEditTitle(request.title);
    setEditAmount(String(request.amount));
    setEditPurpose(request.purpose);
    setEditDetails(formFromDetails(request.details, request.responsibleUserId));
    setEditFiles([]);
    setEditAdditionalFiles([]);
    setEditError("");
  };

  const saveRevision = async (request: ApprovalRequestSummary) => {
    const amount = Number(editAmount.replace(/\s/g, ""));
    if (!editTitle.trim() || !Number.isFinite(amount) || amount <= 0) {
      setEditError("Укажите название и положительную сумму заявки");
      return;
    }
    setEditError("");
    const saved = await onReviseRequest(
      request,
      requestPayload(editTitle.trim(), amount, editPurpose.trim(), editDetails),
      editFiles,
      editAdditionalFiles,
    );
    if (saved !== undefined) setEditingRequestId("");
    else setEditError("Сервер не подтвердил исправленную версию");
  };

  const returnForRevision = async (requestId: string) => {
    if (!returnComment.trim()) return;
    await onAction(requestId, "return", {
      comment: returnComment.trim(),
      nodeKey: returnNodeKey || undefined,
    });
    setReturnRequestId("");
    setReturnNodeKey("");
    setReturnComment("");
  };

  const completeDecision = async () => {
    if (decision === undefined) return;
    if (decision.action === "reject" && !decisionComment.trim()) return;
    if (decision.action === "delegate" && !delegateToUserId) return;
    await onAction(decision.requestId, decision.action, {
      comment: decisionComment.trim() || undefined,
      nodeKey: decision.nodeKey,
      delegateToUserId: decision.action === "delegate" ? delegateToUserId : undefined,
    });
    setDecision(undefined);
    setDecisionComment("");
    setDelegateToUserId("");
  };

  const startDragging = (
    event: ReactDragEvent<HTMLElement>,
    request: ApprovalRequestSummary,
    plan: ApprovalAdvancePlan,
  ) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", request.id);
    setDraggedRequest({ requestId: request.id, plan });
    setBoardNotice("");
  };

  const allowColumnDrop = (
    event: ReactDragEvent<HTMLElement>,
    columnKey: string,
  ) => {
    if (!draggedRequest?.plan.targetKeys.includes(columnKey)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropColumnKey(columnKey);
  };

  const moveRequest = async (columnKey: string) => {
    if (
      draggedRequest === undefined
      || !draggedRequest.plan.targetKeys.includes(columnKey)
    ) return;
    const request = requests.find((item) => item.id === draggedRequest.requestId);
    const target = boardColumns.find((column) => column.key === columnKey);
    if (request === undefined || target === undefined) return;
    setMovingRequestId(request.id);
    setDropColumnKey("");
    try {
      await onAction(request.id, draggedRequest.plan.action, {
        nodeKey: draggedRequest.plan.nodeKey,
        comment: `Переход на этап «${target.label}» выполнен с доски`,
      });
      setBoardNotice(
        `Заявка №${request.number}: сервер обработал переход на этап «${target.label}»`,
      );
    } finally {
      setMovingRequestId("");
      setDraggedRequest(undefined);
    }
  };

  const publish = async () => {
    if (workflow === undefined || !saved) return;
    const nextDraft = await onPublishWorkflow(workflow);
    if (nextDraft !== undefined) {
      setNodes(flowNodes(nextDraft));
      setEdges(flowEdges(nextDraft));
      setSaved(true);
      setSaveError("");
    }
  };

  return (
    <section className="workspace-view approvals-view" aria-label="Согласования">
      <header className="section-toolbar approvals-toolbar">
        <div>
          <h1>{mode === "requests" ? "Заявки на оплату" : "Маршрут согласования"}</h1>
          <p>
            {mode === "requests"
              ? "Рабочая очередь по стадиям — от запуска до оплаты"
              : "Настройка логики процесса без изменения кода"}
          </p>
        </div>
        <div className="toolbar-actions">
          {mode === "requests" ? (
            <Button
              appearance="primary"
              icon={<Add24Regular />}
              disabled={!canCreateRequest}
              onClick={() => {
                setCreateError("");
                setCreatingRequest(true);
              }}
            >
              Новая заявка
            </Button>
          ) : (
            <>
              <Badge appearance="tint" color={saveError ? "danger" : saved ? "success" : "warning"}>
                {saveError || (saved ? "Черновик сохранён" : "Есть изменения")}
              </Badge>
              <Button
                appearance="primary"
                icon={<Save24Regular />}
                disabled={!canManage}
                onClick={() => void save()}
              >
                Сохранить
              </Button>
              <Button
                appearance="secondary"
                disabled={!canManage || !saved || workflow?.status !== "draft"}
                onClick={() => void publish()}
              >
                Опубликовать v{workflow?.version ?? "—"}
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="approvals-tabs">
        <div className="approval-mode-switch" aria-label="Разделы согласований">
          <button
            type="button"
            aria-pressed={mode === "requests"}
            className={mode === "requests" ? "active" : ""}
            onClick={() => setMode("requests")}
          >
            Текущие заявки
          </button>
          <button
            type="button"
            aria-pressed={mode === "designer"}
            className={mode === "designer" ? "active" : ""}
            disabled={!canManage}
            onClick={() => setMode("designer")}
          >
            Конструктор маршрутов
          </button>
        </div>
      </div>

      {mode === "requests" ? (
        <div className="approval-workspace">
          <div className="approval-commandbar">
            <div className="approval-metrics" aria-label="Сводка заявок">
              <span><strong>{requests.filter((request) => request.status === "running").length}</strong> в работе</span>
              <span><strong>{requests.filter((request) => request.status === "needs_revision").length}</strong> на доработке</span>
              <span><strong>{requests.filter((request) => request.status === "approved").length}</strong> оплачено</span>
            </div>
            <Input
              className="approval-search"
              aria-label="Поиск заявок"
              placeholder="Номер, название или проект"
              value={requestQuery}
              onChange={(_event, data) => setRequestQuery(data.value)}
            />
            <div className="approval-board-filters" aria-label="Фильтр заявок">
              {([
                ["all", "Все"],
                ["actionable", "Нужно моё решение"],
                ["revision", "Доработка"],
                ["finished", "Завершённые"],
              ] as const).map(([filter, label]) => (
                <button
                  key={filter}
                  type="button"
                  className={boardFilter === filter ? "active" : ""}
                  aria-pressed={boardFilter === filter}
                  onClick={() => setBoardFilter(filter)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!canCreateRequest ? (
            <div className="request-create-policy">Ваша должность не может создавать заявки на оплату</div>
          ) : null}
          {boardNotice ? <div className="approval-board-notice" role="status">{boardNotice}</div> : null}

          <div className="approval-kanban" aria-label="Доска заявок по стадиям">
            {boardColumns.map((column) => {
              const columnRequests = filteredRequests.filter((request) =>
                requestBoardColumn(request, boardColumns) === column.key,
              );
              const isAllowedDrop = draggedRequest?.plan.targetKeys.includes(column.key) ?? false;
              const palette = approvalStagePalette(column);
              const totals = approvalColumnTotals(columnRequests);
              return (
                <section
                  key={column.key}
                  data-stage-key={column.key}
                  className={`approval-column column-${column.kind}${isAllowedDrop ? " drop-allowed" : ""}${dropColumnKey === column.key ? " drop-active" : ""}`}
                  style={{ "--approval-stage-color": palette.background, "--approval-stage-ink": palette.foreground } as CSSProperties}
                  aria-label={`${column.label}: ${columnRequests.length} заявок`}
                  onDragEnter={(event) => allowColumnDrop(event, column.key)}
                  onDragOver={(event) => allowColumnDrop(event, column.key)}
                  onDragLeave={() => setDropColumnKey((current) => current === column.key ? "" : current)}
                  onDrop={(event) => {
                    event.preventDefault();
                    void moveRequest(column.key);
                  }}
                >
                  <header>
                    <strong title={column.label}>{column.label}</strong>
                    <span className="approval-column-count" aria-label={`${columnRequests.length} заявок`}>{columnRequests.length}</span>
                  </header>
                  <div className="approval-column-total" aria-label={`Сумма в колонке «${column.label}»`} title="Сумма заявок, показанных в этой колонке с текущими фильтрами. Разные валюты считаются отдельно.">
                    <span>Сумма в колонке</span>
                    {totals.map((total) => <AnimatedAmount key={total.currency} currency={total.currency} minorUnits={total.minorUnits} />)}
                  </div>
                  <div className="approval-column-stack">
                    {columnRequests.map((request) => {
                      const plan = approvalAdvancePlan(request, workflow, currentUserId);
                      const requestAttachments = attachments.filter((attachment) =>
                        attachment.ownerType === "approval_request" && attachment.ownerId === request.id,
                      ).length;
                      return (
                        <article
                          key={request.id}
                          className={`approval-board-card${plan ? " movable" : ""}${movingRequestId === request.id ? " moving" : ""}`}
                          draggable={plan !== undefined && movingRequestId !== request.id}
                          onDragStart={(event) => {
                            if (plan !== undefined) startDragging(event, request, plan);
                          }}
                          onDragEnd={() => {
                            setDraggedRequest(undefined);
                            setDropColumnKey("");
                          }}
                        >
                          <button
                            type="button"
                            className="approval-card-open"
                            aria-label={`Открыть заявку №${request.number}: ${request.title}`}
                            onClick={() => setSelectedRequestId(request.id)}
                          >
                            <span className="approval-card-topline">
                              <span>№{request.number}</span>
                              {request.details.requestPriority === "urgent" ? <em>Срочно</em> : null}
                            </span>
                            <strong>{request.title}</strong>
                            <span className="approval-card-amount">{formatMoney(request.amount, request.currency)}</span>
                            <span className="approval-card-project">
                              {request.details.projectName || "Без проекта"}
                              {request.details.projectCode ? ` · ${request.details.projectCode}` : ""}
                            </span>
                            <span className="approval-card-version">
                              Версия {request.revision}{request.sourceTaskId ? " · создана из задачи" : ""}
                            </span>
                            <span className="approval-card-meta">
                              <span>{request.details.deadline ? `до ${formatDateTime(request.details.deadline)}` : "срок не указан"}</span>
                              <span>{requestAttachments} файл.</span>
                            </span>
                          </button>
                          {request.activeStages.length > 1 ? (
                            <span className="approval-parallel-note">Параллельно ещё {request.activeStages.length - 1}</span>
                          ) : null}
                          {request.status === "needs_revision" && latestReturnComment(request) ? (
                            <span className="approval-return-note">{latestReturnComment(request)}</span>
                          ) : null}
                          <footer>
                            {plan ? (
                              <span className="approval-move-hint">
                                Перетащите → {plan.targetKeys.map((targetKey) =>
                                  boardColumns.find((candidate) => candidate.key === targetKey)?.label,
                                ).filter(Boolean).join(" / ")}
                              </span>
                            ) : (
                              <span>{request.statusLabel}</span>
                            )}
                            {request.status === "needs_revision" && (
                              request.requesterId === currentUserId
                              || request.activeStages.some((stage) => stage.canAct)
                            ) ? (
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => {
                                  setSelectedRequestId(request.id);
                                  startRevision(request);
                                }}
                              >
                                Исправить заявку
                              </Button>
                            ) : null}
                          </footer>
                        </article>
                      );
                    })}
                    {columnRequests.length === 0 ? (
                      <div className="approval-column-empty">
                        {isAllowedDrop ? "Отпустите карточку здесь" : "Нет заявок"}
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
            {filteredRequests.length === 0 ? (
              <div className="approval-board-empty">
                <Money24Regular />
                <strong>{requests.length === 0 ? "Заявок пока нет" : "По фильтру ничего не найдено"}</strong>
                <span>{requests.length === 0 ? "Создайте первую заявку — маршрут назначит следующий этап автоматически." : "Измените поиск или фильтр."}</span>
              </div>
            ) : null}
          </div>

          {creatingRequest ? (
            <div
              className="approval-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setCreatingRequest(false);
              }}
            >
              <section ref={createPanelRef} tabIndex={-1} className="approval-create-panel" role="dialog" aria-modal="true" aria-labelledby="approval-create-title">
                <header>
                  <div>
                    <span>Новая заявка</span>
                    <h2 id="approval-create-title">Подготовить оплату</h2>
                    <p>Заполните известные реквизиты. История начнётся после отправки.</p>
                  </div>
                  <button type="button" aria-label="Закрыть форму создания" onClick={() => setCreatingRequest(false)}>×</button>
                </header>
                <div className="approval-create-scroll">
                  <section className="payment-form-section payment-form-lead">
                    <header>
                      <span>00</span>
                      <div>
                        <strong>Что оплачиваем</strong>
                        <small>Название и сумма обязательны для запуска маршрута</small>
                      </div>
                    </header>
                    <div className="payment-field-grid">
                      <label>
                        Название заявки <b>обязательно</b>
                        <Input
                          aria-label="Название заявки"
                          aria-invalid={Boolean(createError && !requestTitle.trim())}
                          placeholder="Например, оплата услуг подрядчика"
                          value={requestTitle}
                          onChange={(_event, data) => setRequestTitle(data.value)}
                        />
                      </label>
                      <label>
                        Сумма в UZS <b>обязательно</b>
                        <Input
                          aria-label="Сумма заявки"
                          aria-invalid={Boolean(createError && Number(requestAmount.replace(/\s/g, "")) <= 0)}
                          inputMode="numeric"
                          placeholder="0"
                          value={requestAmount}
                          onChange={(_event, data) => setRequestAmount(data.value)}
                        />
                      </label>
                      <label className="payment-field-wide">
                        Назначение платежа
                        <Textarea
                          aria-label="Назначение платежа"
                          placeholder="Кому, за что и почему платим"
                          value={requestPurpose}
                          onChange={(_event, data) => setRequestPurpose(data.value)}
                        />
                      </label>
                    </div>
                  </section>
                  <PaymentFields form={requestDetails} people={people} onChange={setRequestDetails} />
                  <section className="payment-form-section approval-documents-section">
                    <header>
                      <span>04</span>
                      <div>
                        <strong>Документы</strong>
                        <small>Основные файлы фиксируются в версии заявки, дополнительные остаются отдельно</small>
                      </div>
                    </header>
                    <PendingFilePicker files={requestFiles} onChange={setRequestFiles} label="Основные документы" />
                    <PendingFilePicker files={requestAdditionalFiles} onChange={setRequestAdditionalFiles} label="Дополнительные документы" />
                  </section>
                  {createError ? <div className="approval-form-error" role="alert">{createError}</div> : null}
                </div>
                <footer>
                  <span>После отправки заявку увидит исполнитель первой стадии</span>
                  <Button appearance="subtle" onClick={() => setCreatingRequest(false)}>Отмена</Button>
                  <Button appearance="primary" onClick={() => void createRequest()}>Отправить по маршруту</Button>
                </footer>
              </section>
            </div>
          ) : null}

          {selectedRequest ? (
            <div
              className="approval-overlay approval-detail-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setSelectedRequestId("");
              }}
            >
              <article ref={detailPanelRef} tabIndex={-1} className="approval-detail-panel" role="dialog" aria-modal="true" aria-labelledby="approval-detail-title">
                <header className="approval-detail-header">
                  <div>
                    <span>Заявка №{selectedRequest.number} · версия {selectedRequest.revision}</span>
                    <h2 id="approval-detail-title">{selectedRequest.title}</h2>
                  </div>
                  <Badge
                    appearance="tint"
                    color={selectedRequest.status === "approved" ? "success" : selectedRequest.status === "rejected" ? "danger" : selectedRequest.status === "needs_revision" ? "warning" : "brand"}
                  >
                    {selectedRequest.statusLabel}
                  </Badge>
                  <button type="button" aria-label="Закрыть карточку заявки" onClick={() => setSelectedRequestId("")}>×</button>
                </header>

                <div className="approval-stage-ribbon" role="region" tabIndex={0} aria-label="Стадии заявки">
                  {boardColumns.map((column, index) => (
                    <span
                      key={column.key}
                      className={
                        column.key === selectedRequestColumn
                          ? "current"
                          : selectedRequest.status === "approved" || (selectedRequestColumnIndex >= 0 && index < selectedRequestColumnIndex)
                            ? "passed"
                            : ""
                      }
                    >
                      {column.label}
                    </span>
                  ))}
                </div>

                <div className="approval-detail-content">
                  <section className="approval-detail-facts">
                    <div className="approval-amount-block">
                      <span>К перечислению</span>
                      <strong>{formatMoney(selectedRequest.amount, selectedRequest.currency)}</strong>
                      <small>{selectedRequest.details.requestPriority === "urgent" ? "Срочный платёж" : "Обычный приоритет"}</small>
                    </div>
                    {selectedRequest.status === "needs_revision" && latestReturnComment(selectedRequest) ? (
                      <div className="approval-detail-return">
                        <strong>Что нужно исправить</strong>
                        <span>{latestReturnComment(selectedRequest)}</span>
                      </div>
                    ) : null}
                    <section className="approval-fact-section">
                      <h3>Информация по заявке</h3>
                      <dl>
                        <div><dt>Назначение</dt><dd>{selectedRequest.purpose || "Не указано"}</dd></div>
                        <div><dt>Тип перевода</dt><dd>{selectedRequest.details.transferType || "Не выбран"}</dd></div>
                        <div><dt>Проект</dt><dd>{selectedRequest.details.projectName || "Не указан"}</dd></div>
                        <div><dt>Код проекта</dt><dd>{selectedRequest.details.projectCode || "Не указан"}</dd></div>
                        <div><dt>Категория</dt><dd>{selectedRequest.details.paymentPurpose || "Не выбрана"}</dd></div>
                        <div><dt>Основание</dt><dd>{selectedRequest.details.paymentReason || "Не указано"}</dd></div>
                        <div><dt>Со счёта</dt><dd>{selectedRequest.details.sourceAccount || "Не указан"}</dd></div>
                        <div><dt>На счёт</dt><dd>{selectedRequest.details.destinationAccount || "Не указан"}</dd></div>
                        <div><dt>Срок оплаты</dt><dd>{formatDateTime(selectedRequest.details.deadline)}</dd></div>
                        <div><dt>Комментарий</dt><dd>{selectedRequest.details.comment || "Нет комментария"}</dd></div>
                      </dl>
                    </section>
                    <section className="approval-fact-section">
                      <h3>Ответственные</h3>
                      <dl>
                        <div><dt>Инициатор</dt><dd>{peopleById.get(selectedRequest.requesterId)?.name ?? "Сотрудник"}</dd></div>
                        <div><dt>Ответственный</dt><dd>{peopleById.get(selectedRequest.responsibleUserId)?.name ?? "Сотрудник"}</dd></div>
                        <div><dt>Текущий этап</dt><dd>{selectedRequest.stageLabel}</dd></div>
                        <div><dt>Создана</dt><dd>{formatDateTime(selectedRequest.createdAt)}</dd></div>
                      </dl>
                    </section>
                    <section className="approval-fact-section approval-detail-files">
                      <AttachmentPanel
                        title="Основные документы"
                        attachments={attachments.filter((attachment) =>
                          attachment.ownerType === "approval_request"
                          && attachment.ownerId === selectedRequest.id
                          && ["primary", "general"].includes(attachment.documentRole),
                        )}
                        canUpload={(selectedRequest.requesterId === currentUserId && ["running", "needs_revision"].includes(selectedRequest.status)) || (selectedRequest.status === "needs_revision" && selectedRequest.activeStages.some((stage) => stage.canAct))}
                        onUpload={(files) => onUploadAttachments(selectedRequest, files, "primary")}
                        onDownload={onDownloadAttachment}
                      />
                      <AttachmentPanel
                        title="Дополнительные документы"
                        attachments={attachments.filter((attachment) =>
                          attachment.ownerType === "approval_request"
                          && attachment.ownerId === selectedRequest.id
                          && attachment.documentRole === "additional",
                        )}
                        canUpload={(selectedRequest.requesterId === currentUserId && ["running", "needs_revision"].includes(selectedRequest.status)) || (selectedRequest.status === "needs_revision" && selectedRequest.activeStages.some((stage) => stage.canAct))}
                        onUpload={(files) => onUploadAttachments(selectedRequest, files, "additional")}
                        onDownload={onDownloadAttachment}
                      />
                    </section>
                  </section>

                  <aside className="approval-detail-process">
                    {selectedRequest.status === "running" && selectedRequest.activeStages.some((stage) => stage.canAct) ? (
                      <section className="approval-decision-block">
                        <span>Нужно ваше решение</span>
                        {selectedRequest.activeStages.filter((stage) => stage.canAct).map((stage) => (
                          <div key={stage.key}>
                            <strong>{stage.label}</strong>
                            <div>
                              <Button appearance="primary" onClick={() => void onAction(selectedRequest.id, "approve", { nodeKey: stage.key })}>Согласовать</Button>
                              <Button appearance="subtle" onClick={() => { setReturnRequestId(selectedRequest.id); setReturnNodeKey(stage.key); }}>Вернуть</Button>
                              <Button appearance="subtle" onClick={() => setDecision({ requestId: selectedRequest.id, nodeKey: stage.key, action: "reject" })}>Отклонить</Button>
                              <Button appearance="subtle" onClick={() => setDecision({ requestId: selectedRequest.id, nodeKey: stage.key, action: "clarify" })}>Уточнить</Button>
                              <Button appearance="subtle" onClick={() => setDecision({ requestId: selectedRequest.id, nodeKey: stage.key, action: "delegate" })}>Делегировать</Button>
                            </div>
                          </div>
                        ))}
                      </section>
                    ) : null}
                    {selectedRequest.status === "needs_revision" && (selectedRequest.requesterId === currentUserId || selectedRequest.activeStages.some((stage) => stage.canAct)) && editingRequestId !== selectedRequest.id ? (
                      <Button appearance="primary" onClick={() => startRevision(selectedRequest)}>Исправить заявку</Button>
                    ) : null}
                    {returnRequestId === selectedRequest.id ? (
                      <div className="request-inline-editor return-editor">
                        <Textarea autoFocus aria-label={`Причина возврата заявки ${selectedRequest.number}`} placeholder="Что нужно исправить?" value={returnComment} onChange={(_event, data) => setReturnComment(data.value)} />
                        <Button appearance="primary" disabled={!returnComment.trim()} onClick={() => void returnForRevision(selectedRequest.id)}>Подтвердить возврат</Button>
                        <Button appearance="subtle" onClick={() => setReturnRequestId("")}>Отмена</Button>
                      </div>
                    ) : null}
                    {decision?.requestId === selectedRequest.id ? (
                      <div className="request-inline-editor decision-editor">
                        {decision.action === "delegate" ? (
                          <select aria-label={`Новый согласующий заявки ${selectedRequest.number}`} value={delegateToUserId} onChange={(event) => setDelegateToUserId(event.target.value)}>
                            <option value="">Выберите сотрудника</option>
                            {people.filter((person) => person.id !== currentUserId).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>)}
                          </select>
                        ) : null}
                        <Textarea aria-label={`Комментарий решения по заявке ${selectedRequest.number}`} placeholder={decision.action === "reject" ? "Причина отклонения обязательна" : "Комментарий"} value={decisionComment} onChange={(_event, data) => setDecisionComment(data.value)} />
                        <Button appearance="primary" disabled={(decision.action === "reject" && !decisionComment.trim()) || (decision.action === "delegate" && !delegateToUserId)} onClick={() => void completeDecision()}>Подтвердить</Button>
                        <Button appearance="subtle" onClick={() => setDecision(undefined)}>Отмена</Button>
                      </div>
                    ) : null}
                    {editingRequestId === selectedRequest.id ? (
                      <section className="approval-revision-editor" aria-label="Редактирование возвращённой заявки">
                        <h3>Исправленная версия</h3>
                        <label>Название<Input aria-label="Исправленное название заявки" value={editTitle} onChange={(_event, data) => setEditTitle(data.value)} /></label>
                        <label>Сумма<Input aria-label="Исправленная сумма заявки" inputMode="numeric" value={editAmount} onChange={(_event, data) => setEditAmount(data.value)} /></label>
                        <label>Назначение<Textarea aria-label="Исправленное назначение платежа" value={editPurpose} onChange={(_event, data) => setEditPurpose(data.value)} /></label>
                        <PaymentFields form={editDetails} people={people} onChange={setEditDetails} revision />
                        <PendingFilePicker files={editFiles} onChange={setEditFiles} label="Добавить исправленные документы" />
                        <PendingFilePicker files={editAdditionalFiles} onChange={setEditAdditionalFiles} label="Добавить дополнительные документы" />
                        {editError ? <div className="approval-form-error" role="alert">{editError}</div> : null}
                        <div className="approval-revision-actions">
                          <Button appearance="primary" onClick={() => void saveRevision(selectedRequest)}>Сохранить и отправить повторно</Button>
                          <Button appearance="subtle" onClick={() => setEditingRequestId("")}>Отмена</Button>
                        </div>
                      </section>
                    ) : null}

                    <section className="approval-timeline">
                      <header><span>Ход согласования</span><strong>{selectedRequest.actions.length + 1} событий</strong></header>
                      <div className="approval-timeline-event">
                        <i />
                        <div><strong>Заявка создана</strong><span>{peopleById.get(selectedRequest.requesterId)?.name ?? "Сотрудник"}</span><time>{formatDateTime(selectedRequest.createdAt)}</time></div>
                      </div>
                      {selectedRequest.actions.map((action, index) => (
                        <div key={`${action.createdAt}-${action.nodeKey}-${index}`} className="approval-timeline-event">
                          <i />
                          <div>
                            <strong>{approvalActionLabels[action.action] ?? action.action}</strong>
                            <span>{peopleById.get(action.actorUserId)?.name ?? "Сотрудник"} · {boardColumns.find((column) => column.key === action.nodeKey)?.label ?? action.nodeKey}</span>
                            {action.comment ? <p>{action.comment}</p> : null}
                            <time>{formatDateTime(action.createdAt)}</time>
                          </div>
                        </div>
                      ))}
                    </section>
                    <section className="approval-version-list" aria-label={`История версий заявки ${selectedRequest.number}`}>
                      <h3>Версии</h3>
                      {selectedRequest.versions.slice().reverse().map((version) => (
                        <div key={version.version}>
                          <strong>v{version.version} · {formatMoney(version.amount, version.currency)}</strong>
                          <span>{version.changeReason === "initial" ? "Создание" : version.changeReason === "attachment_added" ? "Добавлен файл" : "Исправление"}{version.changeComment ? ` · ${version.changeComment}` : ""}</span>
                        </div>
                      ))}
                    </section>
                    {selectedRequest.requesterId === currentUserId && ["draft", "running", "needs_revision"].includes(selectedRequest.status) ? (
                      <Button appearance="subtle" onClick={() => void onAction(selectedRequest.id, "cancel", { comment: "Отменено автором" })}>Отменить заявку</Button>
                    ) : null}
                  </aside>
                </div>
              </article>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="workflow-layout">
          <aside className="workflow-library">
            <div>
              <span className="detail-kicker">Шаблон</span>
              <h2>{workflow?.name ?? "Заявка на оплату"}</h2>
              <p>
                Черновик v{workflow?.version ?? "—"} · опубликована v{workflow?.publishedVersion ?? "—"}
              </p>
            </div>
            <div className="node-library">
              <strong>Добавить элемент</strong>
              <Button appearance="subtle" icon={<CheckmarkCircle24Regular />} onClick={() => addNode("approval")}>
                Согласование
              </Button>
              <Button appearance="subtle" icon={<BranchFork24Regular />} onClick={() => addNode("condition")}>
                Условие
              </Button>
              <Button appearance="subtle" icon={<Add24Regular />} onClick={() => addNode("parallel")}>
                Параллельные ветки
              </Button>
              <Button appearance="subtle" icon={<ArrowDownload24Regular />} onClick={() => addNode("correction")}>
                Доработка
              </Button>
            </div>
            <div className="workflow-help">
              Перетаскивайте блоки и соединяйте точки на их границах. Положение блока не меняет правило исполнения.
            </div>
          </aside>

          <div className="workflow-canvas" aria-label="Дерево согласования заявки на оплату">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={() => setSaved(false)}
              onConnect={connect}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.45}
              maxZoom={1.6}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c7d2df" />
              <MiniMap pannable zoomable nodeColor="#d9e8f6" maskColor="rgba(245, 247, 250, .74)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <aside className="workflow-inspector">
            {selectedNode === undefined ? (
              <div className="empty-compact">Выберите блок на схеме</div>
            ) : (
              <>
                <div className="inspector-heading">
                  <CircleEdit24Regular />
                  <div><strong>Настройка блока</strong><span>{kindLabels[selectedNode.data.kind]}</span></div>
                </div>
                <label>
                  Название
                  <Input
                    value={selectedNode.data.label}
                    onChange={(_event, data) => updateSelected({ label: data.value })}
                  />
                </label>
                <label>
                  Правило или исполнитель
                  <Textarea
                    resize="vertical"
                    value={selectedNode.data.detail}
                    onChange={(_event, data) => updateSelected({ detail: data.value })}
                  />
                </label>
                <label>
                  Тип блока
                  <select
                    value={selectedNode.data.kind}
                    onChange={(event) => updateSelected({ kind: event.target.value as ApprovalNodeKind })}
                  >
                    {Object.entries(kindLabels).map(([kind, label]) => (
                      <option key={kind} value={kind}>{label}</option>
                    ))}
                  </select>
                </label>
                {selectedNode.data.kind === "approval" ? (
                  <>
                    <label>
                      Должность согласующего
                      <select
                        value={String(selectedNode.data.approverPositionId ?? "")}
                        onChange={(event) => updateSelected({
                          approverPositionId: event.target.value || undefined,
                          approverUserId: undefined,
                        })}
                      >
                        <option value="">Определяется ролью</option>
                        {positions.map((position) => (
                          <option key={position.id} value={position.id}>{position.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Роль согласующего, если должность не выбрана
                      <select
                        value={String(selectedNode.data.approverRole ?? "manager")}
                        onChange={(event) => updateSelected({ approverRole: event.target.value })}
                      >
                        <option value="manager">Руководитель</option>
                        <option value="admin">Администратор</option>
                        <option value="superadmin">Суперадминистратор</option>
                        <option value="employee">Сотрудник</option>
                      </select>
                    </label>
                    <label>
                      Конкретный сотрудник
                      <select
                        value={String(selectedNode.data.approverUserId ?? "")}
                        onChange={(event) => updateSelected({
                          approverUserId: event.target.value || undefined,
                          approverPositionId: undefined,
                        })}
                      >
                        <option value="">Определяется ролью</option>
                        {people.map((person) => (
                          <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
                {selectedNode.data.kind === "start" || selectedNode.data.kind === "correction" ? (
                  <label>
                    {selectedNode.data.kind === "start"
                      ? "Должности, которые создают заявки"
                      : "Должности, которые выводят из доработки"}
                    <select
                      multiple
                      value={(
                        selectedNode.data.kind === "start"
                          ? selectedNode.data.creatorPositionIds
                          : selectedNode.data.approverPositionIds
                      ) as string[] | undefined}
                      onChange={(event) => {
                        const values = Array.from(
                          event.currentTarget.selectedOptions,
                          (option) => option.value,
                        );
                        updateSelected(
                          selectedNode.data.kind === "start"
                            ? { creatorPositionIds: values }
                            : { approverPositionIds: values },
                        );
                      }}
                    >
                      {positions.map((position) => (
                        <option key={position.id} value={position.id}>{position.name}</option>
                      ))}
                    </select>
                    <small>Ctrl позволяет выбрать несколько должностей</small>
                  </label>
                ) : null}
                {selectedNode.data.kind === "parallel" ? (
                  <label>
                    Завершение параллельных веток
                    <select
                      value={String(selectedNode.data.decisionMode ?? "all")}
                      onChange={(event) => updateSelected({ decisionMode: event.target.value })}
                    >
                      <option value="all">Нужны решения всех</option>
                      <option value="any">Достаточно одного решения</option>
                    </select>
                  </label>
                ) : null}
                <Tooltip content="Стартовый блок удалить нельзя" relationship="description">
                  <Button
                    appearance="subtle"
                    icon={<Delete24Regular />}
                    disabled={selectedNode.data.kind === "start"}
                    onClick={removeSelected}
                  >
                    Удалить блок
                  </Button>
                </Tooltip>
              </>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
