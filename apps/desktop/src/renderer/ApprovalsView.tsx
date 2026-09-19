import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useModalFocus } from "./useModalFocus";
import { RecordComposer, RecordSummary } from "./RecordComposer";
import { SpatialBoard, SpatialCard, SpatialLane } from "./SpatialBoard";
import { WorkspaceSelect } from "./WorkspaceSelect";

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
  Avatar,
  Badge,
  Button,
  Input,
  Textarea,
  Tooltip,
} from "@fluentui/react-components";
import {
  Add24Regular,
  ArrowDownload24Regular,
  ArrowRedo24Regular,
  ArrowUndo24Regular,
  Attach16Regular,
  BranchFork24Regular,
  CheckmarkCircle24Regular,
  CircleEdit24Regular,
  Clock16Regular,
  Delete24Regular,
  Dismiss24Regular,
  Money24Regular,
  Open16Regular,
  Save24Regular,
} from "@fluentui/react-icons";
import {
  addEdge,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { AttachmentPanel, PendingFilePicker } from "./AttachmentPanel";
import type { PaymentRequestInput } from "./workspace-api";
import {
  approvalCardStatusPresentation,
  approvalColumnTotals,
  approvalDeadlinePresentation,
  approvalRequestIsOverdue,
  approvalRequestNeedsAction,
  approvalStagePalette,
} from "./approval-board";
import { AnimatedAmount } from "./AnimatedAmount";
import { AnimatedInteger } from "./AnimatedInteger";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

type ApprovalNode = Node<ApprovalNodeData>;
type ApprovalMode = "requests" | "designer";
type ApprovalBoardFilter = "all" | "actionable" | "revision" | "finished";
type ApprovalDetailTab = "overview" | "route" | "files" | "activity";
interface ApprovalEdgeData extends Record<string, unknown> {
  readonly outcome: string;
  readonly condition: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
}
type ApprovalEdge = Edge<ApprovalEdgeData>;

interface WorkflowSnapshot {
  readonly nodes: readonly ApprovalNode[];
  readonly edges: readonly ApprovalEdge[];
  readonly selectedNodeId: string;
}

const workflowHistoryLimit = 100;

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
    action: "approve" | "reject" | "return" | "clarify" | "delegate" | "resubmit" | "cancel" | "move",
    options?: {
      readonly comment?: string;
      readonly nodeKey?: string;
      readonly delegateToUserId?: string;
    },
  ) => void | Promise<void>;
  readonly onDeleteRequest: (request: ApprovalRequestSummary) => void | Promise<void>;
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

