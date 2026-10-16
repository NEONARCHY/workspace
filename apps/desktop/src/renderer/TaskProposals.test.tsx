import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { TaskProposal } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { TaskProposals } from "./TaskProposals";
import { TaskComposer } from "./TaskComposer";
import { people } from "./test-fixtures/demo-data";
import { decideTaskProposal, loadTaskProposals } from "./workspace-api";

vi.mock("./workspace-api", () => ({
  decideTaskProposal: vi.fn(), loadTaskProposals: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const proposal: TaskProposal = {
  id: "proposal", creatorUserId: "aziza", authorUserId: "baxtiyor", status: "pending",
  taskId: null, reason: "", createdAt: "2026-10-16T10:00:00Z", decidedAt: null,
  task: { title: "Согласовать отчёт", description: "Полные условия", assigneeId: "aziza",
    participants: [{ userId: "dilshod", role: "observer" }], checklist: [{ title: "Проверить цифры" }] },
};

it("sends the full self-assigned draft for consent instead of creating a task", async () => {
  const onPropose = vi.fn().mockRejectedValueOnce(new Error("Нет сети")).mockResolvedValueOnce(undefined);
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(<FluentProvider theme={webLightTheme}><TaskComposer open people={people} tasks={[]}
    currentUserId="aziza" initialTitle="Согласовать отчёт" initialDescription="Полные условия"
    onPropose={onPropose} onSubmit={onSubmit} onClose={onClose} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Постановщик новой задачи" }));
  fireEvent.click(within(document.querySelector(".person-picker-surface")!).getByRole("button", { name: new RegExp(people.find((item) => item.id === "baxtiyor")!.name) }));
  expect(screen.getByRole("button", { name: "Ответственный новой задачи" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Отправить на подтверждение" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Нет сети");
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отправить на подтверждение" }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(onPropose.mock.calls[1]).toEqual(onPropose.mock.calls[0]);
  expect(onPropose).toHaveBeenLastCalledWith(expect.objectContaining({
    authorUserId: "baxtiyor", requestId: expect.any(String),
    task: expect.objectContaining({ title: "Согласовать отчёт", description: "Полные условия", assigneeId: "aziza" }),
  }));
});

it("opens a notification-focused proposal, displays all conditions and persists approval", async () => {
  vi.mocked(loadTaskProposals).mockResolvedValue([proposal]);
  vi.mocked(decideTaskProposal).mockResolvedValue({ ...proposal, status: "approved", taskId: "created" });
  const refresh = vi.fn().mockResolvedValue(undefined);
  render(<FluentProvider theme={webLightTheme}><TaskProposals token="test" currentUserId="baxtiyor"
    people={people} tasks={[]} revision={0} focusId="proposal" onRefresh={refresh} onOpenTask={vi.fn()} /></FluentProvider>);
  const dialog = await screen.findByRole("dialog", { name: "Заявка на постановку задачи" });
  expect(within(dialog).getByText("Полные условия")).toBeVisible();
  expect(within(dialog).getByText("Проверить цифры")).toBeVisible();
  expect(within(dialog).getByText(/Наблюдатель/)).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Отклонить" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить постановку" }));
  await waitFor(() => expect(decideTaskProposal).toHaveBeenCalledWith("test", "proposal", "approve", ""));
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(within(dialog).queryByRole("button", { name: "Подтвердить постановку" })).not.toBeInTheDocument();
});

it("keeps a failed decision pending and requires a reason before rejection", async () => {
  vi.mocked(loadTaskProposals).mockResolvedValue([proposal]);
  vi.mocked(decideTaskProposal).mockRejectedValue(new Error("Решение не сохранено"));
  render(<FluentProvider theme={webLightTheme}><TaskProposals token="test" currentUserId="baxtiyor"
    people={people} tasks={[]} revision={0} focusId="proposal" onOpenTask={vi.fn()} /></FluentProvider>);
  const dialog = await screen.findByRole("dialog", { name: "Заявка на постановку задачи" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Причина отклонения заявки" }), { target: { value: "Уточните результат" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Отклонить" }));
  await waitFor(() => expect(within(dialog).getByRole("alert")).toHaveTextContent("Решение не сохранено"));
  expect(within(dialog).getByRole("textbox")).toHaveValue("Уточните результат");
  expect(within(dialog).getByRole("button", { name: "Подтвердить постановку" })).toBeEnabled();
});

it("allows the creator to withdraw but never approve their own proposal", async () => {
  vi.mocked(loadTaskProposals).mockResolvedValue([proposal]);
  vi.mocked(decideTaskProposal).mockResolvedValue({ ...proposal, status: "cancelled" });
  render(<FluentProvider theme={webLightTheme}><TaskProposals token="test" currentUserId="aziza"
    people={people} tasks={[]} revision={0} focusId="proposal" onOpenTask={vi.fn()} /></FluentProvider>);
  const dialog = await screen.findByRole("dialog", { name: "Заявка на постановку задачи" });
  expect(within(dialog).queryByRole("button", { name: "Подтвердить постановку" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Отозвать заявку" }));
  await waitFor(() => expect(decideTaskProposal).toHaveBeenCalledWith("test", "proposal", "cancel", ""));
});

it("does not let an older list response overwrite a confirmed decision", async () => {
  let resolveOld!: (value: readonly TaskProposal[]) => void;
  vi.mocked(loadTaskProposals).mockResolvedValueOnce([proposal]).mockImplementationOnce(
    () => new Promise((resolve) => { resolveOld = resolve; }),
  );
  vi.mocked(decideTaskProposal).mockResolvedValue({ ...proposal, status: "approved", taskId: "created" });
  const view = (revision: number) => <FluentProvider theme={webLightTheme}>
    <TaskProposals token="test" currentUserId="baxtiyor" people={people} tasks={[]}
      revision={revision} focusId="proposal" onOpenTask={vi.fn()} />
  </FluentProvider>;
  const rendered = render(view(0));
  await screen.findByRole("dialog", { name: "Заявка на постановку задачи" });
  rendered.rerender(view(1));
  await waitFor(() => expect(loadTaskProposals).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить постановку" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "Подтвердить постановку" })).not.toBeInTheDocument());
  await act(async () => { resolveOld([proposal]); });
  expect(screen.queryByRole("button", { name: "Подтвердить постановку" })).not.toBeInTheDocument();
});
