import type { ApprovalRequestSummary, TripRequest, WorkspacePerson, WorkspaceTask } from "@yuksalish/contracts";

export const photoPeople: readonly WorkspacePerson[] = [
  { id: "photo-employee", name: "Дилшод Рахимов", initials: "ДР", role: "employee", color: "blue", jobTitle: "Специалист", avatarVersion: "photo-v1" },
  { id: "initials-employee", name: "Азиза Каримова", initials: "АК", role: "employee", color: "teal", jobTitle: "Координатор" },
];

export const photoPayment: ApprovalRequestSummary = {
  id: "photo-payment", number: "PHOTO-1", title: "Тестовая оплата по проекту", amount: 250000, currency: "UZS",
  status: "running", statusLabel: "На согласовании", activeNodeKeys: ["chair"],
  activeStages: [{ key: "chair", label: "Утверждение председателем", kind: "approval", canAct: false }],
  stageLabel: "Утверждение председателем", requesterId: "initials-employee", responsibleUserId: "photo-employee",
  purpose: "Проверка отображения участников", revision: 1, versions: [], actions: [],
  details: { projectName: "Тестовый проект", projectCode: "QA", sourceAccount: "", destinationAccount: "",
    requestPriority: "normal", comment: "", tripPurpose: "", employeeIds: [], paymentReason: "" },
  createdAt: "2026-10-23T09:00:00Z", updatedAt: "2026-10-23T09:00:00Z",
};

export const photoTrip: TripRequest = {
  id: "photo-trip", number: "TR-PHOTO", requesterUserId: "photo-employee", workflowVersion: 3,
  purpose: "Тестовая встреча с региональной командой", destination: "Самарканд", startDate: "2026-11-01", endDate: "2026-11-03",
  employeeIds: ["photo-employee", "initials-employee"], stage: "deputy_approval", stageLabel: "Согласование первого заместителя",
  status: "running", statusLabel: "На согласовании", canEdit: false, allowedActions: [], actions: [],
  createdAt: "2026-10-23T09:00:00Z", updatedAt: "2026-10-23T09:00:00Z",
};

export const photoTasks: readonly WorkspaceTask[] = photoPeople.map((person, index) => ({
  id: `photo-task-${index}`, title: index ? "Проверить план работ" : "Подготовить материалы встречи",
  assigneeId: person.id, authorId: "initials-employee", status: "in_progress", project: "Тестовый проект",
  dueLabel: "Срок истёк", dueAt: "2020-01-01T09:00:00Z", priority: "normal",
  checklistDone: 0, checklistTotal: 0, participants: [], checklist: [], comments: [], dependencies: [],
}));
