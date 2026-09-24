export interface WorkflowStageColorOption {
  readonly key: string;
  readonly label: string;
  readonly accent: string;
  readonly surface: string;
}

/** Shared calm palette for process lanes. The accent is persisted in node config. */
export const workflowStageColors: readonly WorkflowStageColorOption[] = [
  { key: "sky", label: "Небесный", accent: "#72b9dc", surface: "#e5f2f8" },
  { key: "aqua", label: "Аквамарин", accent: "#50bec8", surface: "#e2f3f3" },
  { key: "mint", label: "Мятный", accent: "#73bf9b", surface: "#e5f3eb" },
  { key: "green", label: "Зелёный", accent: "#62bd72", surface: "#e4f3e7" },
  { key: "lime", label: "Лаймовый", accent: "#a8c96a", surface: "#edf4df" },
  { key: "sand", label: "Песочный", accent: "#d8b86c", surface: "#f5eedf" },
  { key: "peach", label: "Персиковый", accent: "#df9b75", surface: "#f7e9e1" },
  { key: "rose", label: "Розовый", accent: "#d98b9a", surface: "#f6e6e9" },
  { key: "red", label: "Коралловый", accent: "#d97878", surface: "#f6e4e4" },
  { key: "lilac", label: "Сиреневый", accent: "#a595ce", surface: "#ede9f6" },
  { key: "blue", label: "Лавандово-синий", accent: "#849fd0", surface: "#e8edf7" },
  { key: "slate", label: "Серо-голубой", accent: "#8ca9b3", surface: "#e9f0f1" },
];

export function workflowStageColor(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

const processStageDefaults: Readonly<Record<"project" | "trip", Readonly<Record<string, string>>>> = {
  project: {
    start: "#72b9dc",
    preparation: "#d8b86c",
    approval: "#849fd0",
    success: "#62bd72",
    failure: "#d97878",
  },
  trip: {
    launch: "#72b9dc",
    hr: "#50bec8",
    manager_approval: "#849fd0",
    rejected: "#d97878",
    approved: "#62bd72",
  },
};

export function processStageColor(process: "project" | "trip", nodeId: string, index: number): string {
  return processStageDefaults[process][nodeId]
    ?? workflowStageColors[index % workflowStageColors.length]!.accent;
}

export function nextAvailableStageColor(usedColors: readonly string[]): string {
  const usage = new Map<string, number>();
  for (const color of usedColors) usage.set(color.toLowerCase(), (usage.get(color.toLowerCase()) ?? 0) + 1);
  return workflowStageColors
    .slice()
    .sort((left, right) => (usage.get(left.accent.toLowerCase()) ?? 0) - (usage.get(right.accent.toLowerCase()) ?? 0))[0]!
    .accent;
}
