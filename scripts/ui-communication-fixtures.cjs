// Synthetic data shared by before/after captures; never sent to a real API.
module.exports = function communicationFixtures(people, user) {
  const projects = Array.from({ length: 18 }, (_, i) => ({
    id: `legacy-project-${i}`, code: `REG-${41 + i}`,
    title: ["Развитие региональных инициатив", "Образовательная программа", "Подготовка рабочих встреч"][i % 3],
    description: "Планирование работы команды и подготовка материалов программы.",
    managerUserId: people[i % people.length].id, startDate: "2026-11-01", endDate: "2026-12-15",
    budget: 18000000, spentBudget: 4500000, remainingBudget: 13500000, currency: "UZS",
    status: i % 5 >= 3 ? "completed" : "in_progress", stage: ["start", "preparation", "approval", "success", "failure"][i % 5],
    chatId: null, createdByUserId: user.id, createdAt: "2026-11-01", updatedAt: "2026-11-26",
    canEdit: true, canMove: i % 5 < 3, history: [],
  }));
  const incoming = Array.from({ length: 120 }, (_, i) => ({
    id: `qa-incoming-${i}`, agentId: "qa-agent", externalId: String(401 + i), sequenceNumber: String(401 + i),
    platformIncomingNumber: `${401 + i}/26/AI`, senderLetterNumber: `OUT-${51 + i}`,
    receivedAt: "2026-11-26T07:00:00Z", senderOrganization: "Управление региональных программ", senderPerson: "Канцелярия",
    subject: ["Материалы регионального рабочего совещания", "Согласование программы совместных мероприятий", "Ответ на обращение подразделения"][i % 3],
    responsibleExternalId: "qa", responsibleDisplayName: people[i % people.length].name,
    urgency: "normal", hasAttachments: true, attachmentsCount: i % 3 + 1, mainDocumentFilename: "Материалы программы.pdf",
    platformRecordId: `qa-record-${i}`, status: i % 5 === 4 ? "needs_review" : "platform_submitted",
    fallbackUsed: false, errorMessage: "", source: i % 2 ? "webmail" : "exat", revision: 1,
    createdAt: "2026-11-26T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z",
  }));
  const letters = Array.from({ length: 18 }, (_, i) => ({
    id: `qa-outgoing-${i}`, subject: ["Программа региональной встречи", "Документы образовательного проекта", "Согласование рабочих материалов"][i % 3],
    recipientOrganization: "Центр регионального развития", recipientAddress: "office@example.test", route: "webmail", note: "",
    status: ["draft", "pending_review", "ready", "sent"][i % 4], workflowKind: "delivery", source: "workspace",
    createdByUserId: user.id, createdByName: user.name, reviewerUserId: people[1].id, reviewerName: people[1].name,
    revision: 1, createdAt: "2026-11-26T07:00:00Z", updatedAt: "2026-11-26T07:00:00Z",
    availableActions: [], canEdit: i % 4 === 0, canDelete: i % 4 === 0, attachments: [], events: [],
  }));
  return { projects, incoming, letters,
    authority: { writable: true, mode: "legacy" },
    visibility: { incomingMode: "all", canViewJournals: true, canManageVisibility: true, revision: 1 },
    reviewers: { revision: 1, runtimes: [], reviewers: [{ key: "umid", userId: people[1].id, fullName: people[1].name, canApprove: true }] },
  };
};
