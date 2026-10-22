import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GrantFields, WorkspacePerson } from "@yuksalish/contracts";
import { GrantComposer } from "./GrantComposer";
import { WorkspaceDialog } from "./WorkspaceDialog";

const people: WorkspacePerson[] = ["Инициатор", "Исполнитель", "Коллега", "Заместитель", "Председатель"].map((name, i) => ({
  id: String(i), name, initials: name.slice(0, 1), role: "employee", color: "blue", status: "active",
}));
const initial: GrantFields = {title: "Новая инициатива", description: "Описание", assigneeId: "1", coAssigneeIds: [], dueAt: "2099-11-01T12:00", checklist: []};
const submit = vi.fn(); const close = vi.fn();
function Example({ fields = initial, busy = false, legacy = false }: { fields?: GrantFields; busy?: boolean; legacy?: boolean }) {
  const [draft, setDraft] = useState(fields);
  const [files, setFiles] = useState<readonly File[]>([]);
  return <FluentProvider theme={webLightTheme}><WorkspaceDialog open><GrantComposer fields={draft} onChange={setDraft}
    onSubmit={submit} onClose={close} editing={legacy} busy={busy} error="" token="token" people={people}
    departments={[]} initiatorId="0" leaderId="3" chairId="4" authorId="0" workflowVersion={legacy ? 1 : 2} files={files} onFilesChange={setFiles} /></WorkspaceDialog></FluentProvider>;
}
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("adds and removes named teammates and checklist items without a server write", () => {
  render(<Example />);
  fireEvent.click(screen.getByRole("button", { name: "Добавить соисполнителя гранта" }));
  fireEvent.click(within(screen.getByLabelText("Доступные сотрудники")).getByRole("button", { name: /Коллега/ }));
  fireEvent.click(screen.getByRole("button", { name: "Добавить сотрудника" }));
  expect(screen.getByLabelText("Выбранная команда гранта")).toHaveTextContent("Коллега");
  const input = screen.getByRole("textbox", { name: "Новый пункт чек-листа гранта" });
  fireEvent.change(input, { target: { value: "Подготовить бюджет" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: "Подготовить бюджет" } });
  expect(screen.getByRole("button", { name: "Добавить пункт" })).toBeDisabled();
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить на запуск" }));
  expect(submit).toHaveBeenCalledWith({ ...initial, coAssigneeIds: ["2"], checklist: ["Подготовить бюджет"] });
  fireEvent.click(screen.getByRole("button", { name: "Убрать участника Коллега" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить пункт Подготовить бюджет" }));
  expect(screen.getByLabelText("Выбранная команда гранта")).not.toHaveTextContent("Коллега");
  expect(screen.queryByRole("button", { name: "Удалить пункт Подготовить бюджет" })).not.toBeInTheDocument();
});

it("blocks past dates and an unadded checklist draft instead of silently losing input", () => {
  render(<Example fields={{ ...initial, dueAt: "2000-01-01T12:00" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Отправить на запуск" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Укажите срок в будущем");
  fireEvent.change(screen.getByLabelText("Срок *"), { target: { value: initial.dueAt } });
  fireEvent.change(screen.getByRole("textbox", { name: "Новый пункт чек-листа гранта" }), { target: { value: "Ещё один шаг" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить на запуск" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Добавьте набранный пункт");
  expect(submit).not.toHaveBeenCalled();
});

it("cancels without submitting and preserves the legacy review explanation", () => {
  render(<Example legacy />);
  expect(screen.queryByText("Разрешает запуск · постановщик после запуска")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Маршрут заявки" }).parentElement).toHaveTextContent("Постановщик");
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(close).toHaveBeenCalledTimes(1); expect(submit).not.toHaveBeenCalled();
});

it("disables creation controls during the pending request", () => {
  render(<Example busy />);
  expect(screen.getByRole("button", { name: "Сохраняем…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Ответственный гранта" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "Название гранта *" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
});

it("keeps several source files, supports removal, and rejects empty or oversized files before sending", () => {
  render(<Example />);
  const input = screen.getByLabelText("Файлы для ознакомления");
  fireEvent.change(input, {target: {files: [new File(["terms"], "terms.txt"), new File(["plan"], "plan.docx")]}});
  expect(screen.getByRole("button", {name: "Убрать файл terms.txt"})).toBeInTheDocument();
  expect(screen.getByRole("button", {name: "Убрать файл plan.docx"})).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", {name: "Убрать файл terms.txt"}));
  expect(screen.queryByRole("button", {name: "Убрать файл terms.txt"})).not.toBeInTheDocument();
  fireEvent.change(input, {target: {files: [new File([], "empty.txt")]}});
  expect(screen.getByRole("alert")).toHaveTextContent("Пустые файлы");
  const huge = new File(["x"], "huge.pdf"); Object.defineProperty(huge, "size", {value: 26 * 1024 * 1024});
  fireEvent.change(input, {target: {files: [huge]}});
  expect(screen.getByRole("alert")).toHaveTextContent("25 МБ");
  expect(screen.getByRole("button", {name: "Убрать файл plan.docx"})).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
});
