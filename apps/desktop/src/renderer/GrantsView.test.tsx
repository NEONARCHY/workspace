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
  initiatorUserId: people[0].id, workflowVersion: 1, launchApprovedAt: null, launchApprovedByUserId: null,
  leaderUserId: people[3].id, chairUserId: people[4].id, dueAt: "2099-11-01T12:00:00Z",
  status: "in_progress", revision: 4, checklist: [], resultText: "", chatId: "chat-grant",
  createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z",
  allowedActions: ["submit", "comment", "upload", "check"], events: [], attachments: [],
};
const openChat = vi.fn();
function show(user = 1, canAdmin = false, embedded = false) {
  return render(<FluentProvider theme={webLightTheme}><GrantsView token="grant-token"
    currentUser={people[user] ?? people[1]} people={people} departments={[]} canCreate canAdmin={canAdmin}
    onOpenChat={openChat} renderGrantChat={embedded ? (grant) => <section aria-label={`Переписка ${grant.chatId}`}>Чат гранта</section> : undefined}
    onPreviewAttachment={vi.fn()} onDownloadAttachment={vi.fn()} />
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

it("keeps the managed conversation beside the participant card and closes the card for messenger navigation", async () => {
  show(1, false, true); const dialog = await open();
  expect(within(dialog).getByRole("region", { name: "Переписка chat-grant" })).toBeInTheDocument();
  const team = within(dialog).getByLabelText("Основные участники гранта");
  expect(within(dialog).getByText("Инициатор").parentElement).toHaveTextContent("Автор");
  expect(within(team).getByText("Постановщик").parentElement).toHaveTextContent("Автор");
  expect(within(team).getByText("Ответственный").parentElement).toHaveTextContent("Исполнитель");
  expect(within(dialog).getByLabelText("Соисполнители гранта")).toHaveTextContent("Соисполнитель");
  fireEvent.click(within(dialog).getByRole("button", { name: "Открыть в мессенджере" }));
  expect(openChat).toHaveBeenCalledWith("chat-grant");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: request.title })).not.toBeInTheDocument());
});

