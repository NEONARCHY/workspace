import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { GrantDetail, WorkspacePerson } from "@yuksalish/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GrantsView } from "./GrantsView";

const api = vi.hoisted(() => ({
  list: vi.fn(), detail: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(),
  create: vi.fn(), edit: vi.fn(), act: vi.fn(), upload: vi.fn(), reviewers: vi.fn(),
}));
vi.mock("./workspace-api", () => ({
  loadGrants: api.list, loadGrant: api.detail, loadGrantSettings: api.settings,
  saveGrantSettings: api.saveSettings, createGrant: api.create, editGrant: api.edit,
  actOnGrant: api.act, uploadWorkspaceAttachment: api.upload, changeGrantReviewers: api.reviewers,
}));
function person(i: number, name: string): WorkspacePerson {
  return { id: `person-${i}`, name, role: "employee", initials: name.slice(0, 1), color: "blue", status: "active" };
}
const people = [person(0, "Автор"), person(1, "Исполнитель"), person(2, "Соисполнитель"),
  person(3, "Руководитель"), person(4, "Председатель")] as const;
const request: GrantDetail = {
  id: "grant-1", title: "Грант для молодёжи", description: "Подготовить заявку и бюджет",
  authorUserId: people[0].id, assigneeId: people[1].id, coAssigneeIds: [people[2].id],
  leaderUserId: people[3].id, chairUserId: people[4].id, dueAt: "2099-11-01T12:00:00Z",
  status: "in_progress", revision: 4, checklist: [], resultText: "", chatId: "chat-grant",
  createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z",
  allowedActions: ["submit", "comment", "upload", "check"], events: [], attachments: [],
};
const openChat = vi.fn();
function show(user = 1, canAdmin = false) {
  return render(<FluentProvider theme={webLightTheme}><GrantsView token="grant-token"
    currentUser={people[user] ?? people[1]} people={people} departments={[]} canCreate canAdmin={canAdmin}
    onOpenChat={openChat} onPreviewAttachment={vi.fn()} onDownloadAttachment={vi.fn()} />
  </FluentProvider>);
}
async function open() {
  fireEvent.click(await screen.findByRole("button", { name: request.title }));
  return await screen.findByRole("dialog", { name: request.title });
}
beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([request]); api.detail.mockResolvedValue(request);
  api.settings.mockResolvedValue({ leaderUserId: people[3].id, chairUserId: people[4].id, revision: 2 });
});
afterEach(cleanup);

