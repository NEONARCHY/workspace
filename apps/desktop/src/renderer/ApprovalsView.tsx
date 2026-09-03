import { useCallback, useMemo, useState } from "react";

import type {
  ApprovalNodeData,
  ApprovalNodeKind,
  ApprovalRequestSummary,
  WorkflowDefinition,
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
  readonly currentUserId: string;
  readonly requests: readonly ApprovalRequestSummary[];
  readonly workflow?: WorkflowDefinition;
  readonly onSaveWorkflow: (workflow: WorkflowDefinition) => void | Promise<void>;
  readonly onCreateRequest: (
    title: string,
    amount: number,
  ) => ApprovalRequestSummary | undefined | Promise<ApprovalRequestSummary | undefined>;
  readonly onAction: (
    requestId: string,
    action: "approve" | "reject" | "return" | "resubmit",
  ) => void | Promise<void>;
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

function flowNodes(workflow?: WorkflowDefinition): ApprovalNode[] {
  if (workflow === undefined) return initialNodes;
  return workflow.nodes.map((node) => ({
    id: node.id,
    position: { x: node.positionX, y: node.positionY },
    data: { label: node.label, kind: node.kind, detail: node.detail },
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

export function ApprovalsView({
  canManage,
  currentUserId,
  requests,
  workflow,
  onSaveWorkflow,
  onCreateRequest,
  onAction,
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

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const connect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            data: { outcome: "approve", condition: {}, sortOrder: 0 },
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          current,
        ),
      );
      setSaved(false);
    },
    [setEdges],
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
        config: {},
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
    const created = await onCreateRequest(requestTitle.trim(), amount);
    if (created !== undefined) {
      setRequestTitle("");
      setRequestAmount("");
      setCreatingRequest(false);
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
            <Button appearance="primary" icon={<Add24Regular />} onClick={() => setCreatingRequest(true)}>
              Новая заявка
            </Button>
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
              <article key={request.id}>
                {request.status === "approved" ? <CheckmarkCircle24Regular /> : <Money24Regular />}
                <div>
                  <strong>{request.title}</strong>
                  <span>
                    {new Intl.NumberFormat("ru-RU").format(request.amount)} {request.currency}, заявка №{request.number}
                  </span>
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
                {request.status === "running" && canManage ? (
                  <div className="request-actions">
                    <Button appearance="primary" onClick={() => void onAction(request.id, "approve")}>
                      Согласовать
                    </Button>
                    <Button appearance="subtle" onClick={() => void onAction(request.id, "return")}>
                      Вернуть
                    </Button>
                  </div>
                ) : request.status === "needs_revision" && request.requesterId === currentUserId ? (
                  <Button appearance="primary" onClick={() => void onAction(request.id, "resubmit")}>
                    Отправить повторно
                  </Button>
                ) : (
                  <Button appearance="subtle">История</Button>
                )}
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
              <p>Версия {workflow?.version ?? 3}, черновик</p>
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
