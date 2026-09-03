import { useCallback, useMemo, useState } from "react";

import type { ApprovalNodeData, ApprovalNodeKind } from "@yuksalish/contracts";
import {
  Badge,
  Button,
  Input,
  Tab,
  TabList,
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

const initialEdges: Edge[] = [
  { id: "e1", source: "start", target: "manager", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e2", source: "manager", target: "amount", markerEnd: { type: MarkerType.ArrowClosed } },
  {
    id: "e3",
    source: "amount",
    target: "finance",
    label: "Да",
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  {
    id: "e4",
    source: "amount",
    target: "director",
    label: "Нет",
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  { id: "e5", source: "finance", target: "director", markerEnd: { type: MarkerType.ArrowClosed } },
  { id: "e6", source: "director", target: "approved", markerEnd: { type: MarkerType.ArrowClosed } },
  {
    id: "e7",
    source: "manager",
    target: "correction",
    label: "Вернуть",
    markerEnd: { type: MarkerType.ArrowClosed },
  },
  { id: "e8", source: "correction", target: "start", markerEnd: { type: MarkerType.ArrowClosed } },
];

const kindLabels: Readonly<Record<ApprovalNodeKind, string>> = {
  start: "Старт",
  approval: "Согласование",
  condition: "Условие",
  parallel: "Параллельные ветки",
  correction: "Доработка",
  end: "Завершение",
};

export function ApprovalsView() {
  const [mode, setMode] = useState<ApprovalMode>("designer");
  const [nodes, setNodes, onNodesChange] = useNodesState<ApprovalNode>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNodeId, setSelectedNodeId] = useState<string>("amount");
  const [saved, setSaved] = useState(true);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const connect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge({ ...connection, markerEnd: { type: MarkerType.ArrowClosed } }, current),
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

  return (
    <section className="workspace-view approvals-view" aria-label="Согласования">
      <header className="section-toolbar approvals-toolbar">
        <div>
          <h1>Согласования</h1>
          <p>Заявки и маршруты без изменения кода</p>
        </div>
        <div className="toolbar-actions">
          <Badge appearance="tint" color={saved ? "success" : "warning"}>
            {saved ? "Черновик сохранён" : "Есть изменения"}
          </Badge>
          <Button appearance="primary" icon={<Save24Regular />} onClick={() => setSaved(true)}>
            Сохранить
          </Button>
        </div>
      </header>

      <div className="approvals-tabs">
        <TabList
          selectedValue={mode}
          onTabSelect={(_event, data) => setMode(data.value as ApprovalMode)}
        >
          <Tab value="requests">Текущие заявки</Tab>
          <Tab value="designer">Конструктор маршрутов</Tab>
        </TabList>
      </div>

      {mode === "requests" ? (
        <div className="request-board">
          <div className="request-summary">
            <div><strong>4</strong><span>Ожидают меня</span></div>
            <div><strong>7</strong><span>В процессе</span></div>
            <div><strong>18</strong><span>Завершены за месяц</span></div>
          </div>
          <div className="request-list">
            <article>
              <Money24Regular />
              <div><strong>Оплата ноутбуков для нового офиса</strong><span>84 600 000 сум, заявка №148</span></div>
              <Badge color="warning" appearance="tint">Ожидает решения</Badge>
              <Button appearance="primary">Рассмотреть</Button>
            </article>
            <article>
              <Money24Regular />
              <div><strong>Продление лицензий на программное обеспечение</strong><span>12 400 000 сум, заявка №147</span></div>
              <Badge color="brand" appearance="tint">Финансы</Badge>
              <Button appearance="secondary">Открыть</Button>
            </article>
            <article>
              <CheckmarkCircle24Regular />
              <div><strong>Аванс на региональное мероприятие</strong><span>6 800 000 сум, заявка №142</span></div>
              <Badge color="success" appearance="tint">Согласовано</Badge>
              <Button appearance="subtle">История</Button>
            </article>
          </div>
        </div>
      ) : (
        <div className="workflow-layout">
          <aside className="workflow-library">
            <div>
              <span className="detail-kicker">Шаблон</span>
              <h2>Заявка на оплату</h2>
              <p>Версия 3, черновик</p>
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
