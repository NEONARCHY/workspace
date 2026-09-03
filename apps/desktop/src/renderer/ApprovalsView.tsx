import { useCallback, useMemo, useState } from "react";

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

type ApprovalNode = Node<ApprovalNodeData>;
type ApprovalMode = "requests" | "designer";
interface ApprovalEdgeData extends Record<string, unknown> {
  readonly outcome: string;
  readonly condition: Readonly<Record<string, unknown>>;
  readonly sortOrder: number;
}
type ApprovalEdge = Edge<ApprovalEdgeData>;

interface ApprovalsViewProps {
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
        Название проекта
        <Input aria-label={`${prefix}название проекта`} value={form.projectName} onChange={(_event, data) => update("projectName", data.value)} />
      </label>
      <label>
        Код проекта
        <Input aria-label={`${prefix}код проекта`} value={form.projectCode} onChange={(_event, data) => update("projectCode", data.value)} />
      </label>
      <label>
        Счёт или карта отправителя
        <Input aria-label={`${prefix}счёт или карта отправителя`} value={form.sourceAccount} onChange={(_event, data) => update("sourceAccount", data.value)} />
      </label>
      <label>
        Счёт или карта получателя
        <Input aria-label={`${prefix}счёт или карта получателя`} value={form.destinationAccount} onChange={(_event, data) => update("destinationAccount", data.value)} />
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
        Срок оплаты
        <input aria-label={`${prefix}срок оплаты`} type="datetime-local" value={form.deadline} onChange={(event) => update("deadline", event.target.value)} />
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
      <label>
        Ответственный
        <select aria-label={`${prefix}ответственный за заявку`} value={form.responsibleUserId} onChange={(event) => update("responsibleUserId", event.target.value)}>
          {people.map((person) => (
            <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
          ))}
        </select>
      </label>
      <label className="payment-field-wide">
        Комментарий
        <Textarea aria-label={`${prefix}комментарий к заявке`} value={form.comment} onChange={(_event, data) => update("comment", data.value)} />
      </label>
      <fieldset className="payment-trip-fields payment-field-wide">
        <legend>Командировка, если относится к оплате</legend>
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
      </fieldset>
    </div>
  );
}

