import { describe, expect, it } from "vitest";
import { people } from "./test-fixtures/demo-data";
import { assistantPeopleIds, assistantResolvedIds, isDraftContinuation, isDraftRevision, isFormOpenSignal, resolveAssistantForm, resolveAssistantPerson } from "./assistant-form-handoff";

describe("assistant form handoff", () => {
  it("requires an explicit form-opening signal, not a question, negation or save command", () => {
    for (const value of ["Открывай форму", "Да, открывай", "Подтверждаю, открой форму", "открой заполненную форму"]) expect(isFormOpenSignal(value)).toBe(true);
    for (const value of ["да", "не открывай форму", "открой форму и измени срок", "можно открыть форму?", "создай сразу", "сохрани", "открывай форму завтра"]) expect(isFormOpenSignal(value)).toBe(false);
  });
  it("recognizes explicit revisions without capturing unrelated questions", () => {
    expect(isDraftRevision("Измени срок на завтра")).toBe(true);
    expect(isDraftRevision("Бюджет: 1200000 UZS")).toBe(true);
    expect(isDraftRevision("Давай добавь наблюдателя Бахтиёра")).toBe(true);
    expect(isDraftRevision("Убери второй пункт чек-листа")).toBe(true);
    expect(isDraftRevision("Приоритет: высокий")).toBe(true);
    expect(isDraftRevision("Как работает бюджет проекта?")).toBe(false);
    expect(isDraftContinuation("Да, всё верно")).toBe(true);
    expect(isDraftContinuation("подтверждаю")).toBe(true);
    expect(isDraftContinuation("Да, расскажи о бюджете")).toBe(false);
  });
  it("resolves exact names and self, never picks an ambiguous or inactive colleague", () => {
    expect(resolveAssistantPerson("я", people, people[0]!.id)).toBe(people[0]!.id);
    expect(resolveAssistantPerson(people[1]!.name, people, people[0]!.id)).toBe(people[1]!.id);
    expect(() => resolveAssistantPerson("Неизвестный", people, people[0]!.id)).toThrow("Уточните");
    expect(() => resolveAssistantPerson(people[1]!.name, [people[1]!, { ...people[1]!, id: "duplicate" }], "me")).toThrow("однозначно");
    expect(() => resolveAssistantPerson(people[1]!.name, [{ ...people[1]!, status: "blocked" }], "me")).toThrow();
  });
  it("preserves ordered people selections and deduplicates", () => {
    expect(assistantPeopleIds({ approvers: `${people[2]!.name}\n${people[1]!.name}\n${people[2]!.name}` }, "approvers", people, people[0]!.id))
      .toEqual([people[2]!.id, people[1]!.id]);
    expect(() => assistantResolvedIds('["unknown-id"]', people)).toThrow();
  });
  it("resolves all project fields without changing the supplied draft", () => {
    const draft = { kind: "project", ready: true, fields: { title: "Форум", code: "FORUM", manager: people[1]!.name,
      budget: "2500000", currency: "UZS", responsibles: people[2]!.name, approvers: `${people[2]!.name}\n${people[1]!.name}` } } as const;
    const resolved = resolveAssistantForm(draft, people, people[0]!.id);
    expect(resolved.fields.managerUserId).toBe(people[1]!.id);
    expect(JSON.parse(resolved.fields.approverUserIds!)).toEqual([people[2]!.id, people[1]!.id]);
    expect(resolved.fields.budget).toBe("2500000");
    expect(draft.fields).not.toHaveProperty("managerUserId");
    expect(() => resolveAssistantForm({ ...draft, fields: { ...draft.fields, currency: "" } }, people, "me")).toThrow("валюту");
    expect(() => resolveAssistantForm({ ...draft, fields: { ...draft.fields, budget: "-5" } }, people, "me")).toThrow("бюджет");
  });
});