function WorkflowObjectNode({ data, selected }: NodeProps<ApprovalNode>) {
  const journeyState = typeof data.journeyState === "string" ? data.journeyState : "editor";
  const statusText = typeof data.statusText === "string" ? data.statusText : data.detail;
  const assignee = typeof data.assignee === "string" ? data.assignee : "";
  return (
    <div className={`workflow-object-node state-${journeyState}${selected ? " is-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="workflow-object-heading">
        <i aria-hidden="true" />
        <span>{kindLabels[data.kind]}</span>
      </div>
      <strong>{data.label}</strong>
      {statusText ? <small>{statusText}</small> : null}
      {assignee ? <em>{assignee}</em> : null}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const workflowNodeTypes: NodeTypes = { approvalObject: WorkflowObjectNode };

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
  if (workflow === undefined || !Array.isArray(workflow.nodes)) {
    return initialNodes.map((node) => ({ ...node, type: "approvalObject" }));
  }
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: "approvalObject",
    position: { x: node.positionX, y: node.positionY },
    data: { ...node.config, label: node.label, kind: node.kind, detail: node.detail },
    className: `workflow-node node-${node.kind}`,
  }));
}

function flowEdges(workflow?: WorkflowDefinition): ApprovalEdge[] {
  if (workflow === undefined || !Array.isArray(workflow.edges)) return initialEdges;
  return workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    data: { outcome: edge.outcome, condition: edge.condition, sortOrder: edge.sortOrder },
    markerEnd: { type: MarkerType.ArrowClosed },
  }));
}

function cloneWorkflowNodes(nodes: readonly ApprovalNode[]): ApprovalNode[] {
  return nodes.map((node) => ({
    ...node,
    position: { ...node.position },
    data: { ...node.data },
  }));
}

function cloneWorkflowEdges(edges: readonly ApprovalEdge[]): ApprovalEdge[] {
  return edges.map((edge) => ({
    ...edge,
    data: edge.data === undefined
      ? undefined
      : { ...edge.data, condition: { ...edge.data.condition } },
  }));
}

function workflowSnapshot(
  nodes: readonly ApprovalNode[],
  edges: readonly ApprovalEdge[],
  selectedNodeId: string,
): WorkflowSnapshot {
  return {
    nodes: cloneWorkflowNodes(nodes),
    edges: cloneWorkflowEdges(edges),
    selectedNodeId,
  };
}

function workflowSnapshotKey(snapshot: WorkflowSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: node.data,
    })),
    edges: snapshot.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: typeof edge.label === "string" ? edge.label : null,
      data: edge.data,
    })),
  });
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
  const sourceNodes = workflow?.nodes ?? initialNodes.map((node) => ({
    id: node.id,
    kind: node.data.kind,
    label: node.data.label,
  }));
  const configuredKeys = new Set(sourceNodes.map((node) => node.id));
  // Legacy runtime snapshots must not add phantom lanes, but a stage with the
  // same key remains valid when it is explicitly present in the active route.
  const hiddenLegacyKeys = new Set(
    ["manager", "finance"].filter((key) => !configuredKeys.has(key)),
  );
  const workflowNodes = sourceNodes.filter((node) => !hiddenLegacyKeys.has(node.id));
  const nodeById = new Map(workflowNodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, WorkflowDefinition["edges"][number][]>();
  for (const edge of (workflow?.edges ?? initialEdges.map((edge, index) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    outcome: edge.data?.outcome ?? "approve",
    label: typeof edge.label === "string" ? edge.label : null,
    condition: edge.data?.condition ?? {},
    sortOrder: edge.data?.sortOrder ?? index,
  }))).filter((edge) => !hiddenLegacyKeys.has(edge.source) && !hiddenLegacyKeys.has(edge.target))) {
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
      !hiddenLegacyKeys.has(stage.key)
      && !ordered.some((column) => column.key === stage.key)
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
  move: "Перемещено вручную",
};

const deadlineEventLabels = {
  reminder: "Напоминание отправлено",
  overdue: "Зафиксирована просрочка",
  escalation: "Эскалация отправлена",
} as const;

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
            <WorkspaceSelect
              aria-label={`${prefix}тип перевода`}
              value={form.transferType}
              onChange={(event) => update("transferType", event.target.value as PaymentFormState["transferType"])}
            >
              <option value="">Не выбран</option>
              <option value="Гонорар (с расчетом)">Гонорар (с расчетом)</option>
              <option value="Конвертация">Конвертация</option>
              <option value="Другие услуги">Другие услуги</option>
            </WorkspaceSelect>
          </label>
          <label>
            Приоритет
            <WorkspaceSelect
              aria-label={`${prefix}приоритет заявки`}
              value={form.requestPriority}
              onChange={(event) => update("requestPriority", event.target.value as PaymentFormState["requestPriority"])}
            >
              <option value="normal">Обычная</option>
              <option value="urgent">Срочная</option>
            </WorkspaceSelect>
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
            <WorkspaceSelect
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
            </WorkspaceSelect>
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
            <WorkspaceSelect aria-label={`${prefix}ответственный за заявку`} value={form.responsibleUserId} onChange={(event) => update("responsibleUserId", event.target.value)}>
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
              ))}
            </WorkspaceSelect>
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
            <WorkspaceSelect
              multiple
              aria-label={`${prefix}сотрудники поездки`}
              value={[...form.employeeIds]}
              onChange={(event) => update("employeeIds", Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
            >
              {people.map((person) => (
                <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
              ))}
            </WorkspaceSelect>
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
  onDeleteRequest,
  onReviseRequest,
  onUploadAttachments,
  onDownloadAttachment,
}: ApprovalsViewProps) {
  const [mode, setMode] = useState<ApprovalMode>("requests");
  const [nodes, setNodes, onNodesChange] = useNodesState<ApprovalNode>(flowNodes(workflow));
  const [edges, setEdges, onEdgesChange] = useEdgesState<ApprovalEdge>(flowEdges(workflow));
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [saved, setSaved] = useState(true);
  const [saveError, setSaveError] = useState("");
  const baselineSnapshotRef = useRef<WorkflowSnapshot>(
    workflowSnapshot(nodes, edges, selectedNodeId),
  );
  const editorStateRef = useRef({ nodes, edges, selectedNodeId });
  const undoStackRef = useRef<WorkflowSnapshot[]>([]);
  const redoStackRef = useRef<WorkflowSnapshot[]>([]);
  const dragStartSnapshotRef = useRef<WorkflowSnapshot | undefined>(undefined);
  const [historyAvailability, setHistoryAvailability] = useState({
    undo: false,
    redo: false,
  });
  useEffect(() => {
    editorStateRef.current = { nodes, edges, selectedNodeId };
  }, [edges, nodes, selectedNodeId]);
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
  const [creatingBusy, setCreatingBusy] = useState(false);
  const creatingBusyRef = useRef(false);
  const [selectedRequestId, setSelectedRequestId] = useState(focusRequestId ?? "");
  const [detailTab, setDetailTab] = useState<ApprovalDetailTab>("overview");
  const [actionBusy, setActionBusy] = useState(false);
  const actionBusyRef = useRef(false);
  const [actionError, setActionError] = useState("");
  const [pendingRequestDelete, setPendingRequestDelete] = useState<ApprovalRequestSummary>();
  const createPanelRef = useRef<HTMLFormElement>(null);
  const detailPanelRef = useRef<HTMLElement>(null);
  const stageRibbonRef = useRef<HTMLDivElement>(null);
  const closeCreate = () => { if (!creatingBusyRef.current) setCreatingRequest(false); };
  const openDetail = (requestId: string) => { setActionError(""); setDetailTab("overview"); setSelectedRequestId(requestId); };
  const closeDetail = () => { setActionError(""); setSelectedRequestId(""); };
  const removeRequest = async (request: ApprovalRequestSummary) => {
    if (!canManage || actionBusyRef.current) return;
    setPendingRequestDelete(request);
  };
  const confirmRequestDelete = async () => {
    if (!canManage || actionBusyRef.current || !pendingRequestDelete) return;
    setActionBusy(true);
    actionBusyRef.current = true;
    setActionError("");
    try {
      await onDeleteRequest(pendingRequestDelete);
      closeDetail();
      setPendingRequestDelete(undefined);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось удалить заявку");
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };
  useModalFocus(createPanelRef, creatingRequest, closeCreate);
  useModalFocus(detailPanelRef, requests.some((request) => request.id === selectedRequestId), closeDetail);
  const [boardFilter, setBoardFilter] = useState<ApprovalBoardFilter>("all");
  const [requestQuery, setRequestQuery] = useState("");
  const [movingRequestId, setMovingRequestId] = useState("");
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
  const selectedNodeReminderHours = useMemo(() => {
    const value = selectedNode?.data.reminderHoursBefore;
    if (!Array.isArray(value)) return [24, 2];
    const normalized = value.map(Number).filter((hours) => Number.isFinite(hours) && hours >= 1);
    return normalized.length ? normalized : [24, 2];
  }, [selectedNode]);
  const boardColumns = useMemo(
    () => approvalBoardColumns(workflow, requests),
    [requests, workflow],
  );
  const boardSummary = useMemo(() => ({
    actionable: requests.filter(request => approvalRequestNeedsAction(request, currentUserId)).length,
    running: requests.filter(request => request.status === "running").length,
    revision: requests.filter(request => request.status === "needs_revision").length,
    overdue: requests.filter(request => approvalRequestIsOverdue(request)).length,
  }), [currentUserId, requests]);
  const matchingRequests = useMemo(() => {
    const query = requestQuery.trim().toLocaleLowerCase("ru-RU");
    return requests.filter(request => !query || [
      request.number,
      request.title,
      request.purpose,
      request.details.projectName,
      request.details.projectCode,
    ].some(value => value.toLocaleLowerCase("ru-RU").includes(query)));
  }, [requestQuery, requests]);
  const filterCounts = useMemo(() => ({
    all: matchingRequests.length,
    actionable: matchingRequests.filter(request => approvalRequestNeedsAction(request, currentUserId)).length,
    revision: matchingRequests.filter(request => request.status === "needs_revision").length,
    finished: matchingRequests.filter(request => ["approved", "rejected", "cancelled"].includes(request.status)).length,
  }), [currentUserId, matchingRequests]);
  const filteredRequests = useMemo(() => {
    return matchingRequests.filter((request) => {
      if (boardFilter === "actionable") {
        return approvalRequestNeedsAction(request, currentUserId);
      }
      if (boardFilter === "revision") return request.status === "needs_revision";
      if (boardFilter === "finished") {
        return ["approved", "rejected", "cancelled"].includes(request.status);
      }
      return true;
    });
  }, [boardFilter, currentUserId, matchingRequests]);
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
  const selectedDeadline = selectedRequest === undefined
    ? undefined
    : approvalDeadlinePresentation(selectedRequest);
  useEffect(() => {
    const ribbon = stageRibbonRef.current;
    const current = ribbon?.querySelector<HTMLElement>(".current");
    if (ribbon && current) ribbon.scrollLeft = Math.max(0, current.offsetLeft - ribbon.clientWidth / 3);
  }, [detailTab, selectedRequestColumn, selectedRequestId]);
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );

  const captureWorkflowSnapshot = useCallback(() => {
    const current = editorStateRef.current;
    return workflowSnapshot(current.nodes, current.edges, current.selectedNodeId);
  }, []);

  const syncHistoryAvailability = useCallback(() => {
    setHistoryAvailability({
      undo: undoStackRef.current.length > 0,
      redo: redoStackRef.current.length > 0,
    });
  }, []);

  const clearWorkflowHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);

  const restoreWorkflowSnapshot = useCallback((snapshot: WorkflowSnapshot) => {
    const restoredNodes = cloneWorkflowNodes(snapshot.nodes);
    const restoredEdges = cloneWorkflowEdges(snapshot.edges);
    const restoredSelection = restoredNodes.some((node) => node.id === snapshot.selectedNodeId)
      ? snapshot.selectedNodeId
      : restoredNodes[0]?.id ?? "";
    editorStateRef.current = {
      nodes: restoredNodes,
      edges: restoredEdges,
      selectedNodeId: restoredSelection,
    };
    setNodes(restoredNodes);
    setEdges(restoredEdges);
    setSelectedNodeId(restoredSelection);
    setSaved(
      workflowSnapshotKey(snapshot)
        === workflowSnapshotKey(baselineSnapshotRef.current),
    );
    setSaveError("");
  }, [setEdges, setNodes]);

  const pushUndoSnapshot = useCallback((snapshot?: WorkflowSnapshot) => {
    const entry = snapshot ?? captureWorkflowSnapshot();
    const previous = undoStackRef.current.at(-1);
    if (previous === undefined || workflowSnapshotKey(previous) !== workflowSnapshotKey(entry)) {
      undoStackRef.current = [
        ...undoStackRef.current.slice(-(workflowHistoryLimit - 1)),
        entry,
      ];
    }
    redoStackRef.current = [];
    syncHistoryAvailability();
  }, [captureWorkflowSnapshot, syncHistoryAvailability]);

  const undoWorkflowChange = useCallback(() => {
    const previous = undoStackRef.current.at(-1);
    if (previous === undefined) return;
    redoStackRef.current = [
      captureWorkflowSnapshot(),
      ...redoStackRef.current,
    ].slice(0, workflowHistoryLimit);
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    restoreWorkflowSnapshot(previous);
    syncHistoryAvailability();
  }, [captureWorkflowSnapshot, restoreWorkflowSnapshot, syncHistoryAvailability]);

  const redoWorkflowChange = useCallback(() => {
    const [next, ...remaining] = redoStackRef.current;
    if (next === undefined) return;
    undoStackRef.current = [
      ...undoStackRef.current.slice(-(workflowHistoryLimit - 1)),
      captureWorkflowSnapshot(),
    ];
    redoStackRef.current = remaining;
    restoreWorkflowSnapshot(next);
    syncHistoryAvailability();
  }, [captureWorkflowSnapshot, restoreWorkflowSnapshot, syncHistoryAvailability]);

  const cancelWorkflowChanges = useCallback(() => {
    restoreWorkflowSnapshot(baselineSnapshotRef.current);
    clearWorkflowHistory();
    setSaved(true);
  }, [clearWorkflowHistory, restoreWorkflowSnapshot]);

  const handleNodesChange = useCallback((changes: NodeChange<ApprovalNode>[]) => {
    const mutatesWorkflow = changes.some((change) =>
      change.type === "add"
      || change.type === "remove"
      || change.type === "replace",
    );
    if (mutatesWorkflow) {
      pushUndoSnapshot();
      setSaved(false);
    }
    onNodesChange(changes);
  }, [onNodesChange, pushUndoSnapshot]);

  const handleEdgesChange = useCallback((changes: EdgeChange<ApprovalEdge>[]) => {
    if (changes.some((change) => change.type === "add" || change.type === "remove" || change.type === "replace")) {
      pushUndoSnapshot();
      setSaved(false);
    }
    onEdgesChange(changes);
  }, [onEdgesChange, pushUndoSnapshot]);

  const connect = useCallback(
    (connection: Connection) => {
      pushUndoSnapshot();
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
    [nodes, pushUndoSnapshot, setEdges],
  );

  const updateSelected = (data: Partial<ApprovalNodeData>) => {
    pushUndoSnapshot();
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
    pushUndoSnapshot();
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
        type: "approvalObject",
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
    pushUndoSnapshot();
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
    const snapshotToSave = captureWorkflowSnapshot();
    if (workflow === undefined) {
      baselineSnapshotRef.current = snapshotToSave;
      clearWorkflowHistory();
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
      baselineSnapshotRef.current = snapshotToSave;
      setSaved(
        workflowSnapshotKey(captureWorkflowSnapshot())
          === workflowSnapshotKey(snapshotToSave),
      );
      setSaveError("");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Не удалось сохранить маршрут");
    }
  };

  const createRequest = async () => {
    if (creatingBusyRef.current) return;
    const amount = Number(requestAmount.replace(/\s/g, ""));
    if (!requestTitle.trim() || !Number.isFinite(amount) || amount <= 0) {
      setCreateError("Укажите название и положительную сумму заявки");
      return;
    }
    setCreateError(""); creatingBusyRef.current = true; setCreatingBusy(true);
    try {
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
    } catch { setCreateError("Не удалось отправить заявку. Введённые данные сохранены в форме."); }
    finally { creatingBusyRef.current = false; setCreatingBusy(false); }
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

  const performAction = async (
    requestId: string,
    action: Parameters<ApprovalsViewProps["onAction"]>[1],
    options?: Parameters<ApprovalsViewProps["onAction"]>[2],
  ): Promise<boolean> => {
    if (actionBusyRef.current) return false;
    actionBusyRef.current = true;
    setActionBusy(true);
    setActionError("");
    try {
      await onAction(requestId, action, options);
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Сервер не подтвердил действие. Проверьте заявку перед повтором.");
      return false;
    } finally {
      actionBusyRef.current = false;
      setActionBusy(false);
    }
  };

  const returnForRevision = async (requestId: string) => {
    if (!returnComment.trim()) return;
    const confirmed = await performAction(requestId, "return", {
      comment: returnComment.trim(),
      nodeKey: returnNodeKey || undefined,
    });
    if (!confirmed) return;
    setReturnRequestId("");
    setReturnNodeKey("");
    setReturnComment("");
  };

  const completeDecision = async () => {
    if (decision === undefined) return;
    if (decision.action === "reject" && !decisionComment.trim()) return;
    if (decision.action === "delegate" && !delegateToUserId) return;
    const confirmed = await performAction(decision.requestId, decision.action, {
      comment: decisionComment.trim() || undefined,
      nodeKey: decision.nodeKey,
      delegateToUserId: decision.action === "delegate" ? delegateToUserId : undefined,
    });
    if (!confirmed) return;
    setDecision(undefined);
    setDecisionComment("");
    setDelegateToUserId("");
  };

  const moveRequest = async (requestId: string, columnKey: string) => {
    const request = requests.find(item => item.id === requestId);
    const plan = request && approvalAdvancePlan(request, workflow, currentUserId);
    const target = boardColumns.find(column => column.key === columnKey);
    const targetNode = workflow?.nodes?.find((node) => node.id === columnKey);
    const canManuallyMove = !!request && !!targetNode && ["approval", "correction"].includes(targetNode.kind)
      && (canManage || request.activeStages.some((stage) => stage.canAct));
    const canAdvance = !!plan?.targetKeys.includes(columnKey);
    if (!request || (!canAdvance && !canManuallyMove) || !target) return;
    setMovingRequestId(request.id);
    try {
      const confirmed = await performAction(
        request.id,
        canManuallyMove ? "move" : plan!.action,
        { nodeKey: canManuallyMove ? columnKey : plan!.nodeKey, comment: `Переход на этап «${target.label}» выполнен с доски` },
      );
      if (!confirmed) throw new Error("Переход не подтверждён сервером");
    }
    finally { setMovingRequestId(""); }
  };

  const publish = async () => {
    if (workflow === undefined || !saved) return;
    const nextDraft = await onPublishWorkflow(workflow);
    if (nextDraft !== undefined) {
      const publishedNodes = flowNodes(nextDraft);
      const publishedEdges = flowEdges(nextDraft);
      const publishedSnapshot = workflowSnapshot(
        publishedNodes,
        publishedEdges,
        publishedNodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : publishedNodes[0]?.id ?? "",
      );
      baselineSnapshotRef.current = publishedSnapshot;
      setNodes(publishedNodes);
      setEdges(publishedEdges);
      setSelectedNodeId(publishedSnapshot.selectedNodeId);
      clearWorkflowHistory();
      setSaved(true);
      setSaveError("");
    }
  };

  useEffect(() => {
    if (mode !== "designer" || !canManage) return undefined;
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.isComposing
        || !event.ctrlKey
        || event.altKey
        || event.metaKey
        || event.key.toLocaleLowerCase("ru-RU") !== "z"
      ) return;
      event.preventDefault();
      if (event.shiftKey) redoWorkflowChange();
      else undoWorkflowChange();
    };
    window.addEventListener("keydown", handleHistoryShortcut, true);
    return () => window.removeEventListener("keydown", handleHistoryShortcut, true);
  }, [canManage, mode, redoWorkflowChange, undoWorkflowChange]);

  return (
    <section className="workspace-view approvals-view workflow-process-view" aria-label="Согласования">
      <header className="section-toolbar approvals-toolbar workflow-hero-header">
        <div>
          <span className="view-kicker">Финансовый маршрут · Рабочая очередь</span>
          <h1>{mode === "requests" ? "Заявки на оплату" : "Маршрут согласования"}</h1>
          <p>
            {mode === "requests"
              ? "Рабочая очередь по стадиям — от запуска до оплаты"
              : "Настройка логики процесса без изменения кода"}
          </p>
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
              {canManage ? (
                <button
                  type="button"
                  aria-pressed={mode === "designer"}
                  className={mode === "designer" ? "active" : ""}
                  onClick={() => setMode("designer")}
                >
                  Конструктор маршрутов
                </button>
              ) : null}
            </div>
          </div>
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
              <div className="workflow-history-actions" role="group" aria-label="История изменений маршрута">
                <Tooltip content="Назад · Ctrl+Z" relationship="label">
                  <Button
                    appearance="subtle"
                    icon={<ArrowUndo24Regular />}
                    aria-label="Назад (Ctrl+Z)"
                    disabled={!canManage || !historyAvailability.undo}
                    onClick={undoWorkflowChange}
                  />
                </Tooltip>
                <Tooltip content="Вперёд · Ctrl+Shift+Z" relationship="label">
                  <Button
                    appearance="subtle"
                    icon={<ArrowRedo24Regular />}
                    aria-label="Вперёд (Ctrl+Shift+Z)"
                    disabled={!canManage || !historyAvailability.redo}
                    onClick={redoWorkflowChange}
                  />
                </Tooltip>
              </div>
              <Button
                appearance="subtle"
                aria-label="Отменить все изменения маршрута"
                disabled={!canManage || saved}
                onClick={cancelWorkflowChanges}
              >
                Отменить
              </Button>
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

      {mode === "requests" ? (
        <div className="approval-workspace">
          <div className="approval-commandbar">
            <div className="approval-metrics" aria-label="Сводка заявок">
              <button
                type="button"
                className="approval-metric approval-metric-actionable"
                aria-pressed={boardFilter === "actionable"}
                onClick={() => setBoardFilter("actionable")}
              >
                <strong>{boardSummary.actionable}</strong><span>Нужно моё решение</span>
              </button>
              <span className="approval-metric"><strong>{boardSummary.running}</strong><span>В работе</span></span>
              <span className="approval-metric"><strong>{boardSummary.revision}</strong><span>На доработке</span></span>
              <span className="approval-metric approval-metric-overdue"><strong>{boardSummary.overdue}</strong><span>Просрочено</span></span>
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
                ["all", "Все", filterCounts.all],
                ["actionable", "Нужно моё решение", filterCounts.actionable],
                ["revision", "Доработка", filterCounts.revision],
                ["finished", "Завершённые", filterCounts.finished],
              ] as const).map(([filter, label, count]) => (
                <button
                  key={filter}
                  type="button"
                  className={boardFilter === filter ? "active" : ""}
                  aria-label={label}
                  aria-pressed={boardFilter === filter}
                  onClick={() => setBoardFilter(filter)}
                >
                  <span>{label}</span><span className="approval-filter-count" aria-hidden="true">{count}</span>
                </button>
              ))}
            </div>
          </div>
          {actionError && !selectedRequest ? (
            <div className="approval-board-notice approval-action-error" role="alert">
              <span>Переход не подтверждён. {actionError} Проверьте состояние заявки перед повтором.</span>
              <button type="button" onClick={() => setActionError("")} aria-label="Скрыть ошибку перехода">×</button>
            </div>
          ) : null}
          {!canCreateRequest ? (
            <div className="request-create-policy">Ваша должность не может создавать заявки на оплату</div>
          ) : null}

          <SpatialBoard interactionMode="payment" canDrop={(id, target) => {
            const request = requests.find((item) => item.id === id);
            if (!request || target === requestBoardColumn(request, boardColumns)) return false;
            const plan = approvalAdvancePlan(request, workflow, currentUserId);
            const canAdvance = plan?.targetKeys.includes(target) ?? false;
            const node = workflow?.nodes?.find((item) => item.id === target);
            const canManuallyMove = !!node && ["approval", "correction"].includes(node.kind)
              && (canManage || request.activeStages.some((stage) => stage.canAct));
            return canAdvance || canManuallyMove;
          }} onMove={moveRequest}>
          <div className="approval-kanban" aria-label="Доска заявок по стадиям">
            {boardColumns.map((column) => {
              const columnRequests = filteredRequests.filter((request) =>
                requestBoardColumn(request, boardColumns) === column.key,
              );
              const palette = approvalStagePalette(column);
              const totals = approvalColumnTotals(columnRequests);
              return (
                <SpatialLane id={column.key}
                  key={column.key}
                  data-stage-key={column.key}
                  className={`approval-column column-${column.kind}`}
                  style={{ "--approval-stage-color": palette.background, "--approval-stage-ink": palette.foreground } as CSSProperties}
                  aria-label={`${column.label}: ${columnRequests.length} заявок`}
                >
                  <header>
                    <strong title={column.label}>{column.label}</strong>
                    <AnimatedInteger className="approval-column-count" label={`${columnRequests.length} заявок`} value={columnRequests.length} />
                  </header>
                  <div className="approval-column-total" aria-label={`Сумма в колонке «${column.label}»`} title="Сумма заявок, показанных в этой колонке с текущими фильтрами. Разные валюты считаются отдельно.">
                    <span>Сумма в колонке</span>
                    {totals.map((total) => <AnimatedAmount key={total.currency} currency={total.currency} minorUnits={total.minorUnits} />)}
                  </div>
                  <div className="approval-column-stack">
                    {columnRequests.map((request) => {
                      const plan = approvalAdvancePlan(request, workflow, currentUserId);
                      const deadline = approvalDeadlinePresentation(request);
                      const cardStatus = approvalCardStatusPresentation(request, currentUserId);
                      const responsibleName = peopleById.get(request.responsibleUserId)?.name
                        || "Ответственный не указан";
                      const canRevise = request.status === "needs_revision" && (
                        request.requesterId === currentUserId
                        || request.activeStages.some((stage) => stage.canAct)
                      );
                      const requestAttachments = attachments.filter((attachment) =>
                        attachment.ownerType === "approval_request" && attachment.ownerId === request.id,
                      ).length;
                      return (
                        <SpatialCard id={request.id} lane={column.key} label={request.title} disabled={(!plan && !canManage && !request.activeStages.some((stage) => stage.canAct)) || movingRequestId === request.id}
                          key={request.id}
                          className={`approval-board-card${plan || canManage || request.activeStages.some((stage) => stage.canAct) ? " movable" : ""}${movingRequestId === request.id ? " moving" : ""}${selectedRequestId === request.id ? " selected" : ""}`}
                        >
                          <button
                            type="button"
                            className="approval-card-open"
                            aria-label={`Открыть заявку №${request.number}: ${request.title}`}
                            onClick={() => openDetail(request.id)}
                          >
                            <span className="approval-card-quick-action" aria-hidden="true">
                              <Open16Regular /> Открыть
                            </span>
                            <strong className="approval-card-title">{request.title}</strong>
                            <span className="approval-card-amount">{formatMoney(request.amount, request.currency)}</span>
                            <span className="approval-card-statusline">
                              <span className={`approval-card-status status-${cardStatus.tone}`}>
                                <i aria-hidden="true" />
                                {cardStatus.label}
                              </span>
                              {request.details.requestPriority === "urgent" ? (
                                <em className="approval-card-priority">Срочно</em>
                              ) : null}
                            </span>
                            <span className="approval-card-peopleline">
                              <span className="approval-card-owner">
                                <Avatar size={24} name={responsibleName} color="colorful" />
                                <span>{responsibleName}</span>
                              </span>
                              {request.details.deadline && cardStatus.tone !== "overdue" ? (
                                <span
                                  className={`approval-card-deadline deadline-${deadline.tone}`}
                                  title={`Срок: ${formatDateTime(request.details.deadline)}`}
                                >
                                  <Clock16Regular /> {deadline.label}
                                </span>
                              ) : null}
                            </span>
                            <span className="approval-card-context">
                              <span className="approval-card-project" title={request.details.projectName || "Без проекта"}>
                                {request.details.projectName || "Без проекта"}
                                {request.details.projectCode ? ` · ${request.details.projectCode}` : ""}
                              </span>
                              <span className="approval-card-attachments" title={`${requestAttachments} вложений`}>
                                <Attach16Regular /> {requestAttachments}
                              </span>
                            </span>
                            <span className="approval-card-meta">
                              <span>#{request.number}</span>
                              <span>Версия {request.revision}{request.sourceTaskId ? " · создана из задачи" : ""}</span>
                            </span>
                          </button>
                          {request.activeStages.length > 1 ? (
                            <span className="approval-parallel-note">Параллельно ещё {request.activeStages.length - 1}</span>
                          ) : null}
                          {request.status === "needs_revision" && latestReturnComment(request) ? (
                            <span className="approval-return-note">{latestReturnComment(request)}</span>
                          ) : null}
                          {plan || canRevise ? <footer>
                            {plan ? (
                              <span className="approval-move-hint">
                                Перетащите → {plan.targetKeys.map((targetKey) =>
                                  boardColumns.find((candidate) => candidate.key === targetKey)?.label,
                                ).filter(Boolean).join(" / ")}
                              </span>
                            ) : (
                              <span className="approval-card-footer-context">Откройте для исправления</span>
                            )}
                            {canRevise ? (
                              <Button
                                size="small"
                                appearance="subtle"
                                onClick={() => {
                                  openDetail(request.id);
                                  startRevision(request);
                                }}
                              >
                                Исправить заявку
                              </Button>
                            ) : null}
                          </footer> : null}
                        </SpatialCard>
                      );
                    })}
                    {columnRequests.length === 0 ? (
                      <div className="approval-column-empty">
                        Нет заявок
                      </div>
                    ) : null}
                  </div>
                </SpatialLane>
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
          </SpatialBoard>

          {creatingRequest ? (
            <div
              className="approval-overlay record-composer-backdrop"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeCreate();
              }}
            >
              <form ref={createPanelRef} noValidate tabIndex={-1} className="approval-create-panel record-composer" role="dialog" aria-modal="true" aria-labelledby="approval-create-title" aria-busy={creatingBusy} onSubmit={(event) => { event.preventDefault(); void createRequest(); }}>
                <RecordComposer title="Подготовить оплату" titleId="approval-create-title" eyebrow="Заявки на оплату" busy={creatingBusy} error={createError} submitLabel="Отправить по маршруту" onClose={closeCreate}
                  hint="После отправки заявку увидит исполнитель первой стадии."
                  stages={<div className="record-stages" tabIndex={0} role="region" aria-label="Стадии процесса оплаты">{boardColumns.map((column) => <span key={column.key} style={{ "--record-stage-color": approvalStagePalette(column).background } as CSSProperties}>{column.label}</span>)}</div>}
                  aside={<>
                    <RecordSummary title="Сводка заявки"><div className="record-summary-title">{requestTitle.trim() || "Новая заявка"}</div>
                      <strong className="record-summary-amount">{requestAmount.trim() && Number.isFinite(Number(requestAmount.replace(/\s/g, ""))) && Number(requestAmount.replace(/\s/g, "")) > 0 ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(requestAmount.replace(/\s/g, "")))} UZS` : "Укажите сумму"}</strong>
                      <dl className="record-summary-facts"><div><dt>Проект</dt><dd>{requestDetails.projectName || "Не указан"}</dd></div><div><dt>Ответственный</dt><dd>{people.find((person) => person.id === requestDetails.responsibleUserId)?.name || "Не указан"}</dd></div><div><dt>Документы</dt><dd>{requestFiles.length + requestAdditionalFiles.length}</dd></div><div><dt>Приоритет</dt><dd>{requestDetails.requestPriority === "urgent" ? "Срочная" : "Обычная"}</dd></div></dl>
                    </RecordSummary>
                    <section className="record-summary-card record-summary-note"><h3>Запуск согласования</h3><p>Проверьте реквизиты и приложите документы. Кнопка «Отправить по маршруту» создаст заявку и запустит действующий процесс согласования.</p><p>Условия и ответственных определяет маршрут. История появится после отправки.</p></section>
                  </>}>
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
                </RecordComposer>
              </form>
            </div>
          ) : null}

          {selectedRequest ? (
            <div
              className="approval-overlay approval-detail-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeDetail();
              }}
            >
              <article ref={detailPanelRef} tabIndex={-1} className="approval-detail-panel" role="dialog" aria-modal="true" aria-labelledby="approval-detail-title">
                <header className="approval-detail-header">
                  <div>
                    <span>{selectedRequest.details.projectCode ? `${selectedRequest.details.projectCode} · ` : ""}Заявка №{selectedRequest.number} · v{selectedRequest.revision}</span>
                    <h2 id="approval-detail-title">{selectedRequest.title}</h2>
                  </div>
                  <Badge
                    appearance="tint"
                    color={selectedRequest.status === "approved" ? "success" : selectedRequest.status === "rejected" ? "danger" : selectedRequest.status === "needs_revision" ? "warning" : "brand"}
                  >
                    {selectedRequest.statusLabel}
                  </Badge>
                  {selectedRequest.status === "needs_revision" && (selectedRequest.requesterId === currentUserId || selectedRequest.activeStages.some((stage) => stage.canAct)) && editingRequestId !== selectedRequest.id ? (
                    <Button className="approval-edit-button" appearance="subtle" icon={<CircleEdit24Regular />} disabled={actionBusy} onClick={() => startRevision(selectedRequest)}>Исправить заявку</Button>
                  ) : null}
                  {canManage ? (
                    <Button
                      className="approval-delete-button"
                      appearance="subtle"
                      icon={<Delete24Regular />}
                      aria-label="Удалить заявку"
                      disabled={actionBusy}
                      onClick={() => void removeRequest(selectedRequest)}
                    >
                      Удалить
                    </Button>
                  ) : null}
                  <button type="button" aria-label="Закрыть карточку заявки" onClick={closeDetail}>×</button>
                </header>

                <nav className="approval-detail-tabs" aria-label="Разделы заявки">
                  {([
                    ["overview", "Обзор"],
                    ["route", "Маршрут"],
                    ["files", "Файлы"],
                    ["activity", "Активность"],
                  ] as const).map(([tab, label]) => (
                    <button key={tab} type="button" className={detailTab === tab ? "active" : ""}
                      aria-pressed={detailTab === tab} onClick={() => setDetailTab(tab)}>{label}</button>
                  ))}
                </nav>

                {detailTab === "route" ? <div ref={stageRibbonRef} className="approval-stage-ribbon detail-route" role="region" tabIndex={0} aria-label="Стадии заявки">
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
                </div> : null}

                <div className={`approval-detail-content tab-${detailTab}`} role="region" tabIndex={0} aria-label="Содержимое карточки заявки">
                  <section className="approval-detail-facts" role="region" tabIndex={0} aria-label="Сведения о заявке">
                    <div className="approval-amount-block detail-overview">
                      <span>К перечислению</span>
                      <strong>{formatMoney(selectedRequest.amount, selectedRequest.currency)}</strong>
                      <small>{selectedRequest.details.requestPriority === "urgent" ? "Срочный платёж" : "Обычный приоритет"}</small>
                    </div>
                    <dl className="approval-key-facts detail-overview">
                      <div><dt>Текущий этап</dt><dd>{selectedRequest.stageLabel}</dd></div>
                      <div><dt>Ответственный</dt><dd>{peopleById.get(selectedRequest.responsibleUserId)?.name ?? "Сотрудник"}</dd></div>
                      <div><dt>Срок</dt><dd>{selectedDeadline?.label ?? "Без срока"}</dd></div>
                    </dl>
                    {selectedRequest.status === "needs_revision" && latestReturnComment(selectedRequest) ? (
                      <div className="approval-detail-return detail-overview">
                        <strong>Что нужно исправить</strong>
                        <span>{latestReturnComment(selectedRequest)}</span>
                      </div>
                    ) : null}
                    <section className={`approval-deadline-control detail-route deadline-${selectedDeadline?.tone ?? "neutral"}`}>
                      <header>
                        <div><span>Контроль срока</span><strong>{selectedDeadline?.label ?? "Без срока"}</strong></div>
                        <small>{selectedDeadline?.detail}</small>
                      </header>
                      {selectedRequest.details.deadline ? (
                        <dl>
                          <div><dt>Срок</dt><dd>{formatDateTime(selectedRequest.details.deadline)}</dd></div>
                          <div><dt>Следующее событие</dt><dd>{formatDateTime(selectedRequest.deadlineControl?.nextEventAt)}</dd></div>
                          <div><dt>Эскалация</dt><dd>{formatDateTime(selectedRequest.deadlineControl?.escalationAt)}</dd></div>
                          <div><dt>Правило</dt><dd>за {(selectedRequest.deadlineControl?.reminderHoursBefore ?? [24, 2]).join(" и ")} ч.; эскалация через {selectedRequest.deadlineControl?.escalationAfterHours ?? 4} ч.</dd></div>
                        </dl>
                      ) : <p>Укажите срок в заявке, чтобы включить напоминания и эскалацию.</p>}
                    </section>
                    <section className="approval-fact-section detail-overview">
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
                    <section className="approval-fact-section detail-overview approval-people-summary">
                      <h3>Ответственные</h3>
                      <dl>
                        <div><dt>Инициатор</dt><dd>{peopleById.get(selectedRequest.requesterId)?.name ?? "Сотрудник"}</dd></div>
                        <div><dt>Ответственный</dt><dd>{peopleById.get(selectedRequest.responsibleUserId)?.name ?? "Сотрудник"}</dd></div>
                        <div><dt>Текущий этап</dt><dd>{selectedRequest.stageLabel}</dd></div>
                        <div><dt>Создана</dt><dd>{formatDateTime(selectedRequest.createdAt)}</dd></div>
                      </dl>
                    </section>
                    <section className="approval-fact-section approval-detail-files detail-files">
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

                  <aside className="approval-detail-process" tabIndex={0} aria-label="Ход согласования и действия">
                    {actionError ? <div className="approval-action-error" role="alert">Не удалось выполнить действие: {actionError}. Проверьте состояние заявки перед повтором.</div> : null}
                    {selectedRequest.status === "running" && selectedRequest.activeStages.some((stage) => stage.canAct) ? (
                      <section className="approval-decision-block detail-overview">
                        <span>Нужно ваше решение</span>
                        {selectedRequest.activeStages.filter((stage) => stage.canAct).map((stage) => (
                          <div key={stage.key}>
                            <strong>{stage.label}</strong>
                            <div>
                              <Button className="approval-decision-action action-approve" appearance="primary" disabled={actionBusy} onClick={() => void performAction(selectedRequest.id, "approve", { nodeKey: stage.key })}>Согласовать</Button>
                              <Button className="approval-decision-action action-return" appearance="subtle" disabled={actionBusy} onClick={() => { setReturnRequestId(selectedRequest.id); setReturnNodeKey(stage.key); }}>Вернуть</Button>
                              <Button className="approval-decision-action action-reject" appearance="subtle" disabled={actionBusy} onClick={() => setDecision({ requestId: selectedRequest.id, nodeKey: stage.key, action: "reject" })}>Отклонить</Button>
                              <Button className="approval-decision-action action-clarify" appearance="subtle" disabled={actionBusy} onClick={() => setDecision({ requestId: selectedRequest.id, nodeKey: stage.key, action: "clarify" })}>Уточнить</Button>
                              <Button className="approval-decision-action action-delegate" appearance="subtle" disabled={actionBusy} onClick={() => setDecision({ requestId: selectedRequest.id, nodeKey: stage.key, action: "delegate" })}>Делегировать</Button>
                            </div>
                          </div>
                        ))}
                      </section>
                    ) : null}
                    {returnRequestId === selectedRequest.id ? (
                      <div className="request-inline-editor return-editor detail-overview">
                        <Textarea autoFocus aria-label={`Причина возврата заявки ${selectedRequest.number}`} placeholder="Что нужно исправить?" value={returnComment} onChange={(_event, data) => setReturnComment(data.value)} />
                        <Button appearance="primary" disabled={actionBusy || !returnComment.trim()} onClick={() => void returnForRevision(selectedRequest.id)}>Подтвердить возврат</Button>
                        <Button appearance="subtle" onClick={() => setReturnRequestId("")}>Отмена</Button>
                      </div>
                    ) : null}
                    {decision?.requestId === selectedRequest.id ? (
                      <div className="request-inline-editor decision-editor detail-overview">
                        {decision.action === "delegate" ? (
                          <WorkspaceSelect aria-label={`Новый согласующий заявки ${selectedRequest.number}`} value={delegateToUserId} onChange={(event) => setDelegateToUserId(event.target.value)}>
                            <option value="">Выберите сотрудника</option>
                            {people.filter((person) => person.id !== currentUserId).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>)}
                          </WorkspaceSelect>
                        ) : null}
                        <Textarea aria-label={`Комментарий решения по заявке ${selectedRequest.number}`} placeholder={decision.action === "reject" ? "Причина отклонения обязательна" : "Комментарий"} value={decisionComment} onChange={(_event, data) => setDecisionComment(data.value)} />
                        <Button appearance="primary" disabled={actionBusy || (decision.action === "reject" && !decisionComment.trim()) || (decision.action === "delegate" && !delegateToUserId)} onClick={() => void completeDecision()}>Подтвердить</Button>
                        <Button appearance="subtle" onClick={() => setDecision(undefined)}>Отмена</Button>
                      </div>
                    ) : null}
                    {editingRequestId === selectedRequest.id ? (
                      <section className="approval-revision-editor detail-overview" aria-label="Редактирование возвращённой заявки">
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

                    {selectedRequest.deadlineControl?.events.length ? (
                      <section className="approval-deadline-events detail-activity" aria-label="Журнал контроля срока">
                        <header><span>Контроль срока</span><strong>{selectedRequest.deadlineControl.events.length} событий</strong></header>
                        {selectedRequest.deadlineControl.events.slice().reverse().map((event) => (
                          <div key={event.id}>
                            <span>{deadlineEventLabels[event.eventType]}</span>
                            <strong>{peopleById.get(event.recipientUserId)?.name ?? "Сотрудник"}</strong>
                            <time>{formatDateTime(event.createdAt)}</time>
                          </div>
                        ))}
                      </section>
                    ) : null}
                    <section className="approval-timeline detail-activity">
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
                    <section className="approval-version-list detail-activity" aria-label={`История версий заявки ${selectedRequest.number}`}>
                      <h3>Версии</h3>
                      {selectedRequest.versions.slice().reverse().map((version) => (
                        <div key={version.version}>
                          <strong>v{version.version} · {formatMoney(version.amount, version.currency)}</strong>
                          <span>{version.changeReason === "initial" ? "Создание" : version.changeReason === "attachment_added" ? "Добавлен файл" : "Исправление"}{version.changeComment ? ` · ${version.changeComment}` : ""}</span>
                        </div>
                      ))}
                    </section>
                    {selectedRequest.requesterId === currentUserId && ["draft", "running", "needs_revision"].includes(selectedRequest.status) ? (
                      <Button className="detail-overview approval-cancel-button" appearance="subtle" disabled={actionBusy} onClick={() => void performAction(selectedRequest.id, "cancel", { comment: "Отменено автором" })}>Отменить заявку</Button>
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
            <div className="workflow-template-summary">
              <span className="detail-kicker">Шаблон</span>
              <h2>{workflow?.name ?? "Заявка на оплату"}</h2>
              <p>
                Черновик v{workflow?.version ?? "—"} · опубликована v{workflow?.publishedVersion ?? "—"}
              </p>
              <dl>
                <div><dt>Блоки</dt><dd>{nodes.length}</dd></div>
                <div><dt>Связи</dt><dd>{edges.length}</dd></div>
              </dl>
            </div>
            <div className="node-library">
              <strong>Новый объект маршрута</strong>
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
              <strong>Как работать со схемой</strong>
              <span>Перетаскивайте блоки и соединяйте точки на границах. Геометрия помогает читать маршрут, но не меняет порядок исполнения.</span>
            </div>
          </aside>

          <div className="workflow-canvas" aria-label="Дерево согласования заявки на оплату">
            <div className="workflow-canvas-heading">
              <div><span>Карта процесса</span><strong>От заявки до финального решения</strong></div>
              <div className="workflow-canvas-legend"><span>Согласование</span><span>Правило</span><span>Доработка</span></div>
            </div>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={workflowNodeTypes}
              onNodesChange={handleNodesChange}
              onEdgesChange={handleEdgesChange}
              onNodeDragStart={() => {
                dragStartSnapshotRef.current = captureWorkflowSnapshot();
              }}
              onNodeDragStop={(_event, node) => {
                const beforeDrag = dragStartSnapshotRef.current;
                dragStartSnapshotRef.current = undefined;
                const previousNode = beforeDrag?.nodes.find((candidate) => candidate.id === node.id);
                if (
                  beforeDrag !== undefined
                  && previousNode !== undefined
                  && (
                    previousNode.position.x !== node.position.x
                    || previousNode.position.y !== node.position.y
                  )
                ) {
                  pushUndoSnapshot(beforeDrag);
                  setSaved(false);
                }
              }}
              onConnect={connect}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              onPaneClick={() => setSelectedNodeId("")}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.45}
              maxZoom={1.6}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#c7d2df" />
              <MiniMap pannable zoomable nodeColor="#d9e8f6" maskColor="rgba(245, 247, 250, .74)" />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>

          <aside
            className={`workflow-inspector${selectedNode === undefined ? " is-empty" : ""}`}
            aria-label="Настройки выбранного блока"
          >
            {selectedNode === undefined ? (
              <div className="workflow-inspector-empty">
                <CircleEdit24Regular />
                <strong>Выберите блок</strong>
                <span>Здесь появятся исполнитель, правила перехода и контроль срока выбранного объекта.</span>
              </div>
            ) : (
              <>
                <div className="inspector-heading">
                  <CircleEdit24Regular />
                  <div><strong>Настройка блока</strong><span>{kindLabels[selectedNode.data.kind]}</span></div>
                  <Button appearance="subtle" icon={<Dismiss24Regular />} aria-label="Закрыть настройки блока" onClick={() => setSelectedNodeId("")} />
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
                  <WorkspaceSelect
                    aria-label="Тип блока маршрута"
                    value={selectedNode.data.kind}
                    onChange={(event) => updateSelected({ kind: event.target.value as ApprovalNodeKind })}
                  >
                    {Object.entries(kindLabels).map(([kind, label]) => (
                      <option key={kind} value={kind}>{label}</option>
                    ))}
                  </WorkspaceSelect>
                </label>
                {selectedNode.data.kind === "approval" ? (
                  <>
                    <label>
                      Должность согласующего
                      <WorkspaceSelect
                        aria-label="Должность согласующего"
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
                      </WorkspaceSelect>
                    </label>
                    <label>
                      Роль согласующего, если должность не выбрана
                      <WorkspaceSelect
                        aria-label="Роль согласующего"
                        value={String(selectedNode.data.approverRole ?? "manager")}
                        onChange={(event) => updateSelected({ approverRole: event.target.value })}
                      >
                        <option value="manager">Руководитель</option>
                        <option value="admin">Администратор</option>
                        <option value="superadmin">Суперадминистратор</option>
                        <option value="employee">Сотрудник</option>
                      </WorkspaceSelect>
                    </label>
                    <label>
                      Конкретный сотрудник
                      <WorkspaceSelect
                        aria-label="Конкретный согласующий"
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
                      </WorkspaceSelect>
                    </label>
                    <fieldset className="workflow-deadline-settings">
                      <legend>Сроки и эскалация</legend>
                      <div>
                        <label>Первое напоминание, ч.
                          <input type="number" min={1} max={720} value={selectedNodeReminderHours[0] ?? 24} onChange={(event) => updateSelected({ reminderHoursBefore: [Math.max(1, Number(event.target.value) || 24), selectedNodeReminderHours[1] ?? 2] })} />
                        </label>
                        <label>Повторное, ч.
                          <input type="number" min={1} max={720} value={selectedNodeReminderHours[1] ?? 2} onChange={(event) => updateSelected({ reminderHoursBefore: [selectedNodeReminderHours[0] ?? 24, Math.max(1, Number(event.target.value) || 2)] })} />
                        </label>
                      </div>
                      <label>Эскалировать после просрочки, ч.
                        <input type="number" min={1} max={720} value={Number(selectedNode.data.escalationAfterHours ?? 4)} onChange={(event) => updateSelected({ escalationAfterHours: Math.max(1, Number(event.target.value) || 4) })} />
                      </label>
                      <label>Получатель эскалации
                        <WorkspaceSelect aria-label="Получатель эскалации" value={String(selectedNode.data.escalationUserId ?? "")} onChange={(event) => updateSelected({ escalationUserId: event.target.value || undefined })}>
                          <option value="">Владелец маршрута</option>
                          {people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                        </WorkspaceSelect>
                      </label>
                      <small>Напоминания получают согласующие этапа. Инициатор видит просрочку отдельно.</small>
                    </fieldset>
                  </>
                ) : null}
                {selectedNode.data.kind === "start" || selectedNode.data.kind === "correction" ? (
                  <label>
                    {selectedNode.data.kind === "start"
                      ? "Должности, которые создают заявки"
                      : "Должности, которые выводят из доработки"}
                    <WorkspaceSelect
                      aria-label={selectedNode.data.kind === "start" ? "Должности создателей заявки" : "Должности для вывода из доработки"}
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
                    </WorkspaceSelect>
                    <small>Можно выбрать одну или несколько должностей</small>
                  </label>
                ) : null}
                {selectedNode.data.kind === "parallel" ? (
                  <label>
                    Завершение параллельных веток
                    <WorkspaceSelect
                      aria-label="Завершение параллельных веток"
                      value={String(selectedNode.data.decisionMode ?? "all")}
                      onChange={(event) => updateSelected({ decisionMode: event.target.value })}
                    >
                      <option value="all">Нужны решения всех</option>
                      <option value="any">Достаточно одного решения</option>
                    </WorkspaceSelect>
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
      <ConfirmActionDialog
        open={pendingRequestDelete !== undefined}
        title="Удалить заявку?"
        message={`Заявка №${pendingRequestDelete?.number ?? ""}, история согласования и документы будут удалены без возможности восстановления.`}
        busy={actionBusy}
        onCancel={() => setPendingRequestDelete(undefined)}
        onConfirm={confirmRequestDelete}
      />
    </section>
  );
}