export function ApprovalsView({
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
  const [editingRequestId, setEditingRequestId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editPurpose, setEditPurpose] = useState("");
  const [editDetails, setEditDetails] = useState<PaymentFormState>(
    emptyPaymentForm(currentUserId),
  );
  const [editFiles, setEditFiles] = useState<readonly File[]>([]);
  const [editAdditionalFiles, setEditAdditionalFiles] = useState<readonly File[]>([]);
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
  const [historyRequestId, setHistoryRequestId] = useState("");

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
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
    if (!requestTitle.trim() || !Number.isFinite(amount) || amount <= 0) return;
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
  };

  const saveRevision = async (request: ApprovalRequestSummary) => {
    const amount = Number(editAmount.replace(/\s/g, ""));
    if (!editTitle.trim() || !Number.isFinite(amount) || amount <= 0) return;
    const saved = await onReviseRequest(
      request,
      requestPayload(editTitle.trim(), amount, editPurpose.trim(), editDetails),
      editFiles,
      editAdditionalFiles,
    );
    if (saved !== undefined) setEditingRequestId("");
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
          <h1>Согласования</h1>
          <p>Заявки и маршруты без изменения кода</p>
        </div>
        <div className="toolbar-actions">
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
          {mode === "designer" ? (
            <Button
              appearance="secondary"
              disabled={!canManage || !saved || workflow?.status !== "draft"}
              onClick={() => void publish()}
            >
              Опубликовать v{workflow?.version ?? "—"}
            </Button>
          ) : null}
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
        <div className="request-board">
          <div className="request-summary">
            <div>
              <strong>{requests.filter((request) => request.status === "running").length}</strong>
              <span>В процессе</span>
            </div>
            <div>
              <strong>{requests.filter((request) => request.status === "needs_revision").length}</strong>
              <span>На доработке</span>
            </div>
            <div>
              <strong>{requests.filter((request) => request.status === "approved").length}</strong>
              <span>Согласованы</span>
            </div>
            <Button
              appearance="primary"
              icon={<Add24Regular />}
              disabled={!canCreateRequest}
              onClick={() => setCreatingRequest(true)}
            >
              Новая заявка
            </Button>
            {!canCreateRequest ? (
              <span className="request-create-policy">Ваша должность не может создавать заявки на оплату</span>
            ) : null}
          </div>
          {creatingRequest ? (
            <div className="quick-create request-create" role="region" aria-label="Создание заявки">
              <Input
                aria-label="Название заявки"
                placeholder="Назначение оплаты"
                value={requestTitle}
                onChange={(_event, data) => setRequestTitle(data.value)}
              />
              <Input
                aria-label="Сумма заявки"
                inputMode="numeric"
                placeholder="Сумма в сумах"
                value={requestAmount}
                onChange={(_event, data) => setRequestAmount(data.value)}
              />
              <Textarea
                aria-label="Назначение платежа"
                placeholder="Что и почему оплачиваем"
                value={requestPurpose}
                onChange={(_event, data) => setRequestPurpose(data.value)}
              />
              <PaymentFields form={requestDetails} people={people} onChange={setRequestDetails} />
              <PendingFilePicker
                files={requestFiles}
                onChange={setRequestFiles}
                label="Приложить документы"
              />
              <PendingFilePicker
                files={requestAdditionalFiles}
                onChange={setRequestAdditionalFiles}
                label="Приложить дополнительные документы"
              />
              <Button appearance="primary" onClick={() => void createRequest()}>
                Отправить по маршруту
              </Button>
              <Button appearance="subtle" onClick={() => setCreatingRequest(false)}>
                Отмена
              </Button>
            </div>
          ) : null}
          <div className="request-list">
            {requests.map((request) => (
              <article key={request.id} className="request-card">
                {request.status === "approved" ? <CheckmarkCircle24Regular /> : <Money24Regular />}
                <div className="request-copy">
                  <strong>{request.title}</strong>
                  <span>
                    {new Intl.NumberFormat("ru-RU").format(request.amount)} {request.currency}, заявка №{request.number}
                  </span>
                  <small>
                    Версия {request.revision}
                    {request.sourceTaskId ? " · создана из задачи" : ""}
                  </small>
                  <small>Этап: {request.stageLabel}</small>
                </div>
                <Badge
                  color={
                    request.status === "approved"
                      ? "success"
                      : request.status === "rejected"
                        ? "danger"
                        : request.status === "needs_revision"
                          ? "warning"
                          : "brand"
                  }
                  appearance="tint"
                >
                  {request.statusLabel}
                </Badge>
                <div className="request-details payment-field-wide">
                  <span>{request.details.projectName || "Проект не указан"}{request.details.projectCode ? ` · ${request.details.projectCode}` : ""}</span>
                  <span>{request.details.requestPriority === "urgent" ? "Срочно" : "Обычный приоритет"}{request.details.paymentPurpose ? ` · ${request.details.paymentPurpose}` : ""}</span>
                  {request.details.paymentReason ? <span>Основание: {request.details.paymentReason}</span> : null}
                  {request.details.deadline ? <span>Оплатить до {new Date(request.details.deadline).toLocaleString("ru-RU")}</span> : null}
                  {request.activeStages.length > 1 ? (
                    <span>Параллельно: {request.activeStages.map((stage) => stage.label).join(" · ")}</span>
                  ) : null}
                </div>
                {request.status === "needs_revision" && latestReturnComment(request) ? (
                  <div className="return-reason">
                    <strong>Причина возврата</strong>
                    <span>{latestReturnComment(request)}</span>
                  </div>
                ) : null}
                {request.status === "running" && request.activeStages.some((stage) => stage.canAct) ? (
                  <div className="request-stage-actions">
                    {request.activeStages.filter((stage) => stage.canAct).map((stage) => (
                      <div key={stage.key}>
                        <strong>{stage.label}</strong>
                        <span>
                          <Button appearance="primary" onClick={() => void onAction(request.id, "approve", { nodeKey: stage.key })}>
                            Согласовать
                          </Button>
                          <Button appearance="subtle" onClick={() => {
                            setReturnRequestId(request.id);
                            setReturnNodeKey(stage.key);
                          }}>
                            Вернуть
                          </Button>
                          <Button appearance="subtle" onClick={() => setDecision({ requestId: request.id, nodeKey: stage.key, action: "reject" })}>
                            Отклонить
                          </Button>
                          <Button appearance="subtle" onClick={() => setDecision({ requestId: request.id, nodeKey: stage.key, action: "clarify" })}>
                            Уточнить
                          </Button>
                          <Button appearance="subtle" onClick={() => setDecision({ requestId: request.id, nodeKey: stage.key, action: "delegate" })}>
                            Делегировать
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : request.status === "needs_revision" && (
                  request.requesterId === currentUserId
                  || request.activeStages.some((stage) => stage.canAct)
                ) ? (
                  <Button appearance="primary" onClick={() => startRevision(request)}>
                    Исправить заявку
                  </Button>
                ) : null}
                {returnRequestId === request.id ? (
                  <div className="request-inline-editor return-editor">
                    <Textarea
                      autoFocus
                      aria-label={`Причина возврата заявки ${request.number}`}
                      placeholder="Что нужно исправить?"
                      value={returnComment}
                      onChange={(_event, data) => setReturnComment(data.value)}
                    />
                    <Button
                      appearance="primary"
                      disabled={!returnComment.trim()}
                      onClick={() => void returnForRevision(request.id)}
                    >
                      Подтвердить возврат
                    </Button>
                    <Button appearance="subtle" onClick={() => setReturnRequestId("")}>Отмена</Button>
                  </div>
                ) : null}
                {decision?.requestId === request.id ? (
                  <div className="request-inline-editor decision-editor">
                    {decision.action === "delegate" ? (
                      <select
                        aria-label={`Новый согласующий заявки ${request.number}`}
                        value={delegateToUserId}
                        onChange={(event) => setDelegateToUserId(event.target.value)}
                      >
                        <option value="">Выберите сотрудника</option>
                        {people.filter((person) => person.id !== currentUserId).map((person) => (
                          <option key={person.id} value={person.id}>{person.name} · {person.jobTitle ?? person.role}</option>
                        ))}
                      </select>
                    ) : null}
                    <Textarea
                      aria-label={`Комментарий решения по заявке ${request.number}`}
                      placeholder={decision.action === "reject" ? "Причина отклонения обязательна" : "Комментарий"}
                      value={decisionComment}
                      onChange={(_event, data) => setDecisionComment(data.value)}
                    />
                    <Button
                      appearance="primary"
                      disabled={(decision.action === "reject" && !decisionComment.trim()) || (decision.action === "delegate" && !delegateToUserId)}
                      onClick={() => void completeDecision()}
                    >
                      Подтвердить
                    </Button>
                    <Button appearance="subtle" onClick={() => setDecision(undefined)}>Отмена</Button>
                  </div>
                ) : null}
                {editingRequestId === request.id ? (
                  <div className="request-inline-editor correction-editor" aria-label="Редактирование возвращённой заявки">
                    <Input
                      aria-label="Исправленное название заявки"
                      value={editTitle}
                      onChange={(_event, data) => setEditTitle(data.value)}
                    />
                    <Input
                      aria-label="Исправленная сумма заявки"
                      inputMode="numeric"
                      value={editAmount}
                      onChange={(_event, data) => setEditAmount(data.value)}
                    />
                    <Textarea
                      aria-label="Исправленное назначение платежа"
                      value={editPurpose}
                      onChange={(_event, data) => setEditPurpose(data.value)}
                    />
                    <PaymentFields form={editDetails} people={people} onChange={setEditDetails} revision />
                    <PendingFilePicker
                      files={editFiles}
                      onChange={setEditFiles}
                      label="Добавить исправленные документы"
                    />
                    <PendingFilePicker
                      files={editAdditionalFiles}
                      onChange={setEditAdditionalFiles}
                      label="Добавить дополнительные исправленные документы"
                    />
                    <Button appearance="primary" onClick={() => void saveRevision(request)}>
                      Сохранить и отправить повторно
                    </Button>
                    <Button appearance="subtle" onClick={() => setEditingRequestId("")}>Отмена</Button>
                  </div>
                ) : null}
                <div className="request-attachments">
                  <AttachmentPanel
                    title="Основные документы"
                    attachments={attachments.filter(
                      (attachment) =>
                        attachment.ownerType === "approval_request"
                        && attachment.ownerId === request.id
                        && ["primary", "general"].includes(attachment.documentRole),
                    )}
                    canUpload={
                      (request.requesterId === currentUserId
                        && ["running", "needs_revision"].includes(request.status))
                      || (request.status === "needs_revision"
                        && request.activeStages.some((stage) => stage.canAct))
                    }
                    onUpload={(files) => onUploadAttachments(request, files, "primary")}
                    onDownload={onDownloadAttachment}
                  />
                  <AttachmentPanel
                    title="Дополнительные документы"
                    attachments={attachments.filter(
                      (attachment) =>
                        attachment.ownerType === "approval_request"
                        && attachment.ownerId === request.id
                        && attachment.documentRole === "additional",
                    )}
                    canUpload={
                      (request.requesterId === currentUserId
                        && ["running", "needs_revision"].includes(request.status))
                      || (request.status === "needs_revision"
                        && request.activeStages.some((stage) => stage.canAct))
                    }
                    onUpload={(files) => onUploadAttachments(request, files, "additional")}
                    onDownload={onDownloadAttachment}
                  />
                  {request.requesterId === currentUserId && ["draft", "running", "needs_revision"].includes(request.status) ? (
                    <Button appearance="subtle" onClick={() => void onAction(request.id, "cancel", { comment: "Отменено автором" })}>
                      Отменить заявку
                    </Button>
                  ) : null}
                  <Button
                    appearance="subtle"
                    onClick={() => setHistoryRequestId(historyRequestId === request.id ? "" : request.id)}
                  >
                    {historyRequestId === request.id ? "Скрыть историю" : "История версий"}
                  </Button>
                </div>
                {historyRequestId === request.id ? (
                  <div className="request-history" aria-label={`История версий заявки ${request.number}`}>
                    {request.versions.slice().reverse().map((version) => (
                      <div key={version.version}>
                        <strong>Версия {version.version}</strong>
                        <span>{new Intl.NumberFormat("ru-RU").format(version.amount)} {version.currency}</span>
                        <small>
                          {version.changeReason === "initial"
                            ? "Создание"
                            : version.changeReason === "attachment_added"
                              ? "Добавлен файл"
                              : "Исправление"}
                          {version.changeComment ? ` · ${version.changeComment}` : ""}
                        </small>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
            {requests.length === 0 ? (
              <div className="empty-state">
                <Money24Regular />
                <strong>Заявок пока нет</strong>
                <span>Подключите сервер или создайте первую заявку.</span>
              </div>
            ) : null}
          </div>
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
