import type { AssistantActionDraft, WorkspacePerson } from "@yuksalish/contracts";

export function isFormOpenSignal(text: string): boolean {
  return /^(?:да[,!]?\s*)?(?:открывай|открой|открыть)(?:\s+(?:заполненную\s+)?форму)?[.!]?$/iu.test(text.trim())
    || /^(?:всё верно|все верно|согласовано|подтверждаю)[,;!]?\s+(?:открывай|открой)(?:\s+форму)?[.!]?$/iu.test(text.trim());
}

export function isDraftRevision(text: string): boolean {
  return /^(?:нет[, ]+|(?:(?:давай|а)\s+)?(?:поменяй|измени|исправь|уточни|перенеси|добавь|убери|замени|поставь|назначь)(?:\s|$)|(?:исполнитель|руководитель|срок|бюджет|участники|даты|приоритет|валюта|доступ|наблюдатели|соисполнители|согласующие|ответственные|чек-лист)\s*[:—-])/iu.test(text.trim());
}

export function isDraftContinuation(text: string): boolean {
  return isDraftRevision(text)
    || /^(?:да[,!]?\s*)?(?:всё верно|все верно|верно|согласен|согласна|согласовано|подтверждаю)[.!]?$/iu.test(text.trim())
    || /^да[.!]?$/iu.test(text.trim());
}

export function assistantLines(value?: string): string[] {
  return (value ?? "").split(/\n|;/u).map((item) => item.trim()).filter(Boolean);
}

export function resolveAssistantPerson(name: string, people: readonly WorkspacePerson[], currentUserId: string): string {
  const value = name.trim().toLocaleLowerCase("ru-RU");
  if (["я", "меня", "мне", "себя", "me", "myself"].includes(value)) return currentUserId;
  const tokens = value.split(/[^\p{L}\p{N}]+/u).filter((word) => word && !["ака", "опа", "aka", "opa"].includes(word));
  const matches = people.filter((person) => {
    if (person.status && person.status !== "active") return false;
    const words = person.name.toLocaleLowerCase("ru-RU").split(/[^\p{L}\p{N}]+/u);
    return tokens.length > 0 && tokens.every((word) => words.includes(word));
  });
  if (matches.length !== 1) throw new Error(`Не удалось однозначно выбрать «${name}». Уточните имя и фамилию в черновике; сотрудник не заменён другим.`);
  return matches[0]!.id;
}

export function assistantPeopleIds(fields: Readonly<Record<string, string>>, key: string,
  people: readonly WorkspacePerson[], currentUserId: string): string[] {
  return [...new Set(assistantLines(fields[key]).flatMap((line) => line.split(",")).map((name) =>
    resolveAssistantPerson(name, people, currentUserId)))];
}

export function resolveAssistantForm(draft: AssistantActionDraft, people: readonly WorkspacePerson[], currentUserId: string): AssistantActionDraft {
  const fields = { ...draft.fields };
  for (const key of ["assigneeId", "managerUserId", "responsibleUserIds", "approverUserIds", "employeeIds", "coAssigneeIds", "observerIds"]) delete fields[key];
  const single = draft.kind === "task" ? ["assignee", "assigneeId"] : draft.kind === "project" ? ["manager", "managerUserId"] : [];
  if (single.length && fields[single[0]!] && fields[single[0]!]!.trim()) {
    fields[single[1]!] = resolveAssistantPerson(fields[single[0]!]!, people, currentUserId);
  }
  for (const [key, target] of draft.kind === "project"
    ? [["responsibles", "responsibleUserIds"], ["approvers", "approverUserIds"]]
    : draft.kind === "trip" ? [["employees", "employeeIds"]]
      : draft.kind === "task" ? [["coAssignees", "coAssigneeIds"], ["observers", "observerIds"]] : []) {
    if (fields[key!]?.trim()) fields[target!] = JSON.stringify(assistantPeopleIds(fields, key!, people, currentUserId));
  }
  if (fields.budget && (!/^\d{1,15}$/.test(fields.budget) || !Number.isSafeInteger(Number(fields.budget)))) {
    throw new Error("Уточните бюджет: нужна целая неотрицательная сумма.");
  }
  if (fields.budget && !["UZS", "USD", "EUR"].includes(fields.currency ?? "")) {
    throw new Error("Уточните валюту бюджета: UZS, USD или EUR.");
  }
  return { ...draft, fields };
}

/** Resolved identifiers are still checked against the current directory, never trusted blindly. */
export function assistantResolvedIds(value: string | undefined, people: readonly WorkspacePerson[]): string[] {
  if (!value) return [];
  const data: unknown = JSON.parse(value);
  if (!Array.isArray(data) || data.some((id: unknown) => typeof id !== "string"
    || !people.some((person) => person.id === id && (!person.status || person.status === "active")))) {
    throw new Error("Состав сотрудников изменился. Уточните участников в чате.");
  }
  return [...new Set(data as string[])];
}
