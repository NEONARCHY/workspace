import type { TripAction, TripRequest, TripStage, WorkflowDefinition, WorkflowPosition } from "@yuksalish/contracts";

// Read-only Bitrix metadata: entity 1038, category 17, verified 2026-09-04.
export const tripColumns: readonly { key: TripStage; label: string; color: string }[] = [
  { key: "launch", label: "Запуск", color: "#72b9dc" },
  { key: "deputy_approval", label: "Согласование первого заместителя", color: "#50bec8" },
  { key: "manager_approval", label: "Утверждение председателем", color: "#849fd0" },
  { key: "approved", label: "Утверждено", color: "#62bd72" },
  { key: "rejected", label: "Отклонено", color: "#d97878" },
];

/** The HR handoff sits directly after the chairman on the board. */
export function tripBoardColumns(columns = tripColumns): typeof tripColumns {
  return columns.flatMap((column) => column.key === "manager_approval" ? [
    column, { key: "hr", label: "Кадровая служба", color: "#d8b86c" },
  ] : [column]);
}

/** Show the protected live route instead of the archived HR graph in old draft templates. */
function normalizeTripWorkflow(
  workflow: WorkflowDefinition, positions: readonly WorkflowPosition[],
): WorkflowDefinition {
  const historicHr = workflow.nodes.find((node) => node.id === "hr");
  if (!historicHr || workflow.nodes.some((node) => node.id === "deputy_approval")) return workflow;
  const manager = workflow.nodes.find((node) => node.id === "manager_approval");
  const deputyPosition = positions.find((position) => position.name.startsWith("Rais birinchi"));
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => node.id === "hr" ? {
      ...node, id: "deputy_approval", label: "Согласование первого заместителя",
      detail: "Решение первого заместителя председателя", positionX: manager?.positionX ?? node.positionX,
      config: deputyPosition ? { approverPositionId: deputyPosition.id } : {},
    } : node.id === "manager_approval" ? {
      ...node, label: "Утверждение председателем", detail: "Резолюция председателя",
      positionX: historicHr.positionX,
    } : node),
    edges: workflow.edges.map((edge) => {
      const key = `${edge.source}:${edge.target}`;
      if (key === "launch:manager_approval") return { ...edge, target: "deputy_approval" };
      if (key === "manager_approval:hr") return { ...edge, source: "deputy_approval", target: "manager_approval" };
      if (key === "hr:approved") return { ...edge, source: "manager_approval" };
      if (edge.source === "hr") return { ...edge, source: "deputy_approval" };
      if (edge.target === "hr") return { ...edge, target: "deputy_approval" };
      return edge;
    }),
  };
}

export function currentTripWorkflow(workflow: WorkflowDefinition, positions: readonly WorkflowPosition[]): WorkflowDefinition {
  const current = normalizeTripWorkflow(workflow, positions);
  if (current.nodes.some(node => node.id === "hr")) return current;
  const chair = current.nodes.find(node => node.id === "manager_approval");
  if (!chair) return current;
  const x = chair.positionX + 260;
  return { ...current,
    nodes: [...current.nodes.map(node => node.positionX >= x ? { ...node, positionX: node.positionX + 260 } : node),
      { id: "hr", kind: "approval", label: "Кадровая служба", detail: "Назначенный в HR кадровик оформляет приказ",
        positionX: x, positionY: chair.positionY, config: {} }],
    edges: current.edges.flatMap(edge => edge.source === "manager_approval" && edge.target === "approved"
      ? [{ ...edge, target: "hr" }, { ...edge, id: `${edge.id}-hr`, source: "hr", target: "approved" }] : [edge]),
  };
}

// UI only proposes an existing action. The server remains the authority on permissions.
export function tripDropAction(request: Pick<TripRequest, "stage" | "status" | "allowedActions" | "workflowVersion" | "hrProcessingRequired">, target: TripStage, administrator = false): TripAction | undefined {
  const modern = (request.workflowVersion ?? 1) >= 2;
  if (administrator && !modern && !request.hrProcessingRequired && request.stage !== target) return "move";
  if (request.hrProcessingRequired && request.stage === "manager_approval") {
    const action = target === "hr" ? "approve" : target === "launch" ? "return" : target === "rejected" ? "reject" : undefined;
    return action && request.allowedActions.includes(action) ? action : undefined;
  }
  if (request.hrProcessingRequired && request.stage === "hr") {
    const action = target === "approved" ? "complete" : target === "launch" ? "return" : target === "rejected" ? "reject" : undefined;
    return action && request.allowedActions.includes(action) ? action : undefined;
  }
  let action: TripAction | undefined;
  if (request.stage === "launch" && target === (request.workflowVersion === 3 ? "deputy_approval" : "manager_approval")) {
    action = request.status === "needs_revision" ? "resubmit" : "submit";
  } else if (request.stage === "deputy_approval" && request.workflowVersion === 3) {
    if (target === "manager_approval") action = "approve";
    else if (target === "launch") action = "return";
    else if (target === "rejected") action = "reject";
  } else if (request.stage === "manager_approval" || (!modern && request.stage === "hr")) {
    if (target === (request.stage === "manager_approval" && !modern ? "hr" : "approved")) action = "approve";
    else if (target === "launch") action = "return";
    else if (target === "rejected") action = "reject";
  }
  return action && request.allowedActions.includes(action) ? action : undefined;
}

export function tripColumnTotal(requests: readonly TripRequest[]): string {
  // TripRequest has no monetary field. Unknown costs must not be presented as zero.
  return requests.length ? "Не задана" : "0 UZS";
}
