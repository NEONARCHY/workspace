// Test/QA only: never imported by the authenticated application.
import type { EmployeeRecognitionProfile, PersonalEfficiency, WorkspaceNotification } from "@yuksalish/contracts";
import type { HomeWorkspace } from "../personal-home";
import { defaultPersonalPreferences } from "../personal-organization";
import { initialChats, initialMessages, initialTasks, people } from "./demo-data";

export function homeFixture(userId = "aziza", now = Date.now()): HomeWorkspace {
  const members = people.map(p => ({ ...p, departmentId: p.id === "malika" ? "leadership" : "finance" }));
  const user = members.find(p => p.id === userId)!;
  const notifications: WorkspaceNotification[] = [
    { id: "home-notice", kind: "task", section: "tasks", title: "Проверьте итоговый документ", body: "Коллега завершил подготовку материалов. Нужен ваш ответ.", priority: "attention", requiresAction: true, isReminder: false, occurredAt: new Date(now - 180_000).toISOString(), entityId: "home-review" },
    { id: "home-feed-notice", kind: "feed", section: "feed", title: "Опубликован план недели", body: "Материалы общей встречи доступны в ленте.", priority: "normal", requiresAction: false, isReminder: false, occurredAt: new Date(now - 3_600_000).toISOString(), entityId: "home-post" },
  ];
  return {
    currentUser: user, people: members,
    departments: [{ id: "finance", name: "Финансы и закупки", code: "FIN", assignedUsersCount: 3, chatId: "finance" }],
    tasks: [
      { ...initialTasks[0]!, id: "home-due", title: "Согласовать бюджет поставки", assigneeId: userId, authorId: "malika", status: "in_progress", priority: "high", dueAt: new Date(now + 3_600_000).toISOString() },
      { ...initialTasks[0]!, id: "home-late", title: "Подготовить договор на поставку", assigneeId: userId, authorId: "malika", status: "overdue", dueAt: new Date(now - 86_400_000).toISOString() },
      { ...initialTasks[0]!, id: "home-review", title: "Проверить итоговый документ", assigneeId: "baxtiyor", authorId: userId, status: "awaiting_review" },
    ],
    projects: [], tripRequests: [], notifications,
    chats: initialChats, messages: initialMessages.map((m, i) => ({ ...m, createdAt: new Date(now - (initialMessages.length - i) * 60_000).toISOString() })),
    personalPreferences: defaultPersonalPreferences,
    feedPosts: [{ id: "home-post", authorUserId: "malika", title: "План недели и материалы встречи", body: "Обновили дорожную карту. Просмотрите основные решения перед общей встречей команды.", isPinned: true, likedByCurrentUser: false, likeCount: 3, comments: [], canEdit: false, canPin: false, createdAt: new Date(now - 3_600_000).toISOString(), updatedAt: new Date(now - 3_600_000).toISOString() }],
    calendarEvents: [{ id: "home-meeting", title: "Еженедельное планирование", description: "Статус задач и ближайшие сроки", eventType: "meeting", organizerUserId: userId, attendeeIds: [userId], attendees: [{ userId, status: "accepted" }], canRespond: false, startsAt: new Date(now + 1_800_000).toISOString(), endsAt: new Date(now + 5_400_000).toISOString(), allDay: false, location: "Переговорная", status: "scheduled", canEdit: true, createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString() }],
  };
}
export function homeEfficiency(userId = "aziza"): PersonalEfficiency {
  return {
    employee: { userId, name: people.find(p => p.id === userId)!.name, jobTitle: "Специалист", period: "2026-10", timezone: "Asia/Tashkent", percentage: 80, onTimeCount: 8, eligibleCount: 10, overdueCount: 2, awaitingReviewCount: 1, noDueDateCount: 1, returnedForRevisionCount: 0, excludedCount: 0, sampleSize: 10, methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-08-01T00:00:00Z", historyCompleteness: "complete", smallSample: false,
      history: [{ period: "2026-08", percentage: 70, onTimeCount: 7, eligibleCount: 10, historyCompleteness: "complete" }, { period: "2026-09", percentage: null, onTimeCount: 0, eligibleCount: 0, historyCompleteness: "unavailable" }, { period: "2026-10", percentage: 80, onTimeCount: 8, eligibleCount: 10, historyCompleteness: "complete" }] },
    taskDetailsVisible: true, workload: { new: 1, inProgress: 2, awaitingReview: 1, completed: 8 }, recentTasks: [], impactTasks: [], impactTaskCount: 0,
  };
}
export function homeRecognition(userId = "aziza"): EmployeeRecognitionProfile {
  return {
    person: people.find(p => p.id === userId)!, activeTaskCountVisible: true, rewardCatalog: [], canIssueReward: false, canManageSettings: false,
    rewards: [{ id: "home-reward", recipientUserId: userId, issuerUserId: "malika", issuerName: "Малика Нурова", title: "Спасибо за помощь", description: "Признание коллеги", contextNote: "Помощь с материалами встречи", iconKey: "appreciation", createdAt: "2026-10-08T09:00:00+05:00" }],
    achievements: [{ code: "home-achievement", title: "Первые десять задач", description: "Десять выполненных задач", category: "tasks", tier: "bronze", iconKey: "target", progress: 10, target: 10, unlocked: true, earnedAt: "2026-10-08T09:00:00+05:00" }],
  };
}
