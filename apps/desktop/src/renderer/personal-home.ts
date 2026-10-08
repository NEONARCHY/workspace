import type { NavigationKey, ProjectHubProject, WorkspaceBootstrap, WorkspaceTask, ZoomMeeting } from "@yuksalish/contracts";
import { isObsoleteHisobotNotification } from "./notification-delivery";

export type HomeWorkspace = Pick<WorkspaceBootstrap, "currentUser" | "people" | "departments" | "tasks" | "projects" | "tripRequests" | "notifications" | "chats" | "messages" | "feedPosts" | "calendarEvents" | "personalPreferences">;
export interface HomeTarget { readonly section: NavigationKey; readonly entityId?: string; readonly messageId?: string; readonly incomingReferent?: boolean }
export interface HomeSignal extends HomeTarget { readonly id: string; readonly title: string; readonly note: string; readonly score: number; readonly tone: "danger" | "warning" | "brand" }
export type HomePanelKey = "attention" | "notifications" | "messages" | "schedule" | "efficiency" | "department" | "mail" | "recognition" | "feed" | "reactions";
export const homePanelKeys: readonly HomePanelKey[] = ["attention", "schedule", "messages", "notifications", "efficiency", "mail", "department", "recognition", "feed", "reactions"];
export const homeDate = new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Tashkent", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent", year: "numeric", month: "2-digit", day: "2-digit" });
export function homePeriod(now: number): string {
  const parts = localDate.formatToParts(now);
  return parts.find(p => p.type === "year")!.value + "-" + parts.find(p => p.type === "month")!.value;
}
export function timestamp(value?: string | null): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
export function ownsTask(task: WorkspaceTask, userId: string): boolean {
  return task.assigneeId === userId || Boolean(task.participants?.some(p => p.userId === userId && p.role === "co_assignee"));
}
function deadlineSignal(id: string, title: string, section: NavigationKey, dueAt: string | null | undefined, now: number, urgent = false): HomeSignal | undefined {
  const due = timestamp(dueAt);
  if (!due) return undefined;
  const delta = due - now;
  const today = localDate.format(due) === localDate.format(now);
  if (delta > 7 * 86_400_000 && !urgent) return undefined;
  return { id: section + ":" + id, entityId: id, section, title,
    note: (delta < 0 ? "Срок пропущен · " : today ? "Срок сегодня · " : "Ближайший срок · ") + homeDate.format(due),
    score: delta < 0 ? 1000 : today ? 850 : urgent ? 800 : 500 - Math.floor(delta / 86_400_000),
    tone: delta < 0 ? "danger" : today || urgent ? "warning" : "brand" };
}
export function buildPersonalHome(workspace: HomeWorkspace, canView: (key: NavigationKey) => boolean, now = Date.now(), zoom: readonly ZoomMeeting[] = [], hubProjects: readonly ProjectHubProject[] = []) {
  const userId = workspace.currentUser.id;
  const tasks = canView("tasks") ? workspace.tasks.filter(t => ownsTask(t, userId) && !["completed", "cancelled"].includes(t.status)) : [];
  const signals: HomeSignal[] = [];
  for (const task of tasks) {
    // Awaiting the author's review is not a missed action by the executor.
    if (task.status === "awaiting_review") continue;
    const signal = deadlineSignal(task.id, task.title, "tasks", task.dueAt, now, ["high", "urgent"].includes(task.priority));
    if (signal) signals.push(signal);
    else if (task.status === "overdue" || ["high", "urgent"].includes(task.priority)) signals.push({
      id: "tasks:" + task.id, entityId: task.id, section: "tasks", title: task.title,
      note: task.status === "overdue" ? "Отмечена как просроченная" : "Высокий приоритет",
      score: task.status === "overdue" ? 1000 : 700, tone: task.status === "overdue" ? "danger" : "warning",
    });
  }
  if (canView("tasks")) for (const task of workspace.tasks.filter(t => t.authorId === userId && t.status === "awaiting_review")) signals.push({
    id: "review:" + task.id, entityId: task.id, section: "tasks", title: task.title, note: "Вам нужно проверить результат", score: 900, tone: "warning",
  });
  if (canView("projects")) for (const project of workspace.projects.filter(p => p.managerUserId === userId && p.status !== "completed" && !["success", "failure"].includes(p.stage))) {
    const signal = deadlineSignal(project.id, project.title, "projects", project.endDate ? project.endDate + "T23:59:59+05:00" : undefined, now);
    if (signal) signals.push(signal);
  }
  if (canView("project_hub")) for (const project of hubProjects.filter(p => p.lifecycleStatus === "active" && (p.managerUserId === userId || p.responsibleUserIds.includes(userId)))) {
    const signal = deadlineSignal(project.id, project.title, "project_hub", project.endDate ? project.endDate + "T23:59:59+05:00" : undefined, now);
    if (signal) signals.push(signal);
  }
  if (canView("trip_approvals")) for (const trip of workspace.tripRequests.filter(t => !["rejected", "cancelled"].includes(t.status) && (t.requesterUserId === userId || t.employeeIds.includes(userId)))) {
    const signal = deadlineSignal(trip.id, trip.purpose, "trip_approvals", trip.startDate + "T00:00:00+05:00", now);
    if (signal && timestamp(trip.endDate + "T23:59:59+05:00") >= now) signals.push({ ...signal, note: "Поездка · " + trip.destination + " · " + homeDate.format(timestamp(trip.startDate + "T00:00:00+05:00")), tone: "brand", score: 600 });
  }
  const notifications = workspace.notifications.filter(n => canView("notifications") && canView(n.section) && !isObsoleteHisobotNotification(n, now) && (!n.resolvedAt || !n.requiresAction))
    .sort((a, b) => Number(Boolean(b.requiresAction && !b.resolvedAt)) - Number(Boolean(a.requiresAction && !a.resolvedAt)) || Number(!b.readAt) - Number(!a.readAt) || timestamp(b.occurredAt) - timestamp(a.occurredAt));
  const archived = new Set(workspace.personalPreferences.archivedChatIds);
  const latestByChat = new Map<string, HomeWorkspace["messages"][number]>();
  if (canView("messenger")) for (const message of workspace.messages) {
    if (message.deletedAt || message.systemKind) continue;
    const old = latestByChat.get(message.chatId);
    if (!old || timestamp(message.createdAt) > timestamp(old.createdAt)) latestByChat.set(message.chatId, message);
  }
  const chats = canView("messenger") ? workspace.chats.filter(c => !archived.has(c.id) && c.members.some(m => m.userId === userId))
    .map(chat => ({ chat, message: latestByChat.get(chat.id) }))
    .filter(item => item.message || item.chat.preview)
    .sort((a, b) => Number(b.chat.unread > 0) - Number(a.chat.unread > 0) || timestamp(b.message?.createdAt) - timestamp(a.message?.createdAt)) : [];
  const schedule = [
    ...(canView("calendar") ? workspace.calendarEvents.filter(e => e.status === "scheduled" && timestamp(e.endsAt) >= now && (e.organizerUserId === userId || e.attendeeIds.includes(userId)) && e.currentUserAttendanceStatus !== "declined" && ["meeting", "general"].includes(e.eventType))
      .map(e => ({ id: e.id, title: e.title, startsAt: e.startsAt, note: e.location || "Мероприятие", section: "calendar" as const })) : []),
    ...(canView("zoom_meetings") ? zoom.filter(e => e.status === "scheduled" && timestamp(e.endsAt) >= now && (e.organizerUserId === userId || e.participantIds.includes(userId)))
      .map(e => ({ id: e.id, title: e.topic, startsAt: e.startsAt, note: "Zoom · " + e.organizerName, section: "zoom_meetings" as const })) : []),
  ].sort((a, b) => timestamp(a.startsAt) - timestamp(b.startsAt));
  const department = workspace.departments.find(d => d.id === workspace.currentUser.departmentId);
  const colleagues = department ? workspace.people.filter(p => p.id !== userId && p.departmentId === department.id && (!p.status || p.status === "active")).sort((a, b) => a.name.localeCompare(b.name, "ru")) : [];
  const feed = canView("feed") ? [...workspace.feedPosts].sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || timestamp(b.createdAt) - timestamp(a.createdAt)) : [];
  return { tasks, signals: signals.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)), notifications, chats, schedule, department, colleagues, feed };
}
export function rankHomePanels(data: ReturnType<typeof buildPersonalHome>, now = Date.now()): HomePanelKey[] {
  const scores: Partial<Record<HomePanelKey, number>> = {
    attention: data.signals[0]?.score ?? 100,
    notifications: data.notifications.some(n => n.requiresAction && !n.resolvedAt) ? 950 : data.notifications.some(n => !n.readAt) ? 650 : 90,
    messages: data.chats.some(c => c.chat.unread) ? 750 : 150,
    schedule: data.schedule.some(e => timestamp(e.startsAt) - now <= 3_600_000) ? 880 : data.schedule.length ? 550 : 80,
    efficiency: 200, mail: 180, department: 130, recognition: 120, feed: 110, reactions: 100,
  };
  return [...homePanelKeys].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
}
