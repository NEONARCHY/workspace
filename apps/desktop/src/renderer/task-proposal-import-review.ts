import type { TaskProposalDraft, TaskProposalImportRow, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";

const cyrillic: Readonly<Record<string, string>> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i",
  й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
  у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ь: "",
  ы: "i", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h",
};
export const importNameKey = (value: string): string => [...value.toLowerCase()]
  .map(char => cyrillic[char] ?? char).join("").replace(/x/g, "h")
  .replace(/['‘’ʼʻ`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function isUnspecifiedName(hint: string): boolean {
  return !hint.trim() || ["aniqlash kerak", "нужно определить"].includes(hint.trim().toLowerCase());
}

export function suggestImportPerson(hint: string, people: readonly WorkspacePerson[]): string {
  if (isUnspecifiedName(hint)) return "";
  const words = importNameKey(hint).split(" ").filter(word => !["aka", "opa"].includes(word));
  if (!words.length) return "";
  const matches = people.filter(person => {
    const parts = importNameKey(person.name).split(" ");
    return words.every(word => parts.includes(word));
  });
  return matches.length === 1 ? matches[0]?.id ?? "" : "";
}

export interface ProposalImportDraft {
  readonly source: TaskProposalImportRow;
  readonly included: boolean;
  readonly title: string;
  readonly description: string;
  readonly assigneeOverride: string;
  readonly assigneeDeferred: boolean;
  readonly dueAt: string;
  readonly deadlineAcknowledged: boolean;
  readonly duplicateAcknowledged: boolean;
}

export function newImportDraft(row: TaskProposalImportRow): ProposalImportDraft {
  return { source: row, included: true, title: row.title, description: row.description,
    assigneeOverride: "", assigneeDeferred: isUnspecifiedName(row.assigneeHint),
    dueAt: row.dueAtHint && Date.parse(row.dueAtHint) > Date.now() ? row.dueAtHint : "",
    deadlineAcknowledged: false, duplicateAcknowledged: false };
}

export function importAssignee(draft: ProposalImportDraft, mapping: Readonly<Record<string, string>>): string {
  return draft.assigneeDeferred ? "" : draft.assigneeOverride || mapping[draft.source.assigneeHint] || "";
}

export function matchingTaskTitles(title: string, tasks: readonly WorkspaceTask[]): readonly string[] {
  const key = importTitleKey(title);
  return key ? tasks.filter(task => importTitleKey(task.title) === key).map(task => task.title) : [];
}

export const importTitleKey = (title: string): string => title.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

export function importRowProblems(draft: ProposalImportDraft, mapping: Readonly<Record<string, string>>,
  people: readonly WorkspacePerson[], tasks: readonly WorkspaceTask[], duplicateInFile = false): string[] {
  if (!draft.included) return [];
  const problems: string[] = [];
  const active = new Set(people.map(person => person.id));
  if (!draft.title.trim() || draft.title.trim().length > 240) problems.push("Проверьте название");
  if ((importTaskPayload({ ...draft, dueAt: "" }, mapping, "").description?.length ?? 0) > 19_400) problems.push("Описание с примечаниями слишком длинное");
  if (!draft.assigneeDeferred && !active.has(importAssignee(draft, mapping))) problems.push("Выберите ответственного");
  if (draft.source.coexecutorHints.some(hint => !active.has(mapping[hint] ?? ""))) problems.push("Уточните соисполнителей");
  if (draft.dueAt && (!Number.isFinite(Date.parse(draft.dueAt)) || Date.parse(draft.dueAt) <= Date.now())) problems.push("Нужен будущий срок");
  if (draft.source.deadlineText && !draft.dueAt && !draft.deadlineAcknowledged) problems.push("Проверьте исходный срок");
  if (!draft.duplicateAcknowledged && (duplicateInFile || matchingTaskTitles(draft.title, tasks).length)) problems.push("Проверьте совпадение названия");
  return problems;
}

export function importTaskPayload(draft: ProposalImportDraft, mapping: Readonly<Record<string, string>>,
  sourceName: string): TaskProposalDraft {
  const assigneeId = importAssignee(draft, mapping);
  const coexecutors = [...new Set(draft.source.coexecutorHints.map(hint => mapping[hint] ?? ""))]
    .filter(id => id && id !== assigneeId);
  return {
    title: draft.title.trim(), assigneeId: assigneeId || undefined, priority: "normal", project: "Без проекта",
    description: [draft.description.trim(), draft.source.note ? `Примечание из файла:\n${draft.source.note}` : "",
      draft.source.deadlineText ? `Исходный срок: ${draft.source.deadlineText}${!draft.dueAt ? ". Точный срок требует уточнения." : ""}` : "",
      draft.assigneeDeferred ? `Ответственного назначит председатель при одобрении. В файле: ${draft.source.assigneeHint || "не указан"}.` : "",
      `Источник: ${sourceName} · ${draft.source.sourceKey}`].filter(Boolean).join("\n\n"),
    dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : undefined,
    participants: coexecutors.map(userId => ({ userId, role: "co_assignee" })),
  };
}
