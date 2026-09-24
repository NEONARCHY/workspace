import type { ApprovalRequestSummary } from "@yuksalish/contracts";
import { workflowStageColor } from "./workflow-stage-colors";

// Read-only Bitrix crm.status.list, DYNAMIC_1038_STAGE_15, 2026-09-04.
// Stable node keys keep their colour when a workflow is reordered or renamed.
export const paymentStageColors: Readonly<Record<string, string>> = {
  start: "#f26b47",
  project_financier: "#f78d4d",
  finance_manager_projects: "#fdb051",
  members: "#fff55a",
  chair_assistant: "#7bc56f",
  chief_accountant: "#abd46c",
  deputy_chair: "#00bbb4",
  chair: "#00bef6",
  awaiting_payment: "#f16ca8",
  payment: "#a5de00",
  correction: "#6b52cc",
  completed: "#00ff00",
  cancelled: "#ff0000",
};

export function approvalStagePalette(column: { readonly key: string; readonly kind: string; readonly label: string; readonly color?: string }) {
  const fallback = column.kind === "end"
    ? paymentStageColors[/отмен|отклон/i.test(column.label) ? "cancelled" : "completed"]
    : paymentStageColors[column.kind];
  const background = workflowStageColor(column.color, paymentStageColors[column.key] ?? fallback ?? "#dbe8f5");
  return { background, foreground: background === paymentStageColors.correction ? "#ffffff" : "#111111" };
}

const integerFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export function formatMinorUnits(minorUnits: bigint | null, currency: string): string {
  if (minorUnits === null) return `Проверьте сумму (${currency})`;
  const absolute = minorUnits < 0n ? -minorUnits : minorUnits;
  const fraction = absolute % 100n;
  const amount = `${minorUnits < 0n ? "−" : ""}${integerFormat.format(absolute / 100n)}${fraction ? `,${String(fraction).padStart(2, "0")}` : ""}`;
  return `${amount} ${currency}`;
}

/** Sum minor units before formatting; never add different currencies together. */
export function approvalColumnTotals(requests: readonly Pick<ApprovalRequestSummary, "amount" | "currency">[]) {
  const totals = new Map<string, bigint | null>();
  for (const request of requests) {
    const currency = request.currency.trim().toUpperCase() || "UZS";
    const previous = totals.get(currency) ?? 0n;
    if (totals.get(currency) === null || !Number.isFinite(request.amount) || Math.abs(request.amount) >= 1e21) {
      totals.set(currency, null);
      continue;
    }
    totals.set(currency, previous + BigInt(request.amount.toFixed(2).replace(".", "")));
  }
  if (!totals.size) totals.set("UZS", 0n);
  return [...totals.entries()]
    .sort(([left], [right]) => left === right ? 0 : left === "UZS" ? -1 : right === "UZS" ? 1 : left.localeCompare(right))
    .map(([currency, minorUnits]) => ({ currency, minorUnits, formatted: formatMinorUnits(minorUnits, currency) }));
}

export interface ApprovalDeadlinePresentation {
  readonly tone: "neutral" | "attention" | "urgent" | "success";
  readonly label: string;
  readonly detail: string;
}

export interface ApprovalCardStatusPresentation {
  readonly tone: "neutral" | "action" | "revision" | "overdue" | "success" | "danger";
  readonly label: string;
}

/** Compact, textual card status. Colour is only a secondary signal in the UI. */
export function approvalCardStatusPresentation(
  request: Pick<ApprovalRequestSummary, "status" | "statusLabel" | "requesterId" | "deadlineControl"> & {
    readonly activeStages: readonly { readonly canAct: boolean }[];
    readonly details: { readonly deadline?: string | null };
  },
  currentUserId: string,
  now = new Date(),
): ApprovalCardStatusPresentation {
  const deadline = approvalDeadlinePresentation(request, now);
  if (deadline.label.startsWith("Просрочено")) {
    return { tone: "overdue", label: deadline.label };
  }
  if (request.status === "needs_revision") {
    return { tone: "revision", label: "Требует доработки" };
  }
  if (["rejected", "cancelled"].includes(request.status)) {
    return { tone: "danger", label: request.statusLabel };
  }
  if (request.status === "approved") {
    return { tone: "success", label: request.statusLabel || "Согласовано" };
  }
  if (approvalRequestNeedsAction(request, currentUserId)) {
    return { tone: "action", label: "Нужно ваше решение" };
  }
  return { tone: "neutral", label: request.statusLabel };
}

/** A decision or correction the signed-in person can actually act on. */
export function approvalRequestNeedsAction(
  request: { readonly status: ApprovalRequestSummary["status"]; readonly activeStages: readonly { readonly canAct: boolean }[]; readonly requesterId: string },
  currentUserId: string,
): boolean {
  if (request.status === "running") return request.activeStages.some(stage => stage.canAct);
  if (request.status === "needs_revision") {
    return request.requesterId === currentUserId || request.activeStages.some(stage => stage.canAct);
  }
  return false;
}

export function approvalRequestIsOverdue(
  request: Pick<ApprovalRequestSummary, "status" | "deadlineControl"> & {
    readonly details: { readonly deadline?: string | null };
  },
  now = new Date(),
): boolean {
  return approvalDeadlinePresentation(request, now).label.startsWith("Просрочено");
}

export function formatDeadlineDistance(seconds: number): string {
  const absolute = Math.abs(seconds);
  if (absolute < 3600) return `${Math.max(1, Math.ceil(absolute / 60))} мин.`;
  if (absolute < 86400) return `${Math.ceil(absolute / 3600)} ч.`;
  return `${Math.ceil(absolute / 86400)} дн.`;
}

export function approvalDeadlinePresentation(
  request: Pick<ApprovalRequestSummary, "status" | "deadlineControl"> & {
    readonly details: { readonly deadline?: string | null };
  },
  now = new Date(),
): ApprovalDeadlinePresentation {
  const deadline = request.details.deadline ? new Date(request.details.deadline) : undefined;
  if (deadline === undefined || !Number.isFinite(deadline.getTime())) {
    return { tone: "neutral", label: "Без срока", detail: "Контроль срока не запущен" };
  }
  if (["approved", "rejected", "cancelled"].includes(request.status)) {
    return { tone: "success", label: "Завершена", detail: "Контроль срока остановлен" };
  }
  const remaining = request.deadlineControl?.remainingSeconds
    ?? Math.floor((deadline.getTime() - now.getTime()) / 1000);
  if (remaining < 0) {
    return {
      tone: "urgent",
      label: `Просрочено на ${formatDeadlineDistance(remaining)}`,
      detail: "Инициатор уведомлён; действует правило эскалации",
    };
  }
  if (remaining <= 2 * 3600) {
    return {
      tone: "urgent",
      label: `Осталось ${formatDeadlineDistance(remaining)}`,
      detail: "Срок требует немедленного внимания",
    };
  }
  if (remaining <= 24 * 3600) {
    return {
      tone: "attention",
      label: `Осталось ${formatDeadlineDistance(remaining)}`,
      detail: "Срок приближается",
    };
  }
  return {
    tone: "neutral",
    label: `Осталось ${formatDeadlineDistance(remaining)}`,
    detail: "Заявка идёт по графику",
  };
}
