import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { TaskPlan, WorkspaceTask, WorkspaceTaskUpdateInput } from "@yuksalish/contracts";
import { TasksView } from "./TasksView";
import { initialTasks, people } from "./test-fixtures/demo-data";
import * as api from "./workspace-api";

vi.mock("./TaskHistory", () => ({ TaskHistory: () => null }));
vi.mock("./TaskProposals", () => ({ TaskProposals: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const task: WorkspaceTask = { ...initialTasks[0]!, authorId: "aziza", assigneeId: "aziza", dueAt: null };
const plans: TaskPlan[] = ["Иш режа", "Региональный план"].map((title, index) => ({
  id: `plan-${index}`, title, kind: "work", status: "active", ownerUserId: "aziza", createdByUserId: "aziza",
  periodStart: null, periodEnd: null, createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z",
  taskIds: index === 0 ? [task.id] : [],
}));
function setup() {
  vi.spyOn(api, "loadTaskPlans").mockResolvedValue(plans);
  vi.spyOn(api, "loadTaskProjectOptions").mockResolvedValue([]);
  const onUpdate = vi.fn<(task: WorkspaceTask, payload: WorkspaceTaskUpdateInput) => Promise<WorkspaceTask | undefined>>().mockResolvedValue(undefined);
  const link = vi.spyOn(api, "setTaskPlanLink");
  const props: ComponentProps<typeof TasksView> = {
    token: "synthetic-token", tasks: [task], attachments: [], people, currentUserId: "aziza", focusTaskId: task.id,
    efficiencyLoading: false, onLoadEfficiency: vi.fn(), onCreateTask: vi.fn(), onCreateSubtask: vi.fn(),
    onChangeStatus: vi.fn(), onUpdateTask: onUpdate, onDeleteTask: vi.fn(), onSetParticipant: vi.fn(),
    onRemoveParticipant: vi.fn(), onAddChecklistItem: vi.fn(), onToggleChecklistItem: vi.fn(),
    onDeleteChecklistItem: vi.fn(), onAddComment: vi.fn(), onSetDependency: vi.fn(), onRemoveDependency: vi.fn(),
    onSetCycle: vi.fn(), renderTaskChat: vi.fn(), onReturnForRevision: vi.fn(), onSubmitResult: vi.fn(),
    onAcceptResult: vi.fn(), onSetEfficiencyExclusion: vi.fn(), onExtendDeadline: vi.fn(),
    onUploadAttachments: vi.fn(), onDownloadAttachment: vi.fn(),
  };
  render(<FluentProvider theme={webLightTheme}><TasksView {...props} /></FluentProvider>);
  return { onUpdate, link };
}

it("preselects existing plans, cancels locally and keeps a failed edit for retry", async () => {
  const { onUpdate, link } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
  const picker = screen.getByRole("combobox", { name: "Планы · необязательно" });
  await waitFor(() => expect(picker).toHaveValue("Иш режа"));
  fireEvent.click(picker);
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Региональный план" }));
  expect(link).not.toHaveBeenCalled(); expect(onUpdate).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("group", { name: "Редактирование карточки задачи" })).getByRole("button", { name: "Отмена" }));
  fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
  expect(screen.getByRole("combobox", { name: "Планы · необязательно" })).toHaveValue("Иш режа");
  fireEvent.click(screen.getByRole("button", { name: "Убрать все планы" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить карточку" }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
  expect(onUpdate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ planIds: [] }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить карточку");
  expect(screen.getByRole("combobox", { name: "Планы · необязательно" })).toHaveValue("");
  expect(link).not.toHaveBeenCalled();
});

it("omits plan changes when saving an unrelated edit", async () => {
  const { onUpdate } = setup();
  fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Планы · необязательно" })).toHaveValue("Иш режа"));
  fireEvent.change(screen.getByLabelText("Название в карточке"), { target: { value: "Новое название" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить карточку" }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
  expect(onUpdate.mock.calls[0]?.[1]).not.toHaveProperty("planIds");
});

it("closes the editor and reloads plan membership after a successful save", async () => {
  const { onUpdate } = setup();
  onUpdate.mockResolvedValue(task);
  fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Планы · необязательно" })).toHaveValue("Иш режа"));
  fireEvent.click(screen.getByRole("combobox", { name: "Планы · необязательно" }));
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Региональный план" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить карточку" }));
  await waitFor(() => expect(screen.queryByRole("group", { name: "Редактирование карточки задачи" })).not.toBeInTheDocument());
  expect(onUpdate.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ planIds: ["plan-0", "plan-1"] }));
  await waitFor(() => expect(api.loadTaskPlans).toHaveBeenCalledTimes(2));
});
