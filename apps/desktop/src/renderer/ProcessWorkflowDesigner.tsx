import { useMemo, useState } from "react";
import { Button, Input, Textarea } from "@fluentui/react-components";
import { ArrowLeft20Regular, ArrowRight20Regular, Save20Regular } from "@fluentui/react-icons";
import type { WorkflowDefinition, WorkflowNodeDefinition } from "@yuksalish/contracts";

interface ProcessWorkflowDesignerProps {
  readonly workflow: WorkflowDefinition;
  readonly processName: string;
  readonly accent: "project" | "trip";
  readonly onSave: (workflow: WorkflowDefinition) => Promise<void> | void;
  readonly onPublish: (workflow: WorkflowDefinition) => Promise<WorkflowDefinition | undefined> | WorkflowDefinition | undefined;
}

function ordered(nodes: readonly WorkflowNodeDefinition[]) {
  return [...nodes].sort((left, right) => left.positionX - right.positionX);
}

export function ProcessWorkflowDesigner({ workflow, processName, accent, onSave, onPublish }: ProcessWorkflowDesignerProps) {
  const [nodes, setNodes] = useState(() => ordered(workflow.nodes));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const changed = useMemo(() => JSON.stringify(nodes) !== JSON.stringify(ordered(workflow.nodes)), [nodes, workflow.nodes]);

  const updateNode = (id: string, patch: Partial<WorkflowNodeDefinition>) => {
    setNodes((current) => current.map((node) => node.id === id ? { ...node, ...patch } : node));
    setMessage("");
  };
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= nodes.length) return;
    setNodes((current) => {
      const next = [...current];
      const active = next[index]!;
      next[index] = next[target]!;
      next[target] = active;
      return next.map((node, position) => ({ ...node, positionX: position * 260 }));
    });
    setMessage("");
  };
  const definition = (): WorkflowDefinition => ({ ...workflow, nodes });
  const save = async () => {
    setSaving(true);
    try {
      await onSave(definition());
      setMessage("Черновик сохранён");
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    setSaving(true);
    try {
      if (changed) await onSave(definition());
      const next = await onPublish(definition());
      if (next) setMessage(`Версия ${workflow.version} опубликована`);
    } finally {
      setSaving(false);
    }
  };

  return <section className={`process-workflow-designer tone-${accent}`} aria-label={`Конструктор маршрута: ${processName}`}>
    <header>
      <div><span>Независимый маршрут</span><h2>{processName}</h2><p>Названия и порядок этапов относятся только к этому разделу.</p></div>
      <div className="process-workflow-actions">
        {message ? <span role="status">{message}</span> : null}
        <Button appearance="secondary" icon={<Save20Regular />} disabled={saving || !changed} onClick={() => void save()}>Сохранить</Button>
        <Button appearance="primary" disabled={saving || workflow.status !== "draft"} onClick={() => void publish()}>Опубликовать v{workflow.version}</Button>
      </div>
    </header>
    <div className="process-workflow-route" role="list" aria-label="Этапы маршрута">
      {nodes.map((node, index) => <article role="listitem" key={node.id} className={`kind-${node.kind}`}>
        <div className="process-workflow-card-head"><span>{index + 1}</span><small>{node.kind === "start" ? "Начало" : node.kind === "end" ? "Завершение" : "Рабочий этап"}</small></div>
        <label>Название<Input value={node.label} onChange={(_, data) => updateNode(node.id, { label: data.value })} /></label>
        <label>Пояснение<Textarea resize="vertical" value={node.detail} onChange={(_, data) => updateNode(node.id, { detail: data.value })} /></label>
        <div className="process-workflow-order" role="group" aria-label={`Положение этапа «${node.label}»`}>
          <Button appearance="subtle" icon={<ArrowLeft20Regular />} aria-label="Переместить этап влево" disabled={index === 0} onClick={() => move(index, -1)} />
          <Button appearance="subtle" icon={<ArrowRight20Regular />} aria-label="Переместить этап вправо" disabled={index === nodes.length - 1} onClick={() => move(index, 1)} />
        </div>
      </article>)}
    </div>
    <footer>Маршрут хранится отдельно от заявок на оплату и другого раздела. Опубликованные версии остаются неизменяемыми.</footer>
  </section>;
}
