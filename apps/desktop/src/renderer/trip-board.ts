import type { TripAction, TripRequest, TripStage } from "@yuksalish/contracts";

// Read-only Bitrix metadata: entity 1038, category 17, verified 2026-09-04.
export const tripColumns: readonly { key: TripStage; label: string; color: string }[] = [
  { key: "launch", label: "Запуск", color: "#72b9dc" },
  { key: "manager_approval", label: "Утверждение руководителем", color: "#849fd0" },
  { key: "hr", label: "Кадровая служба · прежний маршрут", color: "#50bec8" },
  { key: "approved", label: "Утверждено", color: "#62bd72" },
  { key: "rejected", label: "Отклонено", color: "#d97878" },
];

// UI only proposes an existing action. The server remains the authority on permissions.
export function tripDropAction(request: Pick<TripRequest, "stage" | "status" | "allowedActions" | "workflowVersion">, target: TripStage, administrator = false): TripAction | undefined {
  const modern = request.workflowVersion === 2;
  if (administrator && !modern && request.stage !== target) return "move";
  let action: TripAction | undefined;
  if (request.stage === "launch" && target === "manager_approval") {
    action = request.status === "needs_revision" ? "resubmit" : "submit";
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
