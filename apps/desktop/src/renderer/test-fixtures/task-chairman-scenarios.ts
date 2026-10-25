import type { ComponentProps } from "react";
import type { WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";
import type { TasksView } from "../TasksView";

export const taskChairman: WorkspacePerson = {
  id: "qa-chairman", name: "Тестовый председатель", initials: "ТП", role: "manager",
  jobTitle: '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi', color: "#293A55",
};
export const taskChairmanPeople: readonly WorkspacePerson[] = [
  taskChairman,
  { id: "qa-author", name: "Тестовый постановщик", initials: "ТП", role: "employee", color: "#0091A8" },
  { id: "qa-executor", name: "Тестовый исполнитель", initials: "ТИ", role: "employee", color: "#293A55" },
];

export function chairmanScenarioTask(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: "qa-task", title: "Проверка результата · тестовая задача", project: "Тестовые данные",
    authorId: "qa-author", assigneeId: "qa-executor", chatId: "qa-task-chat",
    dueLabel: "31.12.2099", dueAt: "2099-12-31T12:00:00Z", status: "awaiting_review",
    priority: "normal", checklistDone: 0, checklistTotal: 1,
    participants: [{ userId: "qa-author", role: "observer" }],
    checklist: [{ id: "qa-check", title: "Проверить материалы", isCompleted: false, sortOrder: 0,
      createdByUserId: "qa-author", createdAt: "2026-10-23T09:00:00Z" }],
    comments: [], dependencies: [], resultText: "Материалы подготовлены для проверки.", ...overrides,
  };
}

// Safe defaults for isolated QA: no token and no connection to a real API.
export function chairmanScenarioProps(task: WorkspaceTask): ComponentProps<typeof TasksView> {
  const noChange = async () => undefined;
  return {
    tasks: [task], attachments: [], people: taskChairmanPeople, currentUserId: taskChairman.id,
    focusTaskId: task.id, efficiencyLoading: false, onLoadEfficiency: noChange,
    onCreateTask: noChange, onCreateSubtask: noChange, onChangeStatus: noChange,
    onUpdateTask: noChange, onDeleteTask: async () => false, onSetParticipant: noChange,
    onRemoveParticipant: noChange, onAddChecklistItem: noChange, onToggleChecklistItem: noChange,
    onDeleteChecklistItem: noChange, onAddComment: noChange, onSetDependency: noChange,
    onRemoveDependency: noChange, onSetCycle: noChange, renderTaskChat: () => null,
    onReturnForRevision: noChange, onSubmitResult: noChange, onAcceptResult: noChange,
    onSetEfficiencyExclusion: noChange, onExtendDeadline: noChange,
    onUploadAttachments: noChange, onDownloadAttachment: noChange,
  };
}