it("does not render a private conversation for a read-only outsider", async () => {
  api.detail.mockResolvedValue({ ...request, coAssigneeIds: [], allowedActions: [] });
  show(2, true, true); const dialog = await open();
  expect(within(dialog).queryByRole("region", { name: "Переписка chat-grant" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Открыть в мессенджере" })).not.toBeInTheDocument();
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
  await waitFor(() => expect(createButton).toBeEnabled()); createButton.focus(); fireEvent.click(createButton);
  const dialog = screen.getByRole("dialog", { name: "Новая заявка на грант" });
  fireEvent.change(within(dialog).getByLabelText("Название гранта *"), { target: { value: "Новый грант" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Ответственный гранта" }));
  fireEvent.click(within(screen.getByLabelText("Доступные сотрудники")).getByRole("button", { name: /Исполнитель/ }));
  fireEvent.change(within(dialog).getByLabelText("Срок *"), { target: { value: "2099-11-01T09:00" } });
  const files = [new File(["terms"], "terms.txt", {type: "text/plain"}), new File(["budget"], "budget.csv", {type: "text/csv"})];
  fireEvent.change(within(dialog).getByLabelText("Файлы для ознакомления"), { target: { files } });
  for (const title of ["Заявка", "Бюджет"]) {
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Новый пункт чек-листа гранта" }), { target: { value: title } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Добавить пункт" }));
  }
  const save = within(dialog).getByRole("button", { name: "Отправить на запуск" });
  save.focus(); fireEvent.click(save);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Повторите отправку");
  const firstId = api.create.mock.calls.at(0)?.[2];
  await waitFor(() => expect(save).toBeEnabled());
  save.focus(); fireEvent.click(save);
  await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(save).toBeEnabled());
  expect(api.create.mock.calls.at(1)?.[2]).toBe(firstId);
  expect(api.create.mock.calls.at(0)?.[3]).toEqual(files);
  expect(api.create.mock.calls.at(1)?.[3]).toEqual(files);
  expect(within(dialog).getByRole("button", {name: "Убрать файл terms.txt"})).toBeInTheDocument();
  expect(api.create.mock.calls.at(0)?.[1]).toMatchObject({ title: "Новый грант", checklist: ["Заявка", "Бюджет"] });
  fireEvent.click(within(dialog).getByRole("button", { name: "Отмена" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Новая заявка на грант" })).not.toBeInTheDocument());
  expect(api.create).toHaveBeenCalledTimes(2);
});

it("shows the setter above the initiator and sorts the shared record list without mutating data", async () => {
  const rows = [request, { ...request, id: "earlier", title: "Более ранняя заявка", dueAt: "2099-01-01T12:00:00Z" }];
  api.list.mockResolvedValue(rows);
  show(); await screen.findByRole("button", {name: request.title});
  const table = screen.getByRole("table", {name: "Заявки на гранты"});
  const row = within(table).getAllByRole("row")[1]!;
  const setter = within(row).getByText("Постановщик");
  const initiator = within(row).getByText("Инициатор");
  expect(setter.compareDocumentPosition(initiator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(within(table).getByRole("button", {name: /Крайний срок/}));
  expect(within(table).getAllByRole("row")[1]).toHaveTextContent("Более ранняя заявка");
  expect(rows[0]).toBe(request);
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

it("requires the chairman's launch decision before assigning the author and enabling work", async () => {
  const pending: GrantDetail = { ...request, authorUserId: null, workflowVersion: 2,
    status: "launch_review", allowedActions: ["approve_launch", "return_launch", "reject_launch", "comment"] };
  const launched: GrantDetail = { ...pending, authorUserId: people[4].id, revision: 5, status: "in_progress",
    launchApprovedAt: "2026-10-21T13:00:00Z", launchApprovedByUserId: people[4].id,
    allowedActions: ["edit", "comment", "upload", "check"] };
  api.list.mockResolvedValue([pending]); api.detail.mockResolvedValue(pending); api.act.mockResolvedValue(launched);
  show(4); const dialog = await open();
  expect(within(dialog).getByText("Председатель станет постановщиком после разрешения запуска")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Отправить на проверку" })).not.toBeInTheDocument();
  expect(within(dialog).getByRole("list", { name: "Маршрут согласования" })).toHaveTextContent("Разрешение запуска");
  fireEvent.click(within(dialog).getByRole("button", { name: "Разрешить запуск" }));
  await waitFor(() => expect(within(dialog).getByText(/^Запуск разрешён/)).toBeInTheDocument());
  expect(api.act).toHaveBeenCalledWith("grant-token", request.id, { action: "approve_launch", expectedRevision: 4 });
  expect(within(dialog).getByText("Инициатор").parentElement).toHaveTextContent(people[0].name);
  expect(within(dialog).getByText("Постановщик").parentElement).toHaveTextContent(people[4].name);
});

it("retains a launch-return reason on failure and keeps the initiator's access", async () => {
  const pending: GrantDetail = { ...request, authorUserId: null, workflowVersion: 2, status: "launch_review",
    allowedActions: ["approve_launch", "return_launch", "reject_launch", "comment"] };
  api.list.mockResolvedValue([pending]); api.detail.mockResolvedValue(pending);
  api.act.mockRejectedValue(new Error("Нет связи"));
  show(4); const dialog = await open();
  fireEvent.click(within(dialog).getByRole("button", { name: "Вернуть инициатору" }));
  const send = within(dialog).getByRole("button", { name: "Отправить инициатору" });
  expect(send).toBeDisabled();
  const reason = within(dialog).getByRole("textbox", { name: "Что уточнить для запуска *" });
  fireEvent.change(reason, { target: { value: "Уточните условия конкурса" } });
  fireEvent.click(send);
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Нет связи");
  expect(reason).toHaveValue("Уточните условия конкурса");
  expect(api.act).toHaveBeenCalledWith("grant-token", request.id, {
    action: "return_launch", text: "Уточните условия конкурса", expectedRevision: 4,
  });
});

it("shows the new deputy-first result route without an extra author-review step", async () => {
  const working: GrantDetail = { ...request, workflowVersion: 2, authorUserId: people[4].id,
    launchApprovedAt: "2026-10-21T13:00:00Z", launchApprovedByUserId: people[4].id };
  api.list.mockResolvedValue([working]); api.detail.mockResolvedValue(working);
  show(1); const dialog = await open();
  const route = within(dialog).getByRole("list", { name: "Маршрут согласования" });
  expect(within(route).queryByText("Постановщик")).not.toBeInTheDocument();
  expect(within(route).getByText("Заместитель")).toBeInTheDocument();
  expect(within(dialog).getByRole("textbox", { name: "Результат работы для заместителя" })).toBeInTheDocument();
});
