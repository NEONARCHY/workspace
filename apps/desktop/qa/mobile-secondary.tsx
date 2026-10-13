// Actual components, synthetic data. All API writes fail locally; nothing reaches a server.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, FluentProvider } from "@fluentui/react-components";
import type { AbsenceRequest, AIReferentRegistry, DirectoryBootstrap, HiringDetail, HiringFields, HiringRegistry, SupportRegistry, AssistantChat, EdoIncomingLetter, EmployeeRecognitionProfile, FeedPost, HisobotProfile, HisobotReport, HrOverview, MembersRegistry, NotificationPreferences, PersonalEfficiency, PersonalEfficiencyTask, TelegramAccessRegistry, WorkspaceNotification, WorkspacePerson, ZoomMeetingsRegistry } from "@yuksalish/contracts";
import { FeedView } from "../src/renderer/FeedView";
import { TasksView } from "../src/renderer/TasksView";
import { NotificationCenter } from "../src/renderer/NotificationCenter";
import { EmployeesView } from "../src/renderer/EmployeesView";
import { SidebarVisibilityManagement } from "../src/renderer/SidebarVisibilityManagement";
import { SupportDialog } from "../src/renderer/SupportDialog";
import { LocalFileViewer } from "../src/renderer/FileViewer";
import { AccountPanel } from "../src/renderer/AccountPanel";
import { EmployeeProfileDialog } from "../src/renderer/EmployeeProfileDialog";
import { EmployeeProfileProvider } from "../src/renderer/EmployeeProfileLink";
import { HrView } from "../src/renderer/HrView";
import { MembersView } from "../src/renderer/MembersView";
import { ZoomView } from "../src/renderer/ZoomView";
import { AbsencesView } from "../src/renderer/AbsencesView";
import { AIReferentView } from "../src/renderer/AIReferentView";
import { AIHisobotView } from "../src/renderer/AIHisobotView";
import { TelegramAccessView } from "../src/renderer/TelegramAccessView";
import { IncomingLettersView } from "../src/renderer/IncomingLettersView";
import { YuksalishAssistant } from "../src/renderer/YuksalishAssistant";
import { AdaptiveNavigation } from "../src/renderer/AdaptiveNavigation";
import { BrowserNavigation } from "../src/renderer/BrowserNavigation";
import { CompanyLogo } from "../src/renderer/CompanyLogo";
import { SectionJump } from "../src/renderer/SectionJump";
import { ColorThemeToggle } from "../src/renderer/ColorThemeToggle";
import { Home24Regular, TaskListSquareLtr24Regular, People24Regular, Alert24Regular, News24Regular, Video24Regular, Mail24Regular, Briefcase24Regular, Navigation24Regular } from "@fluentui/react-icons";
import { initialTasks, people } from "../src/renderer/test-fixtures/demo-data";
import { observeBrowserViewport, useBrowserCompactLayout } from "../src/renderer/browser-layout";
import { useQaTheme } from "./color-theme";
import { ThemeExtraPages } from "./dark-components";
import type { SurveyAnalysisDetail } from "@yuksalish/contracts";
import "../src/renderer/styles.css";
import "../src/renderer/responsive.css";
import "../src/renderer/context-colors.css";
import "../src/renderer/personal-organization.css";
import "../src/renderer/design-system.css";
import "../src/renderer/record-composer.css";
import "../src/renderer/motion.css";
import "../src/renderer/record-lists.css";
import "../src/renderer/members.css";
import "../src/renderer/employee-recognition.css";
import "../src/renderer/hr.css";
import "../src/renderer/ai-referent.css";
import "../src/renderer/zoom.css";
import "../src/renderer/message-layout.css";
import "../src/renderer/forwarding.css";
import "../src/renderer/team-dashboard.css";
import "../src/renderer/workday-presence.css";
import "../src/renderer/spatial-workspace.css";
import "../src/renderer/workspace-2-payments.css";
import "../src/renderer/workspace-2-workflow.css";
import "../src/renderer/workspace-2-projects-trips.css";
import "../src/renderer/workspace-2-tasks.css";
import "../src/renderer/workspace-2-interactions.css";
import "../src/renderer/ai-navigation.css";
import "../src/renderer/workspace-2-auth.css";
import "../src/renderer/workspace-2-messenger.css";
import "../src/renderer/workspace-2-notifications.css";
import "../src/renderer/support-dialog.css";
import "../src/renderer/calendar-event-composer.css";
import "../src/renderer/desktop-updates.css";
import "../src/renderer/window-titlebar.css";
import "../src/renderer/web-platform.css";
import "../src/renderer/workspace-2-focus.css";
import "../src/renderer/project-hub.css";
import "../src/renderer/ai-referent-workspace.css";
import "../src/renderer/workspace-inputs.css";
import "../src/renderer/yuksalish-assistant.css";
import "../src/renderer/ai-hisobot.css";
import "../src/renderer/telegram-access.css";
import "../src/renderer/employee-scope.css";
import "../src/renderer/sliding-segmented.css";
import "../src/renderer/scrollbars.css";
import "../src/renderer/accent-surfaces.css";
import "../src/renderer/list-row-hover.css";
import "../src/renderer/workspace-calendar.css";
import "../src/renderer/confirm-action-dialog.css";
import "../src/renderer/context-motion.css";
import "../src/renderer/presence-summary-dialog.css";
import "../src/renderer/assistant-chat.css";
import "../src/renderer/account-settings.css";
import "../src/renderer/profile-header.css";
import "../src/renderer/project-workspace.css";
import "../src/renderer/sidebar-visibility.css";
import "../src/renderer/navigation-sliding.css";
import "../src/renderer/section-headers.css";
import "../src/renderer/sidebar-theme.css";
import "../src/renderer/page-canvas.css";
import "../src/renderer/browser-responsive.css";
import "../src/renderer/hr-hiring.css";
import "../src/renderer/incoming-letters.css";
import "../src/renderer/browser-secondary.css";
const stamp = new Date().toISOString();
const user: WorkspacePerson = { ...people[0]!, role: "superadmin" };
if (new URLSearchParams(location.search).has("theme")) {
  localStorage.setItem("yuksalish:color-theme:" + user.id, new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light");
}
const feed: FeedPost[] = Array.from({ length: 24 }, (_, i) => ({
  id: "qa-post-" + i, authorUserId: people[0]!.id, systemKind: null, title: "Тестовая публикация " + i,
  body: "Длинный тестовый текст и ссылка: https://example.test/" + "long".repeat(30), isPinned: i === 0,
  likedByCurrentUser: false, likeCount: 1, canEdit: true, canPin: true,
  reactions: [{ emoji: "👍", count: 1, reactedByCurrentUser: false, reactorUserIds: [people[1]!.id] }],
  comments: [{ id: "qa-comment-" + i, authorUserId: people[1]!.id, body: "Тестовый ответ коллеги с длинным текстом",
    canDelete: true, createdAt: stamp, reactions: [{ emoji: "❤️", count: 1, reactedByCurrentUser: false, reactorUserIds: [people[0]!.id] }] }],
  createdAt: stamp, updatedAt: stamp,
}));
const notifications: WorkspaceNotification[] = Array.from({ length: 36 }, (_, i) => ({
  id: "qa-notice-" + i, kind: i % 2 ? "trip" : "task", priority: "attention",
  title: "Тестовое уведомление с длинным названием " + i, body: "Тестовые сведения о рабочем событии",
  section: i % 2 ? "trip_approvals" : "tasks", requiresAction: true, isReminder: false, occurredAt: stamp, readAt: null,
}));
const preferences: NotificationPreferences = { desktopEnabled: true, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, absencesEnabled: true, zoomEnabled: true, remindersEnabled: true };
const fields: HiringFields = { fullName: "Тестовый сотрудник", department: "Тестовый отдел", jobTitle: "Специалист", startDate: "2026-10-12", documentDate: "2026-10-12", contractNumber: "TEST-1", orderNumber: "TEST-2", workType: "primary", term: "indefinite", endDate: null, fixedTermReason: "", probationMonths: 0, probationEligible: false, workRegime: "Нормальный", daysPerWeek: 5, hoursPerWeek: 40, annualLeave: 21, additionalLeave: 0, salaryTerms: "По штатному расписанию", accountantDative: "Тест Бухгалтерга", allowances: "", passport: "TEST00000", pinfl: "00000000000000", address: "Тестовый адрес", phone: "+998000000000", additionalTerms: "" };
const item: HiringDetail = { id: "test-case", fullName: fields.fullName, jobTitle: fields.jobTitle, status: "draft", revision: 1, updatedAt: "2026-10-12T00:00:00Z", canEdit: true, canSign: false, fields, applicationBox: { page: 1, x: .58, y: .78, width: .3, height: .1 }, hasApplication: true, applicationPages: 1, hasEmployeeScan: false, returnComment: "", signerName: "Тестовый руководитель", approvedAt: null, documentHashes: {} };
const hiring: HiringRegistry = { items: [item], total: 1, canCreate: true, canConfigureSignature: false, signatureReady: true, signerName: item.signerName };
const directory: DirectoryBootstrap = { roles: [{ key: "employee", label: "Сотрудник", description: "" }], modules: [{ key: "tasks", label: "Задачи", status: "available" }], accessRules: [], positions: [], departments: [], employees: people.map<DirectoryBootstrap["employees"][number]>(item => ({ id: item.id, username: item.username ?? item.id, name: item.name, role: "employee", jobTitle: item.jobTitle, status: "active" })) };
const support: SupportRegistry = { mode: "support", requests: [], unreadResponseCount: 0 };
const localFile = new File(["Тестовый документ"], "Длинное тестовое имя файла.txt", { type: "text/plain" });
const survey: SurveyAnalysisDetail = {
  analysis: { id: "qa-survey", title: "Тестовый опрос команды", fileName: "answers.csv", revision: 1, archived: false, createdAt: stamp, updatedAt: stamp,
    configuration: { sheet: 0, headerRow: 0, types: {}, separator: ";", missingValues: [], query: "", filters: [], savedViews: [] } },
  workbook: { warnings: [], sheets: [{ name: "Ответы", rows: [["Группа", "Возраст"], ["A", "20"], ["B", "30"], ["A", "25"]] }] },
};
const hr: HrOverview = { settings: { hrUserId: user.id, chairUserId: people[1]!.id, accountantUserId: people[2]!.id }, calculatedAt: stamp.slice(0, 10),
  profiles: Array.from({ length: 40 }, (_, i) => ({ id: "qa-hr-" + i, fullName: "Тестовый сотрудник " + i, jobTitle: "Тестовая длинная должность",
    employmentDate: "2020-01-01", serviceAnchorDate: "2026-01-01", serviceYears: 6, serviceMonths: 0, serviceDays: 0, allowancePercent: 20,
    employmentStatus: "active", hiddenAfterYear: false, updatedAt: stamp })), registers: [] };
const members: MembersRegistry = { configured: true, generatedAt: stamp, regions: [{ id: 1, nameRu: "Тестовый регион", nameUz: "Test" }], spheres: [{ id: 1, nameRu: "Тестовая сфера", nameUz: "Test" }],
  members: Array.from({ length: 44 }, (_, i) => ({ id: i + 1, firstName: "Тестовый член", lastName: String(i), status: "active", createdAt: stamp, regionId: 1, regionNameRu: "Тестовый регион", sphereId: 1, sphereNameRu: "Тестовая сфера", gender: "male" })) };
const tomorrow = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const zoom: ZoomMeetingsRegistry = { configured: true, timezone: "Asia/Tashkent", reminderMinutes: 30, bookingHorizonDays: 180, slotMinutes: 15,
  meetings: Array.from({ length: 12 }, (_, i) => ({ id: "qa-zoom-" + i, topic: "Тестовая видеовстреча с длинным названием " + i, description: "Тестовое описание",
    startsAt: tomorrow + "T04:00:00Z", endsAt: tomorrow + "T05:00:00Z", durationMinutes: 60, status: "scheduled", source: "workspace",
    organizerUserId: user.id, organizerName: user.name, participantIds: [people[1]!.id], zoomMeetingId: "81234567890", joinUrl: "https://example.test/meeting", passcode: "0000", canEdit: true, canCancel: true })) };
const absences: AbsenceRequest[] = Array.from({ length: 18 }, (_, i) => ({ id: "qa-absence-" + i, requesterUserId: user.id, directManagerUserId: people[1]!.id,
  kind: "personal_time", reason: "Тестовое основание отсутствия " + i, startsAt: stamp, endsAt: new Date(Date.now() + 3600000).toISOString(),
  status: "pending", statusLabel: "Ожидает решения", documentStatus: "not_required", canEdit: true, allowedActions: ["cancel"], actions: [], createdAt: stamp, updatedAt: stamp }));
const referent: AIReferentRegistry = {
  totalCount: 1,
  pendingReviewCount: 1,
  readyCount: 0,
  sentCount: 0,
  signedCount: 0,
  letters: [{
    id: "letter-1",
    subject: "Ответ партнёру",
    recipientOrganization: "Организация-получатель",
    recipientAddress: "Канцелярия",
    route: "exat" as const,
    note: "",
    status: "pending_review" as const,
    workflowKind: "delivery" as const,
    source: "workspace" as const,
    createdByUserId: people[0]!.id,
    createdByName: "Автор Письма",
    reviewerUserId: people[1]!.id,
    reviewerName: "Согласующий",
    revision: 2,
    createdAt: "2026-09-22T08:00:00Z",
    updatedAt: "2026-09-22T09:00:00Z",
    attachments: [],
    events: [],
    availableActions: ["approve" as const, "return_for_revision" as const],
    canEdit: false,
  }],
};
const incomingRegistry = {
  totalCount: 1,
  filteredCount: 1,
  registeredCount: 1,
  attentionCount: 0,
  withAttachmentsCount: 1,
  lastSyncAt: "2026-09-22T10:00:00Z",
  journal: {
    available: true,
    fileName: "register.xlsx",
    updatedAt: "2026-09-22T10:00:00Z",
  },
  letters: [{
    id: "incoming-1",
    agentId: "referent-pc",
    externalId: "42",
    sequenceNumber: "000042",
    platformIncomingNumber: "0042/26/AI",
    senderLetterNumber: "17-04/88",
    receivedAt: "2026-09-22T08:00:00Z",
    senderOrganization: "Организация-отправитель",
    senderPerson: "Канцелярия",
    subject: "Входящее письмо",
    responsibleExternalId: "bobur",
    responsibleDisplayName: "Бобур",
    urgency: "normal",
    hasAttachments: true,
    attachmentsCount: 2,
    mainDocumentFilename: "letter.pdf",
    platformRecordId: "platform-42",
    status: "platform_submitted",
    fallbackUsed: false,
    errorMessage: "",
    source: "exat" as const,
    revision: 1,
    createdAt: "2026-09-22T08:00:00Z",
    updatedAt: "2026-09-22T09:00:00Z",
  }],
};
const bots: TelegramAccessRegistry = { bots: [{ key: "ai_referent", label: "AI Referent", connected: true }, { key: "hisobot", label: "AI Hisobot", connected: true }],
  people: Array.from({ length: 28 }, (_, i) => ({ userId: "qa-bot-" + i, username: "qa" + i, fullName: "Тестовый сотрудник " + i, jobTitle: "Тестовая должность",
    telegramId: null, verified: false, verificationSource: null, botKeys: [], revision: 0, hisobotScope: null, hisobotRegion: null, hisobotReportRequired: true, hisobotManager: false })) };
const hisobot: HisobotProfile = { telegramId: "123456789", fullName: user.name, position: "Тестовая должность", reportScope: "central", regionName: null,
  reportRequired: true, managementAccess: false, absenceKind: null, today: stamp.slice(0, 10), canSubmit: true, windowOpensAt: "12:00", windowClosesAt: "18:30", todayReport: null };
const reports: HisobotReport[] = Array.from({ length: 32 }, (_, i) => ({ id: "qa-report-" + i, userId: user.id, telegramId: "123456789", employeeKey: "qa", fullName: user.name,
  position: "Тестовая должность", reportScope: "central", regionName: null, reportDate: stamp.slice(0, 10), content: "Тестовый выполненный отчёт " + i, submittedAt: stamp, isLate: false, source: "workspace" }));
const profile: EmployeeRecognitionProfile = { person: user, departmentName: "Тестовый отдел", employmentDate: null, activeTaskCount: 3, activeTaskCountVisible: true,
  rewards: [], rewardCatalog: [], canIssueReward: false, canManageSettings: false,
  achievements: Array.from({ length: 24 }, (_, i) => ({ code: "qa-achievement-" + i, title: "Тестовое достижение " + i, description: "Подтверждённый тестовый критерий",
    category: "tasks", tier: (["bronze", "silver", "gold", "platinum", "sapphire", "amethyst", "prism", "cosmic"] as const)[i % 8]!, iconKey: "check", progress: 1, target: 1, unlocked: true })) };
const rewardIcons = ["appreciation", "leadership", "rescue", "mentorship", "innovation", "reliability", "teamwork", "initiative", "mastery"] as const;
const richProfile: EmployeeRecognitionProfile = { ...profile,
  achievements: [...profile.achievements, ...profile.achievements.slice(0, 8).map(item => ({ ...item, code: item.code + "-locked", title: item.title + " — в процессе", unlocked: false, progress: 1, target: 3 }))],
  rewards: rewardIcons.map((iconKey, i) => ({ id: "qa-reward-" + i, iconKey, title: "Тестовая награда " + i, description: "Признание тестового вклада", recipientUserId: user.id, issuerUserId: people[1]!.id, issuerName: people[1]!.name, createdAt: stamp })),
  rewardCatalog: rewardIcons.map((iconKey, i) => ({ iconKey, title: "Тестовая награда " + i, description: "Признание тестового вклада" })),
};
const task: PersonalEfficiencyTask = { id: "task-1", title: "Подготовить отчёт", status: "awaiting_review", dueAt: "2026-10-05T09:00:00Z", updatedAt: "2026-10-04T09:00:00Z", onTimeCount: 1, overdueCount: 0, excludedCount: 0, returnedForRevisionCount: 0 };
const summary: PersonalEfficiency = {
  employee: { userId: people[0]!.id, name: "Сотрудник", jobTitle: "Специалист", period: "2026-10", timezone: "Asia/Tashkent", percentage: 75, onTimeCount: 3, eligibleCount: 4, overdueCount: 1, awaitingReviewCount: 1, noDueDateCount: 1, returnedForRevisionCount: 1, excludedCount: 1, sampleSize: 4, methodologyVersion: "EFF-2.0", trackingStartedAt: "2026-09-01T00:00:00Z", historyCompleteness: "complete", smallSample: true, history: [] },
  taskDetailsVisible: true, workload: { new: 1, inProgress: 2, awaitingReview: 1, completed: 3 }, recentTasks: [task], impactTasks: [task], impactTaskCount: 1,
};
const efficiencyOverview = { period: stamp.slice(0, 7), timezone: "Asia/Tashkent", methodologyVersion: "EFF-2.0", trackingStartedAt: stamp, currentUserId: user.id, employees: [summary.employee] };

const letter: EdoIncomingLetter = {
  id: 17, version: 4, status: 1, in_num: "EX-17", in_date: "2026-10-01 00:00:00",
  out_num: null, out_date: null, organization: "Организация", region: "Ташкент",
  description: "Подготовить ответ", deadline: "2026-10-04 00:00:00", deadline2: null,
  type: null, comment: null, result: null, result_time: null, legacy_dates_timezone: "unknown",
  assignments: [{ user_id: 101, employee_id: people[0]!.id, queue: 0, assigned_at_legacy: null, viewed: true }],
  attachments: [], overdue: null,
};
const page = { data: [letter], meta: { page: 1, limit: 20, total: 1 }, deadline_timezone_verified: false };

const chats: AssistantChat[] = Array.from({ length: 12 }, (_, i) => ({ id: "qa-chat-" + i, title: "Тестовый старый чат " + i, isDefault: !i, isPinned: false, createdAt: stamp, updatedAt: stamp }));
const rejectSave = async (): Promise<never> => { throw new Error("QA: тестовый отказ, черновик сохранён"); };
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href), route = url.pathname.replace(/^\/api\/v1/, "");
  if (!url.pathname.startsWith("/api/")) return originalFetch(input, init);
  if ((init?.method ?? (input instanceof Request ? input.method : "GET")) !== "GET") {
    if (route.startsWith("/assistant/") && new URLSearchParams(location.search).has("thinking")) await new Promise(resolve => setTimeout(resolve, 1500));
    return Response.json({ detail: "QA: тестовый отказ, черновик сохранён" }, { status: 503 });
  }
  if (route.startsWith("/recognition/profiles/")) return Response.json(new URLSearchParams(location.search).has("recognition") ? richProfile : profile);
  if (route === "/profile/me/efficiency") return Response.json(summary);
  if (route === "/home/reactions") return Response.json({ totalCount: 7, reactions: [{ emoji: "👍", count: 4 }, { emoji: "❤️", count: 3 }] });
  if (route === "/workday/team") return Response.json({ asOf: stamp, workingCount: 4, members: people.map(person => ({ userId: person.id, name: person.name, jobTitle: person.jobTitle, status: "working", schedule: { userId: person.id, startsAt: "09:00:00", endsAt: "18:00:00" }, session: null, absenceKind: null, canEditSchedule: true })) });
  if (route === "/efficiency") return Response.json(efficiencyOverview);
  if (route === "/hr") return Response.json(hr);
  if (route === "/hr/hiring") return Response.json(hiring);
  if (route.startsWith("/hr/hiring/")) return Response.json(item);
  if (route.endsWith("/sidebar")) return Response.json({ userId: user.id, hiddenKeys: [], revision: 0 });
  if (route.startsWith("/support-requests")) return Response.json(support);
  if (route === "/recognition/settings") return Response.json({ activeTaskCountVisible: true });
  if (route === "/telegram-access") return Response.json(bots);
  if (route === "/hisobot/me") return Response.json(hisobot);
  if (route.includes("/unit-history") || route.includes("/unit-reports")) return Response.json([]);
  if (route.startsWith("/hisobot/")) return Response.json(reports);
  if (route === "/incoming-letters") return Response.json(page);
  if (route.startsWith("/incoming-letters/") && !route.includes("/access")) return Response.json({ data: letter, deadline_timezone_verified: false });
  if (route === "/ai-referent/authority") return Response.json({ writable: true, mode: "legacy", leaseUntil: null, detail: "" });
  if (route === "/ai-referent/visibility") return Response.json({ incomingMode: "all", canViewJournals: true, canManageVisibility: false, revision: 0 });
  if (route === "/ai-referent/incoming") return Response.json(incomingRegistry);
  if (route === "/ai-referent/letters") return Response.json(referent);
  if (route.startsWith("/ai-referent/letters/")) return Response.json(referent.letters[0]);
  if (route === "/ai-referent/reviewers") return Response.json({ revision: 1, updatedAt: stamp, reviewers: [], runtimes: [] });
  if (route === "/ai-referent/recipients/manual") return Response.json([]);
  if (route === "/ai-referent/recipients") return Response.json({ entries: [], totalCount: 0, updatedAt: stamp });
  if (route === "/assistant/chats") return Response.json(chats);
  if (route === "/assistant/messages") return Response.json([]);
  if (route.endsWith("/availability")) return Response.json({ intervals: [] });
  if (route.includes("totp")) return Response.json({ enabled: false });
  if (route.includes("birthday")) return Response.json({ month: null, day: null });
  if (route === "/directory") return Response.json(directory);
  if (route === "/survey-analyses") return Response.json([survey.analysis]);
  if (route === "/survey-analyses/qa-survey") return Response.json(survey);
  if (route === "/updates/policy") return Response.json({ publishedVersion: null, minimumVersion: null, mandatory: false, updatedAt: null, release: null });
  return Response.json([]);
};
function Fixture() {
  const workspaceTheme = useQaTheme();
  const shell = new URLSearchParams(location.search).has("shell");
  const compact = useBrowserCompactLayout(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [section, setSection] = useState(shell ? "home" : "feed"), [account, setAccount] = useState(false), [person, setPerson] = useState(false), [sidebar, setSidebar] = useState(false), [supportOpen, setSupportOpen] = useState(false), [fileOpen, setFileOpen] = useState(false);
  const navigation = [
    { key: "home", label: "Главная", icon: <Home24Regular /> },
    { key: "tasks", label: "Задачи", icon: <TaskListSquareLtr24Regular /> },
    { key: "employees", label: "Сотрудники", icon: <People24Regular /> },
    { key: "notifications", label: "Уведомления", icon: <Alert24Regular /> },
    { key: "feed", label: "Лента", icon: <News24Regular /> },
    { key: "zoom_meetings", label: "Zoom-конференции", icon: <Video24Regular /> },
    { key: "incoming_letters", label: "Входящие письма", icon: <Mail24Regular /> },
    { key: "hr", label: "HR", icon: <Briefcase24Regular /> },
  ] as const;
  const sectionKey = (key: string) => key === "incoming_letters" ? "incoming" : key === "zoom_meetings" ? "zoom" : key;
  const navigate = (key: string) => { setSection(sectionKey(key)); setMenuOpen(false); };
  useEffect(() => { document.documentElement.classList.add("web-platform"); return observeBrowserViewport(); }, []);
  return <FluentProvider theme={workspaceTheme} className="app-provider"><EmployeeProfileProvider onOpenProfile={() => setPerson(true)}>
    <div className={`app-shell${!shell || compact ? " browser-compact" : ""}`}>
      {shell && <BrowserNavigation compact={compact} open={menuOpen} returnFocusRef={menuTrigger} onOpenChange={setMenuOpen}>
        <aside className="app-rail sidebar-palette" data-sidebar-theme="blue-teal" aria-label="Основная навигация">
          <div className="workspace-logo"><button className="rail-toggle" aria-label="Закрыть меню" onClick={() => setMenuOpen(false)}><Navigation24Regular /></button><CompanyLogo tone="white" className="rail-brand" /></div>
          <div className="rail-customize"><span>Меню</span></div>
          <AdaptiveNavigation items={navigation} scrollable={compact} renderItem={(item, _overflow, closeOverflow) => <div className="rail-slot" key={item.key}><button className={`rail-action${section === sectionKey(item.key) ? " active" : ""}`} aria-current={section === sectionKey(item.key) ? "page" : undefined} onClick={() => { navigate(item.key); closeOverflow(); }}><span className="rail-icon">{item.icon}</span><span className="rail-label">{item.label}</span></button></div>} />
          <div className="rail-bottom"><button className="rail-profile" onClick={() => setPerson(true)}>{user.name}</button></div>
        </aside>
      </BrowserNavigation>}
      <div className="app-stage">
      {shell ? <header className="global-bar">
        {compact && <button ref={menuTrigger} className="browser-menu-trigger" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Navigation24Regular /></button>}
        <SectionJump items={navigation} onNavigate={navigate} />
        <div className="workspace-top-context"><ColorThemeToggle userId="qa-theme" /><Button onClick={() => setAccount(true)}>Настройки</Button><Button onClick={() => setPerson(true)}>{user.name}</Button></div>
      </header> : <header style={{ display: "flex", flexWrap: "wrap", gap: 4, paddingBottom: 8 }}>
        <select aria-label="QA раздел" value={section} onChange={event => setSection(event.target.value)} style={{ minHeight: 48, minWidth: 0, maxWidth: "100%", fontSize: 16 }}>
          {["feed", "notifications", "hr", "members", "zoom", "absences", "referent", "hisobot", "bots", "incoming", "employees", "tasks", "home", "team", "departments", "access", "components", "login", "surveys", "legacy-projects"].map(key => <option key={key}>{key}</option>)}
        </select><Button onClick={() => setAccount(true)} style={{ minHeight: 48 }}>Настройки</Button><Button onClick={() => setPerson(true)} style={{ minHeight: 48 }}>Профиль</Button><Button onClick={() => setSidebar(true)}>Меню сотрудника</Button><Button onClick={() => setSupportOpen(true)}>Поддержка QA</Button><Button onClick={() => setFileOpen(true)}>Файл QA</Button>
      </header>}<main className="app-content">
        <ThemeExtraPages section={section} directory={directory} />
        {section === "tasks" && <TasksView token="qa-only" tasks={initialTasks} attachments={[]} people={people} currentUserId={user.id} efficiency={efficiencyOverview} efficiencyLoading={false} onLoadEfficiency={() => {}}
          onCreateTask={rejectSave} onCreateSubtask={rejectSave} onChangeStatus={rejectSave} onUpdateTask={rejectSave} onDeleteTask={rejectSave}
          onSetParticipant={rejectSave} onRemoveParticipant={rejectSave} onAddChecklistItem={rejectSave} onToggleChecklistItem={rejectSave} onDeleteChecklistItem={rejectSave}
          onAddComment={rejectSave} onSetDependency={rejectSave} onRemoveDependency={rejectSave} onSetCycle={rejectSave}
          onReturnForRevision={rejectSave} onSubmitResult={rejectSave} onAcceptResult={rejectSave} onSetEfficiencyExclusion={rejectSave} onExtendDeadline={rejectSave}
          onUploadAttachments={rejectSave} onDownloadAttachment={rejectSave} renderTaskChat={() => <p>Синтетический чат — отдельно проверен в mobile-domains</p>} />}
        {section === "employees" && <EmployeesView token="qa-only" currentUser={user} allowAdministration allowChatAdministration onInvite={() => setAccount(true)} />}
        {section === "feed" && <FeedView posts={feed} people={people} token="qa-only" currentUserId={user.id} onCreate={rejectSave} onComment={rejectSave} onReact={rejectSave} onDeleteComment={rejectSave} onPin={rejectSave} onDelete={rejectSave} />}
        {section === "notifications" && <NotificationCenter notifications={notifications} preferences={preferences} onOpen={() => {}} onMarkRead={rejectSave} onMarkAllRead={rejectSave} onUpdatePreferences={rejectSave} onDelete={rejectSave} />}
        {section === "hr" && <HrView token="qa-only" people={people} currentUser={user} />}
        {section === "members" && <MembersView registry={members} loading={false} onRefresh={() => {}} />}
        {section === "zoom" && <ZoomView token="qa-only" people={people} currentUserId={user.id} registry={zoom} loading={false} onRefresh={() => {}} />}
        {section === "absences" && <AbsencesView token="qa-only" currentUserId={user.id} people={people} requests={absences} summary={people.map(item => ({ userId: item.id, status: "working", requestId: null }))} canAdmin onCreate={rejectSave} onAction={rejectSave} onUploadDocument={rejectSave} />}
        {section === "referent" && <AIReferentView token="qa-only" people={people} canCreate />}
        {section === "hisobot" && <AIHisobotView token="qa-only" />}
        {section === "bots" && <TelegramAccessView token="qa-only" />}
        {section === "incoming" && <IncomingLettersView token="qa-only" people={people} currentUserId={user.id} canEdit />}
      </main>
    </div></div>
    {sidebar && <SidebarVisibilityManagement token="qa-only" directory={directory} currentUser={user} initialUserId={user.id} onClose={() => setSidebar(false)} />}
    <SupportDialog token="qa-only" open={supportOpen} registry={support} onOpenChange={setSupportOpen} onRegistryChange={() => {}} />
    {fileOpen && <LocalFileViewer file={localFile} onClose={() => setFileOpen(false)} onLoadOffice={rejectSave} />}
    {account && <AccountPanel token="qa-only" user={user} onClose={() => setAccount(false)} onLogout={() => {}} />}
    <EmployeeProfileDialog token="qa-only" userId={user.id} currentUserId={user.id} people={people} open={person} onOpenChange={setPerson} />
    <YuksalishAssistant token="qa-only" />
  </EmployeeProfileProvider></FluentProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
