import type { ApprovalRequestSummary } from "@yuksalish/contracts";

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

export function approvalStagePalette(column: { readonly key: string; readonly kind: string; readonly label: string }) {
  const fallback = column.kind === "end"
    ? paymentStageColors[/отмен|отклон/i.test(column.label) ? "cancelled" : "completed"]
    : paymentStageColors[column.kind];
  const background = paymentStageColors[column.key] ?? fallback ?? "#dbe8f5";
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