it("opens the complete card and its managed chat without offering executor approval", async () => {
  show(); const dialog = await open();
  expect(within(dialog).getByRole("list", { name: "Маршрут согласования" })).toHaveTextContent("Постановщик");
  expect(within(dialog).queryByRole("button", { name: /Принять и/ })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Чат заявки" }));
  expect(openChat).toHaveBeenCalledWith("chat-grant");
});

it("retains the result and the displayed stage after a server error and prevents duplicate clicks", async () => {
  api.act.mockRejectedValue(new Error("Сервер недоступен"));
  show(); const dialog = await open();
  const result = within(dialog).getByRole("textbox", { name: "Результат работы для постановщика" });
  fireEvent.change(result, { target: { value: "Заявка и бюджет готовы" } });
  const button = within(dialog).getByRole("button", { name: "Отправить на проверку" });
  fireEvent.click(button); fireEvent.click(button);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Сервер недоступен");
  expect(api.act).toHaveBeenCalledTimes(1);
  expect(api.act).toHaveBeenCalledWith("grant-token", request.id, {
    action: "submit", text: "Заявка и бюджет готовы", expectedRevision: 4,
  });
  expect(result).toHaveValue("Заявка и бюджет готовы");
  expect(within(dialog).getByText("В работе")).toBeInTheDocument();
});

it("blocks submission until every checklist item is completed", async () => {
  const pending = { ...request, checklist: [{ id: "item", title: "Проверить бюджет", completed: false, completedAt: null, completedByUserId: null }] };
  api.detail.mockResolvedValue(pending);
  show(); const dialog = await open();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Результат работы для постановщика" }), { target: { value: "Готово" } });
  expect(within(dialog).getByRole("button", { name: "Отправить на проверку" })).toBeDisabled();
  api.act.mockResolvedValue({ ...pending, revision: 5, checklist: [{ ...pending.checklist[0], completed: true }] });
  fireEvent.click(within(dialog).getByRole("checkbox", { name: "Проверить бюджет" }));
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Отправить на проверку" })).toBeEnabled());
});

it("requires an explanation for return and shows the persisted review transition", async () => {
  const reviewing = { ...request, status: "leader_review" as const, resultText: "Готовая заявка", allowedActions: ["approve", "return", "comment"] };
  api.detail.mockResolvedValue(reviewing); api.list.mockResolvedValue([reviewing]);
  const revised = { ...reviewing, revision: 5, status: "needs_revision", allowedActions: ["comment"] };
  api.act.mockResolvedValue(revised); api.detail.mockResolvedValueOnce(reviewing).mockResolvedValue(revised);
  show(3); const dialog = await open();
  fireEvent.click(within(dialog).getByRole("button", { name: "Вернуть на доработку" }));
  const send = within(dialog).getByRole("button", { name: "Отправить на доработку" });
  expect(send).toBeDisabled();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Что нужно доработать *" }), { target: { value: "Уточните бюджет" } });
  fireEvent.click(send);
  await waitFor(() => expect(within(dialog).getByText("На доработке")).toBeInTheDocument());
  expect(api.act).toHaveBeenCalledWith("grant-token", request.id, { action: "return", text: "Уточните бюджет", expectedRevision: 4 });
});

it("filters the personal decision inbox using server-provided actions", async () => {
  api.list.mockResolvedValue([request, { ...request, id: "grant-2", title: "На моей проверке", status: "author_review", allowedActions: ["approve"] }]);
  show(0); await screen.findByRole("button", { name: request.title });
  fireEvent.click(screen.getByRole("button", { name: "Ждут моего решения" }));
  expect(screen.getByRole("button", { name: "На моей проверке" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: request.title })).not.toBeInTheDocument();
});

it("preserves a creation draft and request identity after failure, and cancellation creates nothing", async () => {
  api.create.mockRejectedValue(new Error("Повторите отправку"));
  show(0); const createButton = await screen.findByRole("button", { name: "Новая заявка" });
  await waitFor(() => expect(createButton).toBeEnabled()); fireEvent.click(createButton);
  const dialog = screen.getByRole("dialog", { name: "Новая заявка на грант" });
  fireEvent.change(within(dialog).getByLabelText("Название гранта *"), { target: { value: "Новый грант" } });
  fireEvent.change(within(dialog).getByLabelText("Ответственный *"), { target: { value: people[1].id } });
  fireEvent.change(within(dialog).getByLabelText("Срок *"), { target: { value: "2099-11-01T09:00" } });
  fireEvent.change(within(dialog).getByLabelText(/Чек-лист/), { target: { value: "Заявка\nБюджет" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить заявку" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Повторите отправку");
  const firstId = api.create.mock.calls.at(0)?.[2];
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить заявку" }));
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  expect(api.create.mock.calls.at(1)?.[2]).toBe(firstId);
  expect(api.create.mock.calls.at(0)?.[1]).toMatchObject({ title: "Новый грант", checklist: ["Заявка", "Бюджет"] });
  fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
  expect(api.create).toHaveBeenCalledTimes(2);
});

it("lets only an administrator configure reviewers for future applications", async () => {
  api.saveSettings.mockResolvedValue({ leaderUserId: people[2].id, chairUserId: people[4].id, revision: 3 });
  show(0, true);
  const button = await screen.findByRole("button", { name: "Маршрут согласования" });
  await waitFor(() => expect(button).toBeEnabled()); fireEvent.click(button);
  const dialog = screen.getByRole("dialog", { name: "Маршрут согласования грантов" });
  fireEvent.change(within(dialog).getByLabelText("Руководитель *"), { target: { value: people[2].id } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Сохранить маршрут" }));
  await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith("grant-token", people[2].id, people[4].id, 2));
});
