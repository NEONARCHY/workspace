import { dropSpatialCard, installSpatialGeometry } from "./spatial-test-helpers";
import { act, cleanup, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from "@testing-library/react";
import { createDOMRenderer, RendererProvider } from "@fluentui/react-components";
import type { ReactElement } from "react";
import { disposeTabster, getTabster } from "tabster";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AIReferentLetter,
  SurveyAnalysisDetail,
  ApprovalRequestSummary,
  CalendarEvent,
  CalendarEventInput,
  ChatMessage,
  FeedPost,
  NotificationPreferences,
  PaymentRequestDetails,
  TripRequest,
  WorkspaceAttachment,
  WorkspaceProject,
  WorkspaceNotification,
  WorkspaceTask,
} from "@yuksalish/contracts";

import { App } from "./App";
import { initialChats, initialMessages, initialTasks, people } from "./test-fixtures/demo-data";
import { homeEfficiency, homeRecognition } from "./test-fixtures/personal-home-fixture";

// Compile the real workflow chunks during collection. These tests exercise UI/API
// behaviour, not cold Vite transforms racing the application's idle preloader.
// React.lazy, Suspense, accessible queries and all business assertions stay real.
import "./PersonalHomeView";
import "./ProjectHubView";
import "./ProjectsView";
import "./TripApprovalsView";
import "./FeedView";
import "./CalendarView";
import "./SurveyAnalyticsView";
import "./EmployeesView";
import "./TasksView";
import "./AIReferentView";

function render(element: ReactElement) {
  // Each scenario models a new app session. A shared Griffel renderer retains
  // unrelated screens' CSS, making jsdom accessibility queries slower over time.
  const renderer = createDOMRenderer(document, {
    styleElementAttributes: { "data-app-test-renderer": "true" },
  });
  return renderTestingLibrary(<RendererProvider renderer={renderer}>{element}</RendererProvider>);
}

const workflow = {
  id: "workflow",
  name: "Оплата",
  version: 1,
  status: "draft",
  publishedVersion: 1,
  formSchema: {},
  nodes: [
    {
      id: "start",
      kind: "start" as const,
      label: "Старт",
      detail: "",
      positionX: 0,
      positionY: 0,
      config: {},
    },
    {
      id: "manager",
      kind: "approval" as const,
      label: "Согласование",
      detail: "",
      positionX: 240,
      positionY: 0,
      config: {},
    },
    {
      id: "correction",
      kind: "correction" as const,
      label: "Доработка",
      detail: "",
      positionX: 480,
      positionY: 160,
      config: {},
    },
    {
      id: "end",
      kind: "end" as const,
      label: "Согласовано",
      detail: "",
      positionX: 480,
      positionY: 0,
      config: {},
    },
  ],
  edges: [
    {
      id: "edge",
      source: "start",
      target: "manager",
      outcome: "submit",
      condition: {},
      sortOrder: 0,
    },
    {
      id: "approve-edge",
      source: "manager",
      target: "end",
      outcome: "approve",
      condition: {},
      sortOrder: 0,
    },
    {
      id: "return-edge",
      source: "manager",
      target: "correction",
      outcome: "return",
      condition: {},
      sortOrder: 0,
    },
    {
      id: "resubmit-edge",
      source: "correction",
      target: "start",
      outcome: "resubmit",
      condition: {},
      sortOrder: 0,
    },
  ],
};

const paymentDetails: PaymentRequestDetails = {
  transferType: "Другие услуги",
  projectName: "Yuksalish",
  projectCode: "YUK",
  sourceAccount: "Основной счёт",
  destinationAccount: "Счёт поставщика",
  requestPriority: "normal",
  deadline: null,
  comment: "",
  tripPurpose: "",
  tripStartDate: null,
  tripEndDate: null,
  employeeIds: [],
  paymentPurpose: "Оплата за услуги",
  paymentReason: "Рабочие расходы",
  responsibleUserId: people[0]!.id,
};

const position = {
  id: "position-finance",
  name: "Bosh hisobchi",
  isActive: true,
  sortOrder: 10,
  source: "bitrix",
  assignedUsersCount: 1,
};

const directory = {
  roles: [
    { key: "employee", label: "Сотрудник", description: "" },
    { key: "manager", label: "Руководитель", description: "" },
    { key: "admin", label: "Администратор", description: "" },
  ],
  positions: [position],
  employees: people.map((person, index) => ({
    id: person.id,
    username: person.username,
    name: person.name,
    role: person.role,
    positionId: index === 0 ? position.id : null,
    jobTitle: person.jobTitle,
    status: "active",
  })),
};

function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    blob: async () => new Blob(),
  } as Response;
}

function mockServer(
  serverOptions: {
    readonly withReturnedRequest?: boolean;
    readonly restrictPaymentCreators?: boolean;
    readonly extraNotifications?: readonly WorkspaceNotification[];
    readonly failApprovalActionOnce?: boolean;
    readonly withSubsidyRequest?: boolean;
    readonly superadminLogin?: boolean;
    readonly chairmanLogin?: boolean;
  } = {},
) {
  let failApprovalActionOnce = serverOptions.failApprovalActionOnce ?? false;
  let currentUser = people[0]!;
  const messages: ChatMessage[] = [...initialMessages];
  let tasks: WorkspaceTask[] = initialTasks.map((task) => ({ ...task }));
  let requests: ApprovalRequestSummary[] = serverOptions.withSubsidyRequest
    ? [{
        id: "subsidy-request", workflowId: workflow.id, number: "503",
        title: "Оплата по субсидии", amount: 1000, currency: "UZS", purpose: "",
        status: "running", statusLabel: "Ожидает решения",
        routeVariant: "subsidy", activeNodeKeys: ["manager"],
        activeStages: [{ key: "manager", label: "Согласование", kind: "approval", canAct: true }],
        stageLabel: "Согласование", requesterId: people[0]!.id,
        responsibleUserId: people[0]!.id,
        details: { ...paymentDetails, projectName: "Субсидия", projectId: "hub-subsidy" },
        createdAt: "2026-09-03T10:00:00Z", updatedAt: "2026-09-03T10:00:00Z",
        revision: 1, versions: [], actions: [],
      }]
    : serverOptions.withReturnedRequest
    ? [
        {
          id: "returned-request",
          number: "501",
          title: "Вернувшаяся заявка",
          amount: 5_000_000,
          currency: "UZS",
          purpose: "Требует исправления",
          status: "needs_revision" as const,
          statusLabel: "На доработке",
          activeNodeKeys: ["correction"],
          activeStages: [{ key: "correction", label: "Доработка", kind: "correction", canAct: true }],
          stageLabel: "Доработка",
          requesterId: people[0]!.id,
          responsibleUserId: people[0]!.id,
          sourceTaskId: initialTasks[0]!.id,
          details: paymentDetails,
          createdAt: "2026-09-03T10:00:00Z",
          updatedAt: "2026-09-03T10:15:00Z",
          revision: 1,
          versions: [
            {
              version: 1,
              title: "Вернувшаяся заявка",
              amount: 5_000_000,
              currency: "UZS",
              purpose: "Требует исправления",
              details: paymentDetails,
              attachmentIds: [],
              editedByUserId: people[0]!.id,
              changeReason: "initial",
              createdAt: "2026-09-03T10:00:00Z",
            },
          ],
          actions: [
            {
              action: "return",
              comment: "Исправьте сумму и приложите новый счёт",
              actorUserId: people[1]!.id,
              nodeKey: "manager",
              createdAt: "2026-09-03T10:15:00Z",
            },
          ],
        },
      ]
    : [];
  let projects: WorkspaceProject[] = [
    {
      id: "project-1",
      code: "WS-26",
      title: "Yuksalish Workspace",
      description: "Единая корпоративная среда",
      managerUserId: people[0]!.id,
      startDate: "2026-08-01",
      endDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      budget: 100_000_000,
      spentBudget: 20_000_000,
      remainingBudget: 80_000_000,
      currency: "UZS",
      status: "in_progress",
      stage: "preparation",
      createdByUserId: people[0]!.id,
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-09-03T09:00:00Z",
      canEdit: true,
      canMove: true,
      history: [],
    },
  ];
  let tripRequests: TripRequest[] = [
    {
      id: "trip-1",
      number: "TR-00000001",
      requesterUserId: people[0]!.id,
      purpose: "Встреча с региональной командой",
      destination: "Самарканд",
      startDate: "2026-09-18",
      endDate: "2026-09-20",
      employeeIds: [people[0]!.id],
      stage: "launch",
      stageLabel: "Запуск",
      status: "draft",
      statusLabel: "Черновик",
      canEdit: true,
      allowedActions: ["submit"],
      actions: [],
      createdAt: "2026-09-03T09:00:00Z",
      updatedAt: "2026-09-03T09:00:00Z",
    },
  ];
  let feedPosts: FeedPost[] = [
    {
      id: "feed-1",
      authorUserId: people[0]!.id,
      title: "Новости Workspace",
      body: "Корпоративная лента подключена.",
      isPinned: true,
      likedByCurrentUser: false,
      likeCount: 1,
      canEdit: true,
      canPin: true,
      comments: [],
      createdAt: "2026-09-03T09:00:00Z",
      updatedAt: "2026-09-03T09:00:00Z",
    },
  ];
  const calendarMeetingStart = Date.now() + 7 * 24 * 60 * 60 * 1000;
  let calendarEvents: CalendarEvent[] = [
    {
      id: "calendar-1",
      organizerUserId: people[0]!.id,
      title: "Планирование недели",
      description: "Общий статус",
      eventType: "meeting",
      startsAt: new Date(calendarMeetingStart).toISOString(),
      endsAt: new Date(calendarMeetingStart + 60 * 60 * 1000).toISOString(),
      allDay: false,
      location: "Переговорная",
      status: "scheduled",
      attendeeIds: [people[0]!.id],
      attendees: [{ userId: people[0]!.id, status: "accepted", respondedAt: "2026-09-03T09:00:00Z" }],
      currentUserAttendanceStatus: "accepted",
      canRespond: false,
      canEdit: true,
      createdAt: "2026-09-03T09:00:00Z",
      updatedAt: "2026-09-03T09:00:00Z",
    },
  ];
  const attachments: WorkspaceAttachment[] = [];
  let notifications: WorkspaceNotification[] = [
    {
      id: "notification-task",
      kind: "task",
      priority: "attention",
      title: "Задача требует внимания",
      body: initialTasks[0]!.title,
      section: "tasks",
      entityId: initialTasks[0]!.id,
      requiresAction: true,
      isReminder: false,
      occurredAt: "2026-09-04T09:30:00Z",
    },
    {
      id: "notification-message",
      kind: "message",
      priority: "normal",
      title: "Новое сообщение · Финансы и закупки",
      body: "Дилшод: Счёт готов",
      section: "messenger",
      entityId: "finance",
      requiresAction: false,
      isReminder: false,
      occurredAt: "2026-09-04T09:20:00Z",
    },
    ...(serverOptions.extraNotifications ?? []),
  ];
  let notificationPreferences: NotificationPreferences = {
    desktopEnabled: true,
    messagesEnabled: true,
    tasksEnabled: true,
    approvalsEnabled: true,
    tripsEnabled: true,
        calendarEnabled: true,
        absencesEnabled: true,
    zoomEnabled: true,
    remindersEnabled: true,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      const payload = JSON.parse(String(options?.body)) as { username: string };
      const selectedUser = people.find((person) => person.username === payload.username) ?? people[0]!;
      currentUser = serverOptions.superadminLogin && selectedUser.username === "malika"
        ? { ...selectedUser, role: "superadmin" }
        : serverOptions.chairmanLogin && selectedUser.username === "malika"
          ? { ...selectedUser, jobTitle: '"Yuksalish" harakati raisi, Qonunchilik palatasi qo\'mita raisi' }
          : selectedUser;
      return response({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "bearer",
        expiresIn: 900,
        user: currentUser,
      });
    }
    if (url.endsWith("/auth/refresh")) {
      return response({
        accessToken: "refreshed-access-token",
        refreshToken: "rotated-refresh-token",
        tokenType: "bearer",
        expiresIn: 900,
        user: currentUser,
      });
    }
    if (url.endsWith("/workspace/bootstrap")) {
      const activeWorkflow = serverOptions.restrictPaymentCreators
        ? {
            ...workflow,
            nodes: workflow.nodes.map((node) => node.kind === "start"
              ? { ...node, config: { creatorPositionIds: ["another-position"] } }
              : node),
          }
        : workflow;
      return response({
        currentUser,
        canCreatePaymentRequests: !serverOptions.restrictPaymentCreators,
        people,
        departments: [],
        positions: directory.positions.map(({ id, name }) => ({ id, name })),
        chats: initialChats,
        messages: [...messages],
        tasks,
        requests,
        requestWorkflows: [activeWorkflow],
        projects,
        tripRequests,
        feedPosts,
        calendarEvents,
        notifications,
        notificationPreferences,
        attachments: [...attachments],
        workflow: activeWorkflow,
      });
    }
    if (url.endsWith("/directory") && options?.method === undefined) {
      return response(directory);
    }
    if (url.endsWith("/workday/me") && options?.method === undefined) {
      return response({
        status: "not_started", schedule: { userId: currentUser.id, startsAt: "09:00:00", endsAt: "18:00:00" },
        session: null, absenceKind: null, asOf: "2026-09-23T09:00:00Z",
      });
    }
    if (url.endsWith("/workday/team") && options?.method === undefined) {
      return response({ asOf: "2026-09-23T09:00:00Z", workingCount: 0, members: [] });
    }
    if (url.includes("/profile/me/efficiency") && options?.method === undefined) {
      return response(homeEfficiency(currentUser.id));
    }
    if (url.includes("/recognition/profiles/") && options?.method === undefined) {
      return response(homeRecognition(currentUser.id));
    }
    if (url.endsWith("/home/reactions")) return response({ totalCount: 0, reactions: [] });
    if (url.endsWith("/project-hub")) return response({ projects: [], workstreams: [], items: [], requests: [] });
    if (url.endsWith("/ai-referent/reviewers")) return response({ reviewers: [], revision: 1, runtimes: [], updatedAt: "2026-10-19T08:00:00Z" });
    if (url.endsWith("/ai-referent/visibility")) return response({ incomingMode: "none", canViewJournals: false, canManageVisibility: false });
    if (url.includes("/ai-referent/signature-inbox") || url.endsWith("/ai-referent/letters/qa-signature") || url.includes("/ai-referent/letters?")) {
      const letter: AIReferentLetter = {
        id: "qa-signature", subject: "Письмо из обзора команды", recipientOrganization: "Партнёр", recipientAddress: "partner@example.test",
        route: "webmail", note: "", workflowKind: "delivery", status: "pending_review", source: "workspace",
        createdByUserId: people[0]!.id, createdByName: people[0]!.name, reviewerUserId: currentUser.id,
        revision: 1, createdAt: "2026-10-19T08:00:00Z", updatedAt: "2026-10-19T08:00:00Z",
        attachments: [], events: [], availableActions: ["approve", "return_for_revision"], canEdit: false,
      };
      return response(url.endsWith("/qa-signature") ? letter : { letters: [letter], totalCount: 1, pendingReviewCount: 1, readyCount: 0, sentCount: 0, signedCount: 0 });
    }
    if (url.includes("/ai-referent/incoming") || url.includes("/incoming-letters")) {
      return response({ detail: "Интеграция не подключена" }, 503);
    }
    if (url.includes("/efficiency") && options?.method === undefined) {
      return response({
        period: "2026-09",
        timezone: "Asia/Tashkent",
        methodologyVersion: "EFF-1.0",
        trackingStartedAt: "2026-09-01T00:00:00Z",
        currentUserId: currentUser.id,
        employees: people.map((person) => ({
          userId: person.id,
          name: person.name,
          jobTitle: person.jobTitle ?? "",
          period: "2026-09",
          timezone: "Asia/Tashkent",
          percentage: 80,
          onTimeCount: 4,
          eligibleCount: 5,
          overdueCount: 1,
          awaitingReviewCount: 1,
          noDueDateCount: 0,
          returnedForRevisionCount: 0,
          excludedCount: 0,
          sampleSize: 5,
          methodologyVersion: "EFF-1.0",
          trackingStartedAt: "2026-09-01T00:00:00Z",
          historyCompleteness: "complete",
          smallSample: false,
          history: [],
        })),
      });
    }
    if (url.endsWith("/notifications/read-all") && options?.method === "POST") {
      notifications = notifications.map((item) => ({
        ...item,
        readAt: item.readAt ?? "2026-09-04T10:00:00Z",
      }));
      return { ...response(undefined), status: 204, json: async () => undefined } as Response;
    }
    const notificationReadMatch = url.match(/\/notifications\/([^/]+)\/read$/);
    if (notificationReadMatch && options?.method === "PATCH") {
      const notification = notifications.find((item) => item.id === notificationReadMatch[1])!;
      const changed = { ...notification, readAt: "2026-09-04T10:00:00Z" };
      notifications = notifications.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (url.endsWith("/notification-preferences") && options?.method === "PUT") {
      notificationPreferences = JSON.parse(String(options.body)) as NotificationPreferences;
      return response(notificationPreferences);
    }
    if (url.endsWith("/approval-templates/workflow/publish") && options?.method === "POST") {
      return response({ ...workflow, id: "workflow-v2", version: 2, publishedVersion: 1 });
    }
    if (url.endsWith("/approval-templates/workflow/graph") && options?.method === "PUT") {
      const payload = JSON.parse(String(options.body)) as {
        nodes: typeof workflow.nodes;
        edges: typeof workflow.edges;
      };
      return response({ ...workflow, ...payload });
    }
    if (url.endsWith("/directory/positions") && options?.method === "POST") {
      return response({
        id: "position-new",
        name: "Yangi lavozim",
        isActive: true,
        sortOrder: 10,
        source: "workspace",
        assignedUsersCount: 0,
      });
    }
    if (url.includes("/messages") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { body: string };
      const message: ChatMessage = {
        id: "server-message",
        chatId: initialChats[0]!.id,
        authorId: people[0]!.id,
        body: payload.body,
        time: "12:00",
        own: true,
      };
      messages.push(message);
      return response(message);
    }
    if (url.includes("/chats/") && url.endsWith("/read") && options?.method === "POST") {
      return { ...response(undefined), status: 204, json: async () => undefined } as Response;
    }
    if (url.includes("/chats/") && url.endsWith("/forwards") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { requestId: string; kind: "feed"; sourceId: string };
      const post = feedPosts.find(item => item.id === payload.sourceId)!;
      const chatId = url.match(/\/chats\/([^/]+)/)?.[1];
      if (!chatId) throw new Error("Invalid test forwarding route");
      const message: ChatMessage = { id: payload.requestId, chatId, authorId: currentUser.id, own: true,
        body: post.body.slice(0, 240), time: "14:09", canEdit: false, forwarded: {
          kind: payload.kind, authorId: post.authorUserId, authorName: currentUser.name,
          postId: post.id, title: post.title, available: true,
        } };
      messages.push(message);
      return response(message);
    }
    if (url.endsWith("/feed/posts") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { title: string; body: string };
      const created: FeedPost = {
        id: "feed-created",
        authorUserId: currentUser.id,
        ...payload,
        isPinned: false,
        likedByCurrentUser: false,
        likeCount: 0,
        canEdit: true,
        canPin: true,
        comments: [],
        createdAt: "2026-09-04T09:00:00Z",
        updatedAt: "2026-09-04T09:00:00Z",
      };
      feedPosts = [created, ...feedPosts];
      return response(created);
    }
    const feedMatch = url.match(/\/feed\/posts\/([^/?]+)/);
    const feedPost = feedPosts.find((item) => item.id === feedMatch?.[1]);
    if (feedPost && url.endsWith(`/feed/posts/${feedPost.id}`) && (!options?.method || options.method === "GET")) return response(feedPost);
    if (feedPost && url.endsWith("/comments") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { body: string };
      const changed: FeedPost = {
        ...feedPost,
        comments: [...feedPost.comments, {
          id: "feed-comment-created",
          authorUserId: currentUser.id,
          body: payload.body,
          createdAt: "2026-09-04T09:05:00Z",
        }],
      };
      feedPosts = feedPosts.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (feedPost && url.endsWith("/like")) {
      const liked = options?.method === "PUT";
      const changed = {
        ...feedPost,
        likedByCurrentUser: liked,
        likeCount: feedPost.likeCount + (liked ? 1 : -1),
      };
      feedPosts = feedPosts.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (url.endsWith("/calendar/events") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as CalendarEventInput;
      const created: CalendarEvent = {
        id: "calendar-created",
        organizerUserId: currentUser.id,
        ...payload,
        status: "scheduled",
        attendees: payload.attendeeIds.map((userId) => ({
          userId,
          status: userId === currentUser.id ? "accepted" as const : "pending" as const,
          respondedAt: userId === currentUser.id ? "2026-09-04T09:00:00Z" : null,
        })),
        currentUserAttendanceStatus: "accepted",
        canRespond: false,
        canEdit: true,
        createdAt: "2026-09-04T09:00:00Z",
        updatedAt: "2026-09-04T09:00:00Z",
      };
      calendarEvents = [...calendarEvents, created];
      return response(created);
    }
    const calendarMatch = url.match(/\/calendar\/events\/([^/?]+)/);
    const calendarEvent = calendarEvents.find((item) => item.id === calendarMatch?.[1]);
    if (calendarEvent && url.endsWith("/cancel") && options?.method === "POST") {
      const changed: CalendarEvent = { ...calendarEvent, status: "cancelled" };
      calendarEvents = calendarEvents.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (url.includes("/attachments/") && options?.method === "PUT") {
      const ownerParts = url.split("/attachments/")[1]!.split("?")[0]!.split("/");
      const attachment: WorkspaceAttachment = {
        id: `attachment-${attachments.length + 1}`,
        ownerType: ownerParts[0] as WorkspaceAttachment["ownerType"],
        ownerId: ownerParts[1] ?? "",
        fileName: new URL(url).searchParams.get("fileName") ?? "file.bin",
        contentType: "text/plain",
        byteSize: 7,
        sha256: "a".repeat(64),
        uploadedByUserId: currentUser.id,
        documentRole: (new URL(url).searchParams.get("documentRole") ?? "general") as WorkspaceAttachment["documentRole"],
        createdAt: "2026-09-03T10:00:00Z",
      };
      attachments.push(attachment);
      return response(attachment);
    }
    if (url.endsWith("/tasks") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        title: string;
        description?: string;
        sourceMessageId?: string;
        parentTaskId?: string;
        calendarEventId?: string;
        assigneeId?: string;
        project?: string;
        dueAt?: string;
        priority?: WorkspaceTask["priority"];
        participants?: WorkspaceTask["participants"];
        checklist?: readonly { title: string }[];
        dependencies?: readonly { dependsOnTaskId: string; dependencyKind: "blocks" | "relates" }[];
        cycle?: {
          title: string;
          scheduleKind: "daily" | "weekly" | "monthly" | "calendar";
          interval: number;
          calendarRule?: "weekdays" | "month_days" | null;
          weekdays?: readonly number[];
          monthDays?: readonly number[];
          timezone?: string;
          nextRunAt?: string | null;
          isEnabled?: boolean;
        };
      };
      const parent = tasks.find((item) => item.id === payload.parentTaskId);
      const created: WorkspaceTask = {
        id: payload.parentTaskId ? `server-subtask-${tasks.length}` : "server-task",
        title: payload.title,
        description: payload.description ?? "",
        project: payload.project ?? "Без проекта",
        assigneeId: payload.assigneeId ?? people[0]!.id,
        dueLabel: payload.dueAt ? "20 сент., 14:00" : "Срок не указан",
        dueAt: payload.dueAt,
        status: "new",
        priority: payload.priority ?? "normal",
        checklistDone: 0,
        checklistTotal: payload.checklist?.length ?? 0,
        sourceMessageId: payload.sourceMessageId,
        parentTaskId: payload.parentTaskId,
        calendarEventId: payload.calendarEventId,
        parentTaskTitle: parent?.title,
        authorId: currentUser.id,
        participants: payload.participants ?? [],
        checklist: (payload.checklist ?? []).map((item, index) => ({
          id: `created-checklist-${index}`,
          title: item.title,
          isCompleted: false,
          sortOrder: index + 1,
          createdByUserId: currentUser.id,
          createdAt: "2026-09-09T09:00:00Z",
        })),
        comments: [],
        dependencies: (payload.dependencies ?? []).map((item) => {
          const dependency = tasks.find((task) => task.id === item.dependsOnTaskId);
          return {
            ...item,
            title: dependency?.title ?? "Задача",
            status: dependency?.status ?? "new",
          };
        }),
        cycle: payload.cycle ? {
          id: "created-cycle",
          ...payload.cycle,
          timezone: payload.cycle.timezone ?? "Asia/Tashkent",
          isEnabled: payload.cycle.isEnabled ?? true,
        } : null,
      };
      tasks = [created, ...tasks];
      return response(created);
    }
    const taskMatch = url.match(/\/tasks\/([^/?]+)/);
    const taskId = taskMatch?.[1];
    const currentTask = tasks.find((item) => item.id === taskId);
    const replaceTask = (changed: WorkspaceTask) => {
      tasks = tasks.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    };
    if (currentTask && url.endsWith("/status") && options?.method === "PATCH") {
      const payload = JSON.parse(String(options.body)) as { status: WorkspaceTask["status"] };
      return replaceTask({ ...currentTask, status: payload.status });
    }
    if (currentTask && url.endsWith("/submit-result") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { resultText: string };
      return replaceTask({ ...currentTask, status: "awaiting_review", resultText: payload.resultText });
    }
    if (currentTask && url.endsWith("/accept-result") && options?.method === "POST") {
      return replaceTask({ ...currentTask, status: "completed" });
    }
    if (currentTask && url.endsWith("/return-for-revision") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { reasonCode: string; reasonText: string };
      return replaceTask({
        ...currentTask,
        status: "in_progress",
        latestReturn: {
          reasonCode: payload.reasonCode,
          reasonText: payload.reasonText,
          actorUserId: currentUser.id,
          createdAt: "2026-09-08T12:00:00Z",
        },
      });
    }
    if (currentTask && options?.method === "PATCH" && /\/tasks\/[^/]+$/.test(url)) {
      const payload = JSON.parse(String(options.body)) as Partial<WorkspaceTask>;
      return replaceTask({
        ...currentTask,
        ...payload,
        dueLabel: payload.dueAt ? "20 сент., 14:00" : "Срок не указан",
      });
    }
    if (currentTask && options?.method === "DELETE" && /\/tasks\/[^/]+$/.test(url)) {
      tasks = tasks.filter((item) => item.id !== currentTask.id);
      return response(undefined);
    }
    if (currentTask && url.endsWith("/participants") && options?.method === "PUT") {
      const payload = JSON.parse(String(options.body)) as {
        userId: string;
        role: "co_assignee" | "observer";
      };
      return replaceTask({
        ...currentTask,
        participants: [
          ...currentTask.participants.filter((item) => item.userId !== payload.userId),
          payload,
        ],
      });
    }
    if (currentTask && url.includes("/participants/") && options?.method === "DELETE") {
      const userId = url.split("/participants/")[1]!;
      return replaceTask({
        ...currentTask,
        participants: currentTask.participants.filter((item) => item.userId !== userId),
      });
    }
    if (currentTask && url.endsWith("/checklist") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { title: string };
      const checklist = [
        ...currentTask.checklist,
        {
          id: `check-${currentTask.checklist.length + 1}`,
          title: payload.title,
          isCompleted: false,
          sortOrder: currentTask.checklist.length,
          createdByUserId: currentUser.id,
          createdAt: "2026-09-03T12:00:00Z",
        },
      ];
      return replaceTask({
        ...currentTask,
        checklist,
        checklistDone: checklist.filter((item) => item.isCompleted).length,
        checklistTotal: checklist.length,
      });
    }
    if (currentTask && url.includes("/checklist/") && options?.method === "PATCH") {
      const itemId = url.split("/checklist/")[1]!;
      const payload = JSON.parse(String(options.body)) as { isCompleted: boolean };
      const checklist = currentTask.checklist.map((item) =>
        item.id === itemId ? { ...item, isCompleted: payload.isCompleted } : item,
      );
      return replaceTask({
        ...currentTask,
        checklist,
        checklistDone: checklist.filter((item) => item.isCompleted).length,
      });
    }
    if (currentTask && url.includes("/checklist/") && options?.method === "DELETE") {
      const itemId = url.split("/checklist/")[1]!;
      const checklist = currentTask.checklist.filter((item) => item.id !== itemId);
      return replaceTask({
        ...currentTask,
        checklist,
        checklistDone: checklist.filter((item) => item.isCompleted).length,
        checklistTotal: checklist.length,
      });
    }
    if (currentTask && url.endsWith("/comments") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { body: string };
      return replaceTask({
        ...currentTask,
        comments: [
          ...currentTask.comments,
          {
            id: `comment-${currentTask.comments.length + 1}`,
            authorUserId: currentUser.id,
            body: payload.body,
            createdAt: "2026-09-03T12:00:00Z",
          },
        ],
      });
    }
    if (currentTask && url.endsWith("/dependencies") && options?.method === "PUT") {
      const payload = JSON.parse(String(options.body)) as {
        dependsOnTaskId: string;
        dependencyKind: "blocks" | "relates";
      };
      const dependencyTask = tasks.find((item) => item.id === payload.dependsOnTaskId)!;
      return replaceTask({
        ...currentTask,
        dependencies: [
          ...currentTask.dependencies,
          {
            ...payload,
            title: dependencyTask.title,
            status: dependencyTask.status,
          },
        ],
      });
    }
    if (currentTask && url.includes("/dependencies/") && options?.method === "DELETE") {
      const dependsOnTaskId = url.split("/dependencies/")[1]!;
      return replaceTask({
        ...currentTask,
        dependencies: currentTask.dependencies.filter(
          (item) => item.dependsOnTaskId !== dependsOnTaskId,
        ),
      });
    }
    if (currentTask && url.endsWith("/cycle") && options?.method === "PUT") {
      const payload = JSON.parse(String(options.body)) as NonNullable<WorkspaceTask["cycle"]>;
      return replaceTask({
        ...currentTask,
        cycle: { ...payload, id: "cycle-1", timezone: "Asia/Tashkent" },
      });
    }
    if (url.endsWith("/projects") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        code: string;
        title: string;
        description: string;
        managerUserId: string;
        budget: number;
        spentBudget: number;
        currency: WorkspaceProject["currency"];
      };
      const created: WorkspaceProject = {
        id: "project-created",
        ...payload,
        remainingBudget: payload.budget - payload.spentBudget,
        status: "new",
        stage: "start",
        createdByUserId: currentUser.id,
        createdAt: "2026-09-03T12:00:00Z",
        updatedAt: "2026-09-03T12:00:00Z",
        canEdit: true,
        canMove: true,
        history: [],
      };
      projects = [created, ...projects];
      return response(created);
    }
    const projectMatch = url.match(/\/projects\/([^/?]+)/);
    const project = projects.find((item) => item.id === projectMatch?.[1]);
    if (project && url.endsWith("/stage") && options?.method === "PATCH") {
      const payload = JSON.parse(String(options.body)) as { stage: WorkspaceProject["stage"] };
      const changed = { ...project, stage: payload.stage, status: "in_progress" as const };
      projects = projects.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (project && options?.method === "PATCH") {
      const payload = JSON.parse(String(options.body)) as Partial<WorkspaceProject>;
      const changed = { ...project, ...payload };
      projects = projects.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (url.endsWith("/trip-requests") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        purpose: string;
        destination: string;
        startDate: string;
        endDate: string;
        employeeIds: string[];
      };
      const created: TripRequest = {
        id: "trip-created",
        number: "TR-00000002",
        requesterUserId: currentUser.id,
        ...payload,
        workflowVersion: 3,
        briefText: "Тестовая билдирги",
        briefFormat: "generated",
        hasEmployeeSignature: true,
        stage: "launch",
        stageLabel: "Запуск",
        status: "draft",
        statusLabel: "Черновик",
        canEdit: true,
        allowedActions: ["submit"],
        actions: [],
        createdAt: "2026-09-03T12:00:00Z",
        updatedAt: "2026-09-03T12:00:00Z",
      };
      tripRequests = [created, ...tripRequests];
      return response(created);
    }
    const tripMatch = url.match(/\/trip-requests\/([^/?]+)/);
    const trip = tripRequests.find((item) => item.id === tripMatch?.[1]);
    if (trip && url.endsWith("/actions") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as { action: string };
      const changed: TripRequest = {
        ...trip,
        stage: payload.action === "submit" ? "deputy_approval" : trip.stage,
        stageLabel: payload.action === "submit" ? "Согласование первого заместителя" : trip.stageLabel,
        status: payload.action === "submit" ? "running" : trip.status,
        statusLabel: payload.action === "submit" ? "На согласовании" : trip.statusLabel,
        canEdit: false,
        allowedActions: ["approve", "return", "reject"],
      };
      tripRequests = tripRequests.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (trip && options?.method === "PATCH") {
      const payload = JSON.parse(String(options.body)) as Partial<TripRequest>;
      const changed = { ...trip, ...payload };
      tripRequests = tripRequests.map((item) => item.id === changed.id ? changed : item);
      return response(changed);
    }
    if (url.endsWith("/tasks/project-options")) {
      return response([{ id: "hub-routes", code: "MR", title: "Маршруты" }]);
    }
    if (url.endsWith("/task-proposals") && (!options?.method || options.method === "GET")) {
      return response([]);
    }
    if (url.endsWith("/task-plans") && (!options?.method || options.method === "GET")) {
      return response([]);
    }
    if (url.endsWith("/project-hub/payment-targets") || url.endsWith("/project-hub/calendar-targets")) {
      return response({ projects: [
        { id: "hub-project-1", code: "WS-26", title: "Workspace" },
        ...(serverOptions.withSubsidyRequest ? [{ id: "hub-subsidy", code: "SUB", title: "Субсидия" }] : []),
      ],
        workstreams: [
          { id: "hub-stream-1", projectId: "hub-project-1", title: "Проведение форума" },
          ...(serverOptions.withSubsidyRequest ? [{ id: "hub-subsidy-stream", projectId: "hub-subsidy", title: "Основное направление" }] : []),
        ],
        items: [{ id: "hub-item-1", projectId: "hub-project-1", workstreamId: "hub-stream-1", kind: "event", title: "Форум" }] });
    }
    if (url.endsWith("/approval-requests") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        title: string;
        amount: number;
        purpose: string;
        sourceTaskId?: string;
        calendarEventId?: string;
        responsibleUserId?: string;
      };
      const created = {
        id: "server-request",
        workflowId: workflow.id,
        number: "502",
        title: payload.title,
        amount: payload.amount,
        currency: "UZS",
        purpose: payload.purpose,
        status: "running" as const,
        statusLabel: "Ожидает решения",
        activeNodeKeys: ["manager"],
        activeStages: [{ key: "manager", label: "Согласование", kind: "approval", canAct: true }],
        stageLabel: "Согласование",
        requesterId: currentUser.id,
        responsibleUserId: payload.responsibleUserId ?? currentUser.id,
        sourceTaskId: payload.sourceTaskId,
        calendarEventId: payload.calendarEventId,
        details: { ...paymentDetails, ...payload },
        createdAt: "2026-09-03T10:00:00Z",
        updatedAt: "2026-09-03T10:00:00Z",
        revision: 1,
        versions: [],
        actions: [],
      };
      requests = [created, ...requests];
      return response(created);
    }
    if (url.includes("/approval-requests/") && options?.method === "PATCH") {
      const payload = JSON.parse(String(options.body)) as {
        title: string;
        amount: number;
        currency: string;
        purpose: string;
        changeComment?: string;
      };
      const current = requests[0]!;
      const revised = {
        ...current,
        ...payload,
        details: { ...current.details, ...payload },
        revision: current.revision + 1,
        versions: [
          ...current.versions,
          {
            version: current.revision + 1,
            title: payload.title,
            amount: payload.amount,
            currency: payload.currency,
            purpose: payload.purpose,
            details: { ...current.details, ...payload },
            attachmentIds: [],
            editedByUserId: currentUser.id,
            changeReason: payload.changeComment ?? "correction",
            createdAt: "2026-09-03T11:00:00Z",
          },
        ],
        actions: current.status === "running" ? [
          ...current.actions,
          { action: "edit", comment: payload.changeComment, actorUserId: currentUser.id,
            nodeKey: current.activeNodeKeys[0] ?? "start", createdAt: "2026-09-03T11:00:00Z" },
        ] : current.actions,
      };
      requests = [revised];
      return response(revised);
    }
    if (url.includes("/approval-requests/") && url.endsWith("/actions")) {
      if (failApprovalActionOnce) {
        failApprovalActionOnce = false;
        return { ok: false, status: 409, json: async () => ({ detail: "Этап уже изменён" }) } as Response;
      }
      const payload = JSON.parse(String(options?.body)) as { action: string; comment?: string };
      const current = requests[0]!;
      const changed = {
        ...current,
        status: payload.action === "resubmit"
          ? "running" as const
          : payload.action === "approve"
            ? "approved" as const
            : current.status,
        statusLabel: payload.action === "resubmit"
          ? "Ожидает решения"
          : payload.action === "approve"
            ? "Согласовано"
            : current.statusLabel,
        activeNodeKeys: payload.action === "approve" ? [] : current.activeNodeKeys,
        activeStages: payload.action === "approve" ? [] : current.activeStages,
        stageLabel: payload.action === "approve" ? "Согласовано" : current.stageLabel,
        actions: [
          ...current.actions,
          {
            action: payload.action,
            comment: payload.comment,
            actorUserId: currentUser.id,
            nodeKey: current.activeNodeKeys[0] ?? "manager",
            createdAt: "2026-09-03T12:00:00Z",
          },
        ],
      };
      requests = [changed];
      return response(changed);
    }
    return response({});
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "WebSocket",
    class {
      addEventListener() {}
      send() {}
      close() {}
    },
  );
  return fetchMock;
}

function clickWithFocus(control: HTMLElement) {
  // A pointer click focuses a button before invoking its handler. fireEvent alone
  // omits that step, which leaves Fluent's modal restoration target on the body.
  act(() => control.focus());
  fireEvent.click(control);
}

async function loginToWorkspace(username = "aziza", targetSection: "home" | "messenger" | "payment_requests" | "projects" = "messenger") {
  await screen.findByRole("button", { name: "Войти" });
  changeField(screen.getByLabelText(/^Логин/), {
    target: { value: username },
  });
  changeField(screen.getByLabelText(/^Пароль/), {
    target: { value: "Yuksalish-Local-2026!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Войти" }));
  await screen.findByText("Сервер подключён");
  await screen.findByRole("heading", { name: /Добрый день/ });
  if (targetSection === "home") return;
  if (targetSection === "projects") {
    // The greeting precedes Home resource readiness; interact only once the card is exposed.
    fireEvent.click(await screen.findByRole("button", { name: /Yuksalish Workspace.*Ближайший срок/ }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Закрыть карточку проекта" }, { timeout: 10_000 }));
    return;
  }
  fireEvent.click(screen.getByRole("button", { name: targetSection === "messenger" ? /^Мессенджер/ : /^Заявки на оплату/ }));
  if (targetSection === "messenger") await screen.findByRole("textbox", { name: "Новое сообщение" });
  else await screen.findByRole("button", { name: "Новая заявка" });
}

async function selectPaymentDirection() {
  fireEvent.click(screen.getByLabelText("проект"));
  fireEvent.click(await screen.findByRole("option", { name: "WS-26 · Workspace" }));
  fireEvent.click(screen.getByLabelText("направление"));
  fireEvent.click(await screen.findByRole("option", { name: "Проведение форума" }));
}

describe("corporate workspace authentication alpha", () => {
  it("keeps the floating messenger and draft across pages and its full-section handoff", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");
    fireEvent.click(screen.getByRole("button", { name: "Открыть мини-мессенджер" }));
    const mini = await screen.findByRole("dialog", { name: "Мини-мессенджер" });
    fireEvent.click(within(mini).getByRole("button", { name: /^Финансы и закупки/ }));
    const editor = await within(mini).findByRole("textbox", { name: "Новое сообщение" });
    changeField(editor, { target: { value: "Общий черновик" } });
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /^Задачи/ }));
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveTextContent("Общий черновик");
    fireEvent.click(screen.getByRole("button", { name: "Открыть полный мессенджер" }));
    await screen.findByRole("region", { name: "Раздел мессенджера" });
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(editor);
    expect(screen.queryByRole("button", { name: "Открыть мини-мессенджер" })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("navigation")).getByRole("button", { name: /^Задачи/ }));
    await screen.findByRole("button", { name: "Открыть мини-мессенджер" });
    fireEvent.click(screen.getByRole("button", { name: "Открыть мини-мессенджер" }));
    await screen.findByRole("dialog", { name: "Мини-мессенджер" });
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(editor);
  });
  it("uses the real mobile web menu without losing the current section", async () => {
    const server = mockServer();
    const original = server.getMockImplementation()!;
    server.mockImplementation((input, options) => original(String(input).replace("/auth/web/", "/auth/"), options));
    vi.stubGlobal("yuksalish", undefined);
    const mobileMedia = Object.assign(new EventTarget(), { matches: true, media: "mobile-browser", addListener: vi.fn(), removeListener: vi.fn() });
    vi.stubGlobal("matchMedia", vi.fn((query: string) => query.includes("max-width: 1023px") ? mobileMedia : { matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn() }));
    render(<App />);
    await loginToWorkspace("aziza", "home");
    const trigger = screen.getByRole("button", { name: "Открыть меню" });
    expect(document.querySelector(".app-shell")).toHaveClass("browser-compact");
    expect(screen.queryByRole("complementary", { name: "Основная навигация" })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    const menu = screen.getByRole("dialog", { name: "Меню разделов" });
    fireEvent.click(within(menu).getByRole("button", { name: "Мессенджер" }));
    await screen.findByRole("textbox", { name: "Новое сообщение" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Меню разделов" })).not.toBeInTheDocument());
    const draft = screen.getByRole("textbox", { name: "Новое сообщение" });
    changeField(draft, { target: { value: "Мобильный черновик" } });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть меню" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Меню разделов" })).not.toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Новое сообщение" })).toBe(draft);
    expect(draft).toHaveTextValue("Мобильный черновик");
    act(() => { mobileMedia.matches = false; mobileMedia.dispatchEvent(new Event("change")); });
    fireEvent.click(screen.getByRole("button", { name: "Свернуть меню" }));
    expect(document.querySelector(".app-shell")).toHaveClass("rail-collapsed");
    act(() => { mobileMedia.matches = true; mobileMedia.dispatchEvent(new Event("change")); });
    expect(document.querySelector(".app-shell")).not.toHaveClass("rail-collapsed");
    act(() => { mobileMedia.matches = false; mobileMedia.dispatchEvent(new Event("change")); });
    expect(document.querySelector(".app-shell")).toHaveClass("rail-collapsed");
    expect(draft).toHaveTextValue("Мобильный черновик");
  });
  it("opens survey analytics only on demand and retains its draft across section changes", async () => {
    const survey: SurveyAnalysisDetail = {
      analysis: { id: "survey-test", title: "Сохранённый опрос", fileName: "sample.csv", revision: 1,
        archived: false, createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z",
        configuration: { sheet: 0, headerRow: 0, types: {}, separator: ";", missingValues: [], query: "", filters: [], savedViews: [] } },
      workbook: { warnings: [], sheets: [{ name: "Ответы", rows: [["Вопрос"], ["Ответ"]] }] },
    };
    const server = mockServer();
    const original = server.getMockImplementation()!;
    server.mockImplementation(async (input, options) => {
      const url = String(input);
      if (url.endsWith("/survey-analyses")) return response([survey.analysis]);
      if (url.endsWith("/survey-analyses/survey-test")) return response(survey);
      return original(input, options);
    });
    render(<App />);
    await loginToWorkspace("aziza", "home");
    expect(server.mock.calls.some(([input]) => String(input).includes("/survey-analyses"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Аналитика опросов" }));
    await screen.findByRole("heading", { name: "Аналитика опросов" });
    fireEvent.click(await screen.findByRole("button", { name: /Сохранённый опрос/ }));
    const title = await screen.findByRole("textbox", { name: "Название анализа" });
    changeField(title, { target: { value: "Несохранённый черновик" } });
    fireEvent.click(screen.getByRole("button", { name: "Главная" }));
    await screen.findByLabelText("Персональная Главная");
    expect(title).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Аналитика опросов" }));
    expect(screen.getByRole("textbox", { name: "Название анализа" })).toBe(title);
    expect(title).toHaveTextValue("Несохранённый черновик");
    expect(server.mock.calls.filter(([input]) => String(input).endsWith("/survey-analyses/survey-test"))).toHaveLength(1);
  });
  it("starts on personal Home after login, ignoring the previous web or desktop section", async () => {
    sessionStorage.setItem("yuksalish:web:last-section", "messenger");
    for (const person of people) localStorage.setItem(`yuksalish:resume-section:${person.id}`, "calendar");
    mockServer(); render(<App />);
    await loginToWorkspace("aziza", "home");
    expect(screen.getByLabelText("Персональная Главная")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Новое сообщение" })).not.toBeInTheDocument();
  });
  afterEach(() => {
    cleanup();
    // All providers are unmounted before disposing focus state and only the
    // styles owned by this test's renderer. Nothing is reset inside a scenario.
    const tabster = getTabster(window);
    if (tabster) disposeTabster(tabster, true);
    document.head.querySelectorAll("style[data-app-test-renderer]").forEach(style => style.remove());
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("requires a password before opening the workspace", () => {
    mockServer();
    render(<App />);

    expect(screen.getByRole("heading", { name: "Добро пожаловать" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сообщения" })).not.toBeInTheDocument();
  });

  it("stores a protected refresh session after a successful password login", async () => {
    const saveSession = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("yuksalish", {
      loadSession: vi.fn().mockResolvedValue(null),
      saveSession,
      clearSession: vi.fn().mockResolvedValue(undefined),
      onNotificationOpen: vi.fn(() => () => undefined),
    });
    mockServer();
    render(<App />);

    await screen.findByRole("button", { name: "Войти" });
    await loginToWorkspace();
    await waitFor(() => expect(saveSession).toHaveBeenCalledWith("refresh-token"));
  });

  it("restores a saved session without asking the employee for a password", async () => {
    const loadSession = vi.fn().mockResolvedValue("stored-refresh-token");
    const saveSession = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("yuksalish", {
      version: "0.30.2",
      loadSession,
      saveSession,
      clearSession: vi.fn().mockResolvedValue(undefined),
      onNotificationOpen: vi.fn(() => () => undefined),
    });
    const fetchMock = mockServer();
    render(<App />);

    await screen.findByText("Сервер подключён");
    await screen.findByRole("heading", { name: /Добрый день/ });
    expect(screen.queryByRole("heading", { name: "Добро пожаловать" })).not.toBeInTheDocument();
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/refresh"),
      expect.objectContaining({ body: JSON.stringify({ refreshToken: "stored-refresh-token" }) }),
    );
    expect(saveSession).toHaveBeenCalledWith("rotated-refresh-token");
  });

  it("logs in and sends a server-backed message", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    const composer = screen.getByRole("textbox", { name: "Новое сообщение" });
    changeField(composer, { target: { value: "Заявку подготовила" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(await screen.findByText("Заявку подготовила")).toBeInTheDocument();
  });

  it("keeps an acknowledged send visible when an older background response arrives later", async () => {
    const fetchMock = mockServer();
    const server = fetchMock.getMockImplementation()!;
    render(<App />);
    await loginToWorkspace();
    let releaseOld!: (response: Response) => void;
    let releaseFresh!: (response: Response) => void;
    let stale: Response | undefined;
    let fresh: Response | undefined;
    let requests = 0;
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith("/workspace/bootstrap")) {
        const captured = await server(input, options);
        requests++;
        if (requests === 1) { stale = captured; return new Promise<Response>((done) => { releaseOld = done; }); }
        if (requests === 2) { fresh = captured; return new Promise<Response>((done) => { releaseFresh = done; }); }
        return captured;
      }
      return server(input, options);
    });
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(stale).toBeDefined());
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Не пропадаю после подтверждения" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    await waitFor(() => expect(document.querySelector('[data-message-id="server-message"]')).toHaveTextContent("Не пропадаю после подтверждения"));
    await act(async () => releaseOld(stale!));
    await waitFor(() => expect(fresh).toBeDefined());
    expect(document.querySelector('[data-message-id="server-message"]')).toHaveTextContent("Не пропадаю после подтверждения");
    await act(async () => releaseFresh(fresh!));
    expect(document.querySelectorAll('[data-message-id="server-message"]')).toHaveLength(1);
    expect(document.querySelector('[data-message-id="server-message"]')).toHaveTextContent("Не пропадаю после подтверждения");
  });

  it.each(["online", "focus"])("refreshes incoming messages after %s without a websocket event", async (eventName) => {
    const fetchMock = mockServer();
    const server = fetchMock.getMockImplementation()!;
    render(<App />);
    await loginToWorkspace();
    fetchMock.mockImplementation(async (input, options) => {
      const result = await server(input, options);
      if (!String(input).endsWith("/workspace/bootstrap")) return result;
      const snapshot = await result.json();
      return response({ ...snapshot, messages: [...snapshot.messages, {
        id: "recovered-incoming", chatId: initialChats[0]!.id, authorId: "dilshod", body: "Догрузилось без перезахода", time: "12:01",
      }] });
    });
    fireEvent(window, new Event(eventName));
    expect(await screen.findByText("Догрузилось без перезахода")).toBeInTheDocument();
  });

  it("keeps branding in the rail and a live status without a duplicate header logo", async () => {
    const fetchMock = mockServer();
    const server = fetchMock.getMockImplementation()!;
    render(<App />);
    await loginToWorkspace();
    expect(screen.getAllByRole("img", { name: "Yuksalish" })).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Yuksalish" })).toHaveClass("rail-brand");
    expect(document.querySelector(".global-bar img")).toBeNull();
    expect(screen.getByRole("button", { name: "Подключение: Сервер подключён" })).not.toHaveClass("has-error");

    fetchMock.mockImplementation((input, options) => {
      if (String(input).includes("/messages") && options?.method === "POST") return Promise.reject(new Error("Test connection failure"));
      return server(input, options);
    });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Не отправлено" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    const failedStatus = await screen.findByText("Не удалось выполнить операцию");
    expect(failedStatus.closest("button")).toHaveClass("connection-indicator", "has-error");
    expect(failedStatus).not.toHaveClass("online");
    expect(screen.queryByText("Сервер подключён")).not.toBeInTheDocument();
  });

  it("keeps actual section counters on the buttons inside More", async () => {
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("adaptive-rail-nav") ? 45 : 0;
    });
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");
    fireEvent.click(screen.getByRole("button", { name: /Ещё, \d+ разделов/ }));
    const drawer = screen.getByRole("complementary", { name: "Другие разделы" });
    expect(drawer.querySelector("header")).toHaveTextContent(/^Другие разделы$/);
    expect(within(drawer).queryByRole("button", { name: "Уведомления" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Уведомления" })).toHaveAttribute("aria-description", "Уведомления: непрочитанных 2");
    expect(within(drawer).getByRole("button", { name: "Задачи" }).querySelector(".rail-badge")).toHaveTextContent(String(initialTasks.filter(task => !["completed", "cancelled"].includes(task.status)).length));
    expect(within(drawer).getByRole("button", { name: "Календарь" }).querySelector(".rail-badge")).toBeNull();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(await screen.findByRole("heading", { name: "Требует моего внимания" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ещё, \d+ разделов/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the unread queue, marks an item read and follows its deep link", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(screen.getByRole("heading", { name: "Требует моего внимания" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Новые уведомления/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Уведомления" })).toHaveAttribute("aria-description", "Уведомления: непрочитанных 2");
    expect(document.querySelector(".notification-bell-dot")).not.toBeNull();
    expect(screen.getByText("1", { selector: ".notification-metrics strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Задача требует внимания").closest("button")!);
    expect(await screen.findByRole("heading", { name: initialTasks[0]!.title })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/notification-task/read"),
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(document.querySelector(".tasks-view")).not.toBeNull(), { timeout: 5000 });
    const taskDialogClose = document.querySelector<HTMLButtonElement>(".task-detail-close");
    expect(taskDialogClose).not.toBeNull();
    fireEvent.click(taskDialogClose!);
    await waitFor(() => expect(document.querySelector(".task-record-dialog")).toBeNull());
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 5000 }));
    expect(await screen.findByRole("heading", { name: initialTasks[1]!.title }, { timeout: 6000 })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/read-all"),
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("updates the read percentage after confirmation without resolving actions", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/read-all"),
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByRole("progressbar", { name: "Доля прочитанных уведомлений" })).toHaveAttribute("aria-valuenow", "100"));
    expect(screen.getByRole("button", { name: /Нужно решить/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "Прочитать все" })).toBeDisabled();
  });

  it("filters the notification queue by its source without losing history", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: /Вся история/ }));
    expect(screen.getByText("Задача требует внимания")).toBeInTheDocument();
    expect(screen.getByText("Новое сообщение · Финансы и закупки")).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("group", { name: "Фильтр по разделу" }))
      .getByRole("button", { name: "Мессенджер" }));
    expect(screen.queryByText("Задача требует внимания")).not.toBeInTheDocument();
    expect(screen.getByText("Новое сообщение · Финансы и закупки")).toBeInTheDocument();
  });

  it("allows closing and reopening a request reached through a notification", async () => {
    mockServer({
      withReturnedRequest: true,
      extraNotifications: [{
        id: "notification-approval",
        kind: "approval",
        priority: "attention",
        title: "Исправить заявку",
        body: "Вернувшаяся заявка",
        section: "payment_requests",
        entityId: "returned-request",
        requiresAction: true,
        isReminder: false,
        occurredAt: "2026-09-04T09:30:00Z",
      }],
    });
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByText("Исправить заявку").closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Вернувшаяся заявка" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку заявки" }));
    expect(screen.queryByRole("dialog", { name: "Вернувшаяся заявка" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(await screen.findByRole("button", { name: /Новые уведомления/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Исправить заявку")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Нужно решить/ }));
    fireEvent.click(screen.getByText("Исправить заявку").closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Вернувшаяся заявка" })).toBeInTheDocument();
  });

  it("uploads a real attachment with a new message", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    const file = new File(["invoice"], "invoice.txt", { type: "text/plain" });
    changeField(screen.getByLabelText("Файлы сообщения"), {
      target: { files: [file] },
    });
    changeField(screen.getByRole("textbox", { name: "Новое сообщение" }), {
      target: { value: "Счёт приложен" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/attachments/message/server-message"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(await screen.findByText("invoice.txt")).toBeInTheDocument();
  });

  it("creates a linked task directly from a message", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.contextMenu(document.querySelector(".message")!);
    fireEvent.click(screen.getByRole("button", { name: "В задачу" }));
    expect(screen.getByRole("dialog", { name: "Новая задача" })).toBeInTheDocument();
    changeField(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить счёт из переписки" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить задачу" }));

    expect(await screen.findByText("Создана из сообщения · связь сохранена")).toBeInTheDocument();
    const closeNotice = screen.queryByRole("button", { name: "Закрыть уведомление" });
    if (closeNotice) fireEvent.click(closeNotice);
    await waitFor(
      () => {
        expect(screen.queryByText("Создана из сообщения · связь сохранена")).not.toBeInTheDocument();
      },
      { timeout: 5_000 },
    );
    expect(screen.queryByRole("dialog", { name: "Новая задача" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Проверить счёт из переписки").length).toBeGreaterThan(0);
  });

  it("creates a task after authentication", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", { name: "Новая задача" }));
    changeField(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить новый маршрут оплаты" },
    });
    changeField(screen.getByRole("textbox", { name: "Описание новой задачи" }), {
      target: { value: "Сверить роли и вернуть проверяемый результат" },
    });
    const projectSelect = await screen.findByRole("combobox", { name: "Проект новой задачи" });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
      String(url).includes("/tasks/project-options"))).toBe(true));
    await waitFor(() => expect(projectSelect).not.toBeDisabled());
    fireEvent.click(projectSelect);
    fireEvent.click(await screen.findByRole("option", { name: "MR · Маршруты" }));
    changeField(screen.getByRole("combobox", { name: "Приоритет новой задачи" }), {
      target: { value: "high" },
    });
    const plan = screen.getByText("План выполнения").closest("details")!;
    expect(plan).not.toHaveAttribute("open");
    fireEvent.click(plan.querySelector("summary")!);
    expect(plan).toHaveAttribute("open");
    changeField(screen.getByRole("textbox", { name: "Новый пункт чек-листа при создании" }), {
      target: { value: "Проверить роли" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить пункт" }));
    fireEvent.click(plan.querySelector("summary")!);
    expect(plan).not.toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Добавить задачу" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tasks"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"priority":"high"'),
      }),
    ));
    const taskCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/tasks") && (options as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse(String((taskCall?.[1] as RequestInit | undefined)?.body))).toMatchObject({
      title: "Проверить новый маршрут оплаты",
      description: "Сверить роли и вернуть проверяемый результат",
      project: "Маршруты",
      projectId: "hub-routes",
      priority: "high",
      checklist: [{ title: "Проверить роли" }],
    });
    await waitFor(() =>
      expect(screen.getAllByText("Проверить новый маршрут оплаты").length).toBeGreaterThan(0),
    );
  });

  it("does not create a task until the detailed composer is confirmed", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая задача" }));
    changeField(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Черновик без подтверждения" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(screen.queryByRole("dialog", { name: "Новая задача" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, options]) =>
      String(url).endsWith("/tasks") && (options as RequestInit | undefined)?.method === "POST",
    )).toBe(false);
  });

  it("filters tasks by text in both list and Kanban without modifying records", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    changeField(await screen.findByRole("textbox", { name: "Поиск задач" }), { target: { value: "__no_task_matches__" } });
    expect(document.querySelectorAll(".task-row")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(document.querySelectorAll(".kanban-card")).toHaveLength(0);
    changeField(screen.getByRole("textbox", { name: "Поиск задач" }), { target: { value: "" } });
    expect(document.querySelectorAll(".kanban-card").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Просроченные" }));
    const cards = [...document.querySelectorAll(".kanban-card")];
    const overdueTasks = initialTasks.filter(task => !["completed", "cancelled"].includes(task.status)
      && (task.status === "overdue" || Boolean(task.dueAt && Date.parse(task.dueAt) < Date.now())));
    expect(cards.length).toBe(overdueTasks.length);
    expect(cards.every((card) => card.closest('[data-task-status="overdue"]'))).toBe(true);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });

  it("keeps the same task navigation header mounted across all four views", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    const navigation = await screen.findByRole("group", { name: "Представление задач" });
    const header = navigation.closest(".section-toolbar");
    expect(header).not.toBeNull();
    for (const name of ["Kanban", "Календарь", "Эффективность", "Список"]) {
      fireEvent.click(within(navigation).getByRole("button", { name }));
      expect(screen.getByRole("group", { name: "Представление задач" })).toBe(navigation);
      expect(navigation.closest(".section-toolbar")).toBe(header);
      expect(within(header as HTMLElement).getByRole("button", { name: "Новая задача" })).toBeInTheDocument();
    }
  });

  it("shows filtered tasks in the calendar with their automatic chat beside the details", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    await waitFor(() => expect(document.querySelector(".view-switch")).not.toBeNull());
    fireEvent.click(within(document.querySelector(".view-switch")!).getByRole("button", { name: "Календарь" }));
    expect(screen.queryByText("Рабочий календарь")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Календарь задач" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Предыдущий месяц задач" }).closest(".task-calendar-navigation-slot")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Сегодня" }).closest(".section-toolbar")).not.toBeNull();
    expect(document.querySelector(".tasks-view.calendar-mode > .tasks-main > .section-toolbar .view-switch")).not.toBeNull();
    expect(document.querySelector(".task-calendar-embedded .view-switch")).toBeNull();
    expect(screen.getByRole("grid", { name: /Календарь задач:/ })).toBeInTheDocument();
    const taskMonth = new Date(initialTasks[0]!.dueAt!);
    const today = new Date();
    const monthOffset = (taskMonth.getFullYear() - today.getFullYear()) * 12
      + taskMonth.getMonth() - today.getMonth();
    const monthButton = screen.getByRole("button", {
      name: monthOffset < 0 ? "Предыдущий месяц задач" : "Следующий месяц задач",
    });
    for (let index = 0; index < Math.abs(monthOffset); index += 1) fireEvent.click(monthButton);
    expect(document.querySelectorAll(".task-calendar-item")).toHaveLength(initialTasks.length);

    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[0]!.title}`,
    }));
    await waitFor(() => {
      expect(screen.getAllByText("Задача · Договор на поставку ноутбуков").length)
        .toBeGreaterThan(0);
    });
    expect(screen.queryByRole("button", { name: "Открыть чат задачи" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Задачи" })).toHaveAttribute("aria-current", "page");
  });

  it("opens the standalone team overview for an authorized position and hides it from an employee", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika");
    fireEvent.click(screen.getByRole("button", { name: "Обзор команды" }));

    expect(await screen.findByRole("heading", { name: "Добрый день, Малика" })).toBeInTheDocument();
    expect(screen.getByText(/не норму и не оценку сотрудника/i)).toBeInTheDocument();

    cleanup();
    mockServer();
    render(<App />);
    await loginToWorkspace("baxtiyor");
    expect(screen.queryByRole("button", { name: "Обзор команды" })).not.toBeInTheDocument();
  });

  it("opens the chairman's team overview as Home with the allowed personal panels", async () => {
    mockServer({ chairmanLogin: true, withSubsidyRequest: true });
    render(<App />);
    await loginToWorkspace("malika", "home");

    expect(screen.getByRole("button", { name: "Обзор команды" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Главная" })).not.toBeInTheDocument();
    expect(screen.getByText("Ваше рабочее пространство")).toBeInTheDocument();
    for (const heading of ["Мой фокус", "Важные уведомления", "Мини-мессенджер", "Ближайшие встречи", "Мои письма", "События из ленты"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }
    for (const heading of ["Моя эффективность", "Мой отдел", "Награды и достижения", "Отклик на мои сообщения"]) {
      expect(screen.queryByRole("heading", { name: heading })).not.toBeInTheDocument();
    }
    const paymentCard = within(screen.getByRole("region", { name: "Ключевые показатели команды" })).getByText("Заявки на оплату").closest("button")!;
    expect(paymentCard).toHaveTextContent("1");
    fireEvent.click(paymentCard);
    fireEvent.click(within(screen.getByRole("region", { name: "Заявки на оплату, ожидающие решения" })).getByRole("button", { name: /Оплата по субсидии/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Заявки на оплату" })).toHaveAttribute("aria-current", "page"));
  });

  it("opens the chairman's signature letter from the sixth team metric", async () => {
    mockServer({ chairmanLogin: true });
    render(<App />);
    await loginToWorkspace("malika", "home");
    const metrics = screen.getByRole("region", { name: "Ключевые показатели команды" });
    const signatures = within(metrics).getByRole("button", { name: /Письма на подпись/ });
    await waitFor(() => expect(signatures).toHaveTextContent("1"));
    expect(within(metrics).getAllByRole("button")).toHaveLength(6);
    fireEvent.click(signatures);
    fireEvent.click(within(screen.getByRole("region", { name: "Письма, ожидающие вашей подписи" })).getByRole("button", { name: /Письмо из обзора команды/ }));
    expect(await screen.findByRole("dialog", { name: /Письмо из обзора команды/ })).toBeInTheDocument();
  });

  it("finds employees without changing their roles or selected record", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika");
    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    const search = await screen.findByRole("textbox", { name: "Поиск сотрудников" });
    await waitFor(() => expect(document.querySelectorAll(".employee-row").length).toBeGreaterThan(0));
    const selectedName = document.querySelector(".directory-heading h2")?.textContent;
    changeField(search, { target: { value: "__no_employee_matches__" } });
    expect(await screen.findByText("Сотрудники не найдены")).toBeInTheDocument();
    expect(document.querySelectorAll(".employee-row")).toHaveLength(0);
    expect(document.querySelector(".directory-heading h2")?.textContent).toBe(selectedName);
    changeField(search, { target: { value: "" } });
    await waitFor(() => expect(document.querySelectorAll(".employee-row").length).toBeGreaterThan(0));
  });

  it("opens the existing invitation form directly from the employee list", async () => {
    mockServer(); render(<App />); await loginToWorkspace("malika");
    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    fireEvent.click(await screen.findByRole("button", { name: "Пригласить сотрудника" }, { timeout: 5000 }));
    expect(await screen.findByRole("dialog", { name: "Приглашение сотрудника" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Имя сотрудника" })).toBeInTheDocument();
    expect(screen.queryByText("Активные устройства")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Создать приглашение" })).toBeDisabled();
  });

  it("opens the Kanban board and manages a full task card", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    const board = screen.getByLabelText("Kanban задач: горизонтальная прокрутка");
    expect(board).toBeInTheDocument();
    expect(board.querySelectorAll(".kanban-column")).toHaveLength(5);
    expect(screen.getByLabelText("Новые: задачи")).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByText("Новые").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();
    expect(screen.queryByRole("button", { name: "К списку задач" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
    changeField(screen.getByRole("textbox", { name: "Название в карточке" }), {
      target: { value: "Полная карточка BP-5" },
    });
    changeField(screen.getByRole("textbox", { name: "Описание задачи" }), {
      target: { value: "Описание, участники и контроль исполнения" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить карточку" }));
    expect(await screen.findByRole("heading", { name: "Полная карточка BP-5" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
    changeField(screen.getByLabelText("Новый участник"), {
      target: { value: people[0]!.id },
    });
    changeField(screen.getByLabelText("Роль участника"), {
      target: { value: "observer" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Добавить" })[0]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/participants"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    changeField(screen.getByLabelText("Новый пункт чек-листа"), {
      target: { value: "Проверить результат" },
    });
    const checklistForm = screen.getByLabelText("Новый пункт чек-листа").closest(".inline-task-form")!;
    fireEvent.click(checklistForm.querySelector("button")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/checklist"), expect.objectContaining({ method: "POST" })));
    const checklistItem = await screen.findByRole("checkbox", { name: "Проверить результат" });
    fireEvent.click(checklistItem);
    await waitFor(() => expect(screen.getByText("1/1")).toBeInTheDocument());

    changeField(screen.getByLabelText("Зависимая задача"), {
      target: { value: initialTasks[1]!.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Связать" }));
    expect((await screen.findAllByText(initialTasks[1]!.title)).length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Добавить цикл" }));
    changeField(screen.getByLabelText("Период повторения"), {
      target: { value: "calendar" },
    });
    expect(screen.getByRole("checkbox", { name: "Пн" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ср" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить цикл" }));
    expect(await screen.findByText(/По дням недели: пн, ср/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/cycle"),
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"weekdays":[0,2]'),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
    expect(await screen.findByText(/Отключено · По дням недели: пн, ср/)).toBeInTheDocument();

    changeField(screen.getByRole("textbox", { name: "Новый комментарий" }), {
      target: { value: "Карточка готова к проверке" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Карточка готова к проверке")).toBeInTheDocument();
  }, 30_000);

  it("lets an administrator delete an active task after confirmation", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Удалить задачу" }));
    const confirmation = await screen.findByRole("dialog", { name: "Удалить задачу?" });
    fireEvent.click(within(confirmation).getByText("Удалить").closest("button")!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/tasks\/[^/]+$/),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
  });

  it("explains task sections and uploads files from the task dropzone", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    // This test also runs alone, before the lazy Tasks module is warm.
    fireEvent.click((await screen.findAllByRole("button", { name: /^Открыть задачу:/ }, { timeout: 10_000 }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Справка: Чек-лист" }));
    expect(await screen.findByText(/Отмечайте выполненные пункты по мере работы/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/Отмечайте выполненные пункты по мере работы/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть задачу" })).toBeInTheDocument();
    expect(screen.getByText("Перетащите файлы сюда")).toBeInTheDocument();

    fireEvent.drop(screen.getByText("Перетащите файлы сюда").closest(".ws-file-dropzone")!, {
      dataTransfer: { files: [new File(["report"], "report.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/attachments/task/"),
      expect.objectContaining({ method: "PUT" }),
    ));
    expect(await screen.findByText("report.txt")).toBeInTheDocument();
  }, 30_000);

  it("creates a subtask from the task card", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить подзадачу" }));
    changeField(screen.getByRole("textbox", { name: "Название подзадачи" }), {
      target: { value: "Сверить итоговые цифры" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать подзадачу" }));
    expect((await screen.findAllByText("Сверить итоговые цифры")).length).toBeGreaterThan(0);
  });

  it("runs result review with a motivated return", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 10_000 }));
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();
    expect(screen.getByText("Ожидает решения")).toBeInTheDocument();
    expect(screen.getByText("Результат отправлен. Ожидает решения постановщика.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Вернуть на доработку" }));
    changeField(screen.getByRole("textbox", { name: "Пояснение причины" }), {
      target: { value: "Добавьте номер договора" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителям" }));
    await waitFor(() => expect(screen.getByText("Добавьте номер договора", { selector: "p" })).toBeInTheDocument());
    expect(screen.getByText("Нужны исправления")).toBeInTheDocument();

    changeField(await screen.findByRole("textbox", { name: "Результат задачи" }), {
      target: { value: "Номер договора добавлен" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Завершить и отправить на проверку" }));
    await waitFor(() => expect(screen.getByText("Ожидает решения")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Утвердить результат" })).not.toBeInTheDocument();

    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    render(<App />);
    await loginToWorkspace("baxtiyor");
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Утвердить результат" }, { timeout: 20_000 }));
    expect(await screen.findByText("Принято")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/accept-result"),
      expect.objectContaining({ method: "POST" }),
    );
  }, 60_000);

  it("does not offer result acceptance to a manager who is not the task author", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 10_000 }));
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();

    expect(screen.getByRole("button", { name: "Вернуть на доработку" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Утвердить результат" })).not.toBeInTheDocument();
  });

  it("shows the executor's result actions without the former payment shortcut", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("dilshod");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[0]!.title}`,
    }, { timeout: 10_000 }));
    // DOM tests have no layout for Tabster's automatic focus search. Establish
    // focus inside the modal, as the browser does, before its delayed ARIA update.
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();
    expect(screen.queryByRole("button", { name: "Создать заявку на оплату" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить и отправить на проверку" })).toBeDisabled();
    changeField(screen.getByLabelText("Файлы результата"), {
      target: { files: [new File(["report"], "result.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/attachments/task/"),
      expect.objectContaining({ method: "PUT" }),
    ));
    // The request is recorded before the uploaded file and dialog finish rendering.
    expect(await screen.findByText("result.txt", {}, { timeout: 10_000 })).toBeInTheDocument();
    const resultInput = await screen.findByRole("textbox", { name: "Результат задачи" }, { timeout: 10_000 });
    expect(resultInput).toBeVisible();
    expect(resultInput.closest('[aria-hidden="true"]')).toBeNull();
    expect(resultInput).toHaveAccessibleName("Результат задачи");
    changeField(resultInput, {
      target: { value: "Работа завершена, файл приложен" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Завершить и отправить на проверку" })).toBeEnabled(), { timeout: 10_000 });
  }, 30_000);

  it("submits the complete payment card and publishes a workflow version", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika", "payment_requests");
    expect(screen.getByRole("navigation").closest(".app-shell")).not.toHaveClass("approval-shell");
    expect(await screen.findByLabelText("Сводка заявок")).toHaveTextContent("В работе");
    expect(screen.queryByLabelText("Сводка заявок на оплату")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Новая заявка" }));
    const projectSection = screen.getByText("Проект и контекст").closest("section");
    const paymentSection = screen.getByText("Что оплачиваем").closest("section");
    if (!projectSection || !paymentSection) throw new Error("Разделы формы не найдены");
    expect(projectSection.compareDocumentPosition(paymentSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(projectSection.querySelector("header span")).toHaveTextContent("00");
    expect(paymentSection.querySelector("header span")).toHaveTextContent("01");
    changeField(screen.getByRole("textbox", { name: "Название заявки" }), {
      target: { value: "Полная заявка BP-6" },
    });
    changeField(screen.getByRole("textbox", { name: "Сумма заявки" }), {
      target: { value: "12500000" },
    });
    changeField(screen.getByRole("textbox", { name: "Назначение платежа" }), {
      target: { value: "Оплата подрядчику" },
    });
    expect(screen.queryByLabelText("тип перевода")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("основание платежа")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("проект"));
    fireEvent.click(await screen.findByRole("option", { name: "WS-26 · Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));
    expect(screen.getByText("Выберите действующий проект, его направление и при необходимости работу.")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url, options]) => String(url).endsWith("/approval-requests") && options?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByLabelText("направление"));
    fireEvent.click(await screen.findByRole("option", { name: "Проведение форума" }));
    fireEvent.click(screen.getByLabelText("задача или мероприятие"));
    fireEvent.click(await screen.findByRole("option", { name: "Мероприятие · Форум" }));
    expect(screen.queryByLabelText("название проекта")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("код проекта")).not.toBeInTheDocument();
    changeField(screen.getByLabelText("категория платежа"), {
      target: { value: "Мероприятия" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));
    expect(screen.getByText("Для категории «Мероприятия» выберите встречу или мероприятие, которое ещё не завершилось.")).toBeInTheDocument();
    changeField(screen.getByLabelText("фильтр событий по проекту"), { target: { value: "all" } });
    changeField(screen.getByLabelText("поиск события"), { target: { value: "Планирование" } });
    fireEvent.click(screen.getByLabelText("событие календаря"));
    fireEvent.click(await screen.findByRole("option", { name: /Планирование недели/ }));
    await waitFor(() => expect(screen.getByLabelText("событие календаря")).toHaveTextValue("calendar-1"));
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));

    expect(await screen.findByRole(
      "button",
      { name: "Открыть заявку №502: Полная заявка BP-6" },
      { timeout: 5000 },
    )).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/approval-requests") && options?.method === "POST",
    );
    const payload = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      transferType: null,
      projectName: "Workspace",
      projectCode: "WS-26",
      projectId: "hub-project-1",
      workstreamId: "hub-stream-1",
      projectItemId: "hub-item-1",
      paymentPurpose: "Мероприятия",
      paymentReason: "",
      calendarEventId: "calendar-1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать v1" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/approval-templates/workflow/publish"),
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("opens a structured payment card and advances it by a protected board drop", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    clickWithFocus(await screen.findByRole("button", { name: "Новая заявка" }));
    expect(screen.getByText("Что оплачиваем")).toBeInTheDocument();
    expect(screen.getByText("Реквизиты платежа")).toBeInTheDocument();
    expect(screen.getByText("Документы", { selector: "strong" })).toBeInTheDocument();
    changeField(screen.getByRole("textbox", { name: "Название заявки" }), {
      target: { value: "Заявка для доски" },
    });
    changeField(screen.getByRole("textbox", { name: "Сумма заявки" }), {
      target: { value: "7350000" },
    });
    await selectPaymentDirection();
    clickWithFocus(screen.getByRole("button", { name: "Отправить по маршруту" }));

    const openCard = await screen.findByRole("button", {
      name: "Открыть заявку №502: Заявка для доски",
    });
    fireEvent.click(openCard);
    expect(screen.getByRole("dialog", { name: "Заявка для доски" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обзор" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Маршрут" }));
    expect(screen.getByText("Контроль срока")).toBeInTheDocument();
    expect(screen.getByText("Укажите срок в заявке, чтобы включить напоминания и эскалацию."))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Обзор" }));
    expect(screen.getByText("Информация по заявке")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Активность" }));
    expect(screen.getByText("Ход согласования")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Файлы" }));
    expect(screen.getByText("Основные документы")).toBeInTheDocument();
    expect(screen.queryByLabelText("Живой маршрут заявки")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть карточку заявки" }));

    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.getByLabelText("Список заявок")).toHaveTextContent("Заявка для доски");
    fireEvent.click(screen.getByRole("button", { name: "Канбан" }));
    expect(screen.getByLabelText("Доска заявок по стадиям")).toBeInTheDocument();

    const card = (await screen.findByRole("button", {
      name: "Открыть заявку №502: Заявка для доски",
    })).closest("article");
    expect(card).not.toBeNull();
    installSpatialGeometry();
    const targetColumn = screen.getByLabelText(/^Согласовано: 0 заявок$/);
    await dropSpatialCard(card!, targetColumn);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/approval-requests/server-request/actions"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"action":"approve"'),
      }),
    ));
    await waitFor(() => expect(targetColumn.querySelector(".approval-board-card")).not.toBeNull());
    expect(screen.getByLabelText("Сумма в колонке «Согласование»")).toHaveTextContent("0 UZS");
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("7 350 000 UZS");
    changeField(screen.getByLabelText("Поиск заявок"), { target: { value: "Нет такого названия" } });
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("0 UZS");
    changeField(screen.getByLabelText("Поиск заявок"), { target: { value: "" } });
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("7 350 000 UZS");
  }, 30_000);

  it("marks only subsidy-route payment cards with the alternate approver", async () => {
    mockServer({ withSubsidyRequest: true });
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    const card = screen.getByRole("button", {
      name: "Открыть заявку №503: Оплата по субсидии",
    }).closest("article");
    expect(card).toHaveClass("subsidy-route");
    expect(card).toHaveTextContent("Субсидия · первый исполнительный директор");
    fireEvent.click(screen.getByRole("button", { name: "Новая заявка" }));
    fireEvent.click(screen.getByLabelText("проект"));
    fireEvent.click(await screen.findByRole("option", { name: "SUB · Субсидия" }));
    expect(screen.getByText(/этап руководства согласует первый исполнительный директор Аскар Маматханов/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("проект"));
    fireEvent.click(screen.getByRole("option", { name: "WS-26 · Workspace" }));
    expect(screen.queryByText(/этап руководства согласует первый исполнительный директор Аскар Маматханов/)).not.toBeInTheDocument();
  });

  it("keeps a payment card in place after a rejected board move and allows retry", async () => {
    const fetchMock = mockServer({ failApprovalActionOnce: true });
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    clickWithFocus(await screen.findByRole("button", { name: "Новая заявка" }));
    changeField(screen.getByRole("textbox", { name: "Название заявки" }), {
      target: { value: "Заявка с повтором" },
    });
    changeField(screen.getByRole("textbox", { name: "Сумма заявки" }), {
      target: { value: "7350000" },
    });
    await selectPaymentDirection();
    clickWithFocus(screen.getByRole("button", { name: "Отправить по маршруту" }));

    const openCard = await screen.findByRole("button", { name: "Открыть заявку №502: Заявка с повтором" });
    const card = openCard.closest("article");
    expect(card).not.toBeNull();
    installSpatialGeometry();
    const targetColumn = screen.getByLabelText(/^Согласовано: 0 заявок$/);
    await dropSpatialCard(card!, targetColumn);

    await waitFor(() => expect(document.querySelector(".approval-board-notice")).toHaveTextContent("Этап уже изменён"));
    expect(card!.closest("[data-spatial-lane]")?.getAttribute("aria-label")).toMatch(/^Согласование: 1 /);
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("0 UZS");

    // A rejected spatial drop visibly settles back to its source before the
    // next drag is accepted; retry must still use the same protected action.
    await waitFor(() => {
      expect(card).not.toHaveClass("is-lifted");
      expect(card).not.toHaveClass("is-committing");
    });
    const retryCard = screen
      .getByRole("button", { name: "Открыть заявку №502: Заявка с повтором" })
      .closest("article");
    expect(retryCard).not.toBeNull();
    const retryTargetColumn = screen.getByLabelText(/^Согласовано: 0 заявок$/);
    await dropSpatialCard(retryCard!, retryTargetColumn);
    await waitFor(() => expect(screen
      .getByRole("button", { name: "Открыть заявку №502: Заявка с повтором" })
      .closest("[data-spatial-lane]")?.getAttribute("aria-label")).toMatch(/^Согласовано: 1 /));
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("7 350 000 UZS");
    expect(fetchMock.mock.calls.filter(([url, options]) => String(url).endsWith("/approval-requests/server-request/actions") && options?.method === "POST")).toHaveLength(2);
  });

  it("edits a returned request and resubmits its new version", async () => {
    mockServer({ withReturnedRequest: true });
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    expect(screen.getByText("Исправьте сумму и приложите новый счёт")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Исправить заявку" }));
    changeField(screen.getByRole("textbox", { name: "Исправленная сумма заявки" }), {
      target: { value: "4800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить и отправить повторно" }));

    expect((await screen.findAllByText(/4.800.000 UZS/)).length).toBeGreaterThan(0);
    expect(screen.getByText("Версия 2 · создана из задачи")).toBeInTheDocument();
  });

  it("lets the initiator change an active request currency without resubmitting the workflow", async () => {
    const fetchMock = mockServer({ withSubsidyRequest: true });
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    fireEvent.click(screen.getByRole("button", { name: "Исправить заявку" }));
    changeField(screen.getByLabelText("Исправленные валюта оплаты"), {
      target: { value: "USD" },
    });
    changeField(screen.getByRole("textbox", { name: "Причина изменения заявки" }), {
      target: { value: "Уточнили валюту счёта" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, options]) =>
      String(url).endsWith("/approval-requests/subsidy-request") && options?.method === "PATCH"
    )).toBe(true));
    const patchCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/approval-requests/subsidy-request") && options?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toMatchObject({
      currency: "USD", changeComment: "Уточнили валюту счёта",
    });
    expect(fetchMock.mock.calls.some(([url, options]) =>
      String(url).endsWith("/approval-requests/subsidy-request/actions") && options?.method === "POST"
    )).toBe(false);
    expect(await screen.findByText("Уточнили валюту счёта")).toBeInTheDocument();
  });

  it("shows active-request editing to the superadmin who did not initiate it", async () => {
    mockServer({ withSubsidyRequest: true, superadminLogin: true });
    render(<App />);
    await loginToWorkspace("malika", "payment_requests");
    expect(screen.getByRole("button", { name: "Исправить заявку" })).toBeInTheDocument();
  });

  it("opens the workflow designer inside the authenticated shell", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika", "payment_requests");
    expect(screen.getByRole("button", { name: "Новая заявка" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    expect(screen.getByLabelText("Дерево согласования заявки на оплату")).toBeInTheDocument();
    expect(screen.getByLabelText("Настройки выбранного блока")).toHaveTextContent("Выберите блок");
    expect(screen.getByText("Карта процесса")).toBeInTheDocument();
  });

  it("keeps the workflow designer unavailable to a manager", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    expect(screen.queryByRole("button", { name: "Конструктор маршрутов" }))
      .not.toBeInTheDocument();
  });

  it("stores deadline reminders and escalation rules on an approval stage", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika", "payment_requests");
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    const approvalNode = screen.getAllByText("Согласование").find(
      (element) => element.closest(".react-flow__node"),
    );
    expect(approvalNode).toBeDefined();
    fireEvent.click(approvalNode!);
    changeField(screen.getByLabelText("Первое напоминание, ч."), {
      target: { value: "12" },
    });
    changeField(screen.getByLabelText("Повторное, ч."), {
      target: { value: "1" },
    });
    changeField(screen.getByLabelText("Эскалировать после просрочки, ч."), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Получатель эскалации" }));
    fireEvent.click(within(screen.getByLabelText("Доступные сотрудники")).getByRole("button", {
      name: /Бахтиёр Самугов/,
    }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/approval-templates/workflow/graph"),
      expect.objectContaining({ method: "PUT" }),
    ));
    const saveCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).includes("/approval-templates/workflow/graph") && options?.method === "PUT",
    );
    const savedWorkflow = JSON.parse(String(saveCall?.[1]?.body)) as {
      nodes: { id: string; config: Record<string, unknown> }[];
    };
    expect(savedWorkflow.nodes.find((node) => node.id === "manager")?.config).toMatchObject({
      reminderHoursBefore: [12, 1],
      escalationAfterHours: 3,
      escalationUserId: people[1]!.id,
    });
  });

  it("undoes, redoes and cancels workflow edits from shortcuts and toolbar controls", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika", "payment_requests");
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));

    const undoButton = screen.getByRole("button", { name: "Назад (Ctrl+Z)" });
    const redoButton = screen.getByRole("button", { name: "Вперёд (Ctrl+Shift+Z)" });
    const cancelButton = screen.getByRole("button", { name: "Отменить все изменения маршрута" });
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Условие" }));
    const nameInput = screen.getByLabelText("Название");
    changeField(nameInput, { target: { value: "Порог суммы" } });
    expect(nameInput).toHaveTextValue("Порог суммы");
    expect(undoButton).toBeEnabled();
    expect(cancelButton).toBeEnabled();

    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true });
    expect(nameInput).toHaveTextValue("Условие");
    expect(redoButton).toBeEnabled();

    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true, shiftKey: true });
    expect(nameInput).toHaveTextValue("Порог суммы");

    fireEvent.click(undoButton);
    expect(nameInput).toHaveTextValue("Условие");
    fireEvent.click(redoButton);
    expect(nameInput).toHaveTextValue("Порог суммы");

    fireEvent.click(cancelButton);
    expect(screen.queryByDisplayValue("Порог суммы")).not.toBeInTheDocument();
    expect(screen.getByText("Черновик сохранён")).toBeInTheDocument();
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();
  });

  it("disables payment creation for a position outside the workflow policy", async () => {
    mockServer({ restrictPaymentCreators: true });
    render(<App />);
    await loginToWorkspace("aziza", "payment_requests");
    expect(screen.getByRole("button", { name: "Новая заявка" })).toBeDisabled();
    expect(
      screen.getByText("Ваша должность не может создавать заявки на оплату"),
    ).toBeInTheDocument();
  });

  it("shows project sections and payments while hiding legacy projects and collapsed AI links", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    const navigation = screen.getByRole("navigation");
    const labels = within(navigation).getAllByRole("button").map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "Главная",
      "Задачи",
      "Заявки на оплату",
      "ИИ-модули",
      "Входящие письма",
      "Лента",
      "Проекты",
      "Поездки",
      "Отпуска",
      "Отсутствия",
      "Работа с членами",
      "HR",
      "Мессенджер",
      "Календарь",
      "Zoom-конференции",
      "Сотрудники",
      "Аналитика опросов",
      "Настройки",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    const aiModules = await screen.findByRole("navigation", { name: "Выбор ИИ-модуля" });
    expect(within(aiModules).getByRole("button", { name: "AI Referent" })).toBeInTheDocument();
    expect(within(aiModules).getByRole("button", { name: "AI Hisobot" })).toBeInTheDocument();
  });

  it("keeps the sidebar editor open after clicking the pencil", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Изменить порядок меню" }));

    expect(screen.getByRole("form", { name: "Порядок главного меню" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Сохранить порядок меню" })).toHaveAttribute("type", "button");
    expect(screen.getByRole("button", { name: "Сохранить" })).toBeInTheDocument();
  });

  it("creates a project and moves it through the project board", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "projects");
    expect(await screen.findByLabelText("Стадии проектов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));
    const form = within(await screen.findByRole("dialog", { name: "Создать проект" }));
    changeField(form.getByLabelText("Код проекта"), { target: { value: "BP7-TEST" } });
    changeField(form.getByLabelText("Название проекта"), { target: { value: "Тестовый проект BP-7" } });
    changeField(form.getByLabelText("Бюджет проекта"), { target: { value: "50000000" } });
    fireEvent.click(form.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("heading", { name: "Тестовый проект BP-7" })).toBeInTheDocument();

    const closeDetail = screen.queryByRole("button", { name: "Закрыть карточку проекта" });
    if (closeDetail) fireEvent.click(closeDetail);
    const card = await screen.findByRole("button", { name: "Перенести: Тестовый проект BP-7" });
    const targetColumn = document.querySelector<HTMLElement>('.project-board [data-spatial-lane="preparation"]');
    expect(targetColumn).not.toBeNull();
    installSpatialGeometry();
    await dropSpatialCard(card.closest("article")!, targetColumn!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/project-created/stage"),
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("creates and submits a trip request", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");

    clickWithFocus(screen.getByRole("button", { name: "Поездки" }));
    clickWithFocus(await screen.findByRole("button", { name: "Новая командировка" }, { timeout: 5000 }));
    const form = within(await screen.findByRole("dialog", { name: "Создать заявку на поездку" }));
    // fireEvent.change does not focus an input as typing in the browser would.
    // Keep Fluent/Tabster's active modal aligned with the form being edited.
    const destination = form.getByLabelText("Куда едем");
    act(() => destination.focus());
    await waitFor(() => expect(destination).toHaveFocus());
    changeField(destination, { target: { value: "Бухара" } });
    changeField(form.getByRole("textbox", { name: "Основание и мероприятие" }), {
      target: { value: "Yuridik klinika ishtirokchilari sayyor qabul o'tkazadi" },
    });
    changeField(form.getByRole("textbox", { name: "Источник покрытия расходов" }), {
      target: { value: "KAS loyihasi mablagʻlari" },
    });
    fireEvent.click(await form.findByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("heading", { name: "Бухара" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Отправить первому заместителю" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/trip-requests/trip-created/actions"),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("На согласовании")).toBeInTheDocument();
  });

  it("publishes and discusses a corporate feed post", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");

    clickWithFocus(screen.getByRole("button", { name: "Лента" }));
    expect(await screen.findByText("Корпоративная лента подключена.")).toBeInTheDocument();
    clickWithFocus(screen.getByRole("button", { name: "Новое объявление" }));
    const dialog = await screen.findByRole("dialog", { name: "Новое объявление" });
    const form = within(dialog);
    act(() => form.getByLabelText("Заголовок публикации").focus());
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-hidden", "true"));
    changeField(form.getByRole("textbox", { name: "Заголовок публикации" }), {
      target: { value: "Итоги рабочего дня" },
    });
    changeField(form.getByRole("textbox", { name: "Текст публикации" }), {
      target: { value: "Ключевые задачи выполнены." },
    });
    fireEvent.click(form.getByRole("button", { name: "Опубликовать" }));
    expect(await screen.findByRole("heading", { name: "Итоги рабочего дня" })).toBeInTheDocument();

    changeField(screen.getByRole("textbox", {
      name: "Комментарий к публикации Итоги рабочего дня",
    }), { target: { value: "Принято" } });
    const commentButtons = screen.getAllByRole("button", { name: "Отправить комментарий" });
    fireEvent.click(commentButtons[0]!);
    expect(await screen.findByText("Принято")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/feed/posts/feed-created/comments"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("forwards a feed post to a chat and loads the real original on activation", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");
    fireEvent.click(screen.getByRole("button", { name: "Лента" }));
    await screen.findByText("Корпоративная лента подключена.");
    fireEvent.click(await screen.findByRole("button", { name: "Переслать объявление: Новости Workspace" }));
    const dialog = screen.getByRole("dialog", { name: "Переслать объявление" });
    fireEvent.click(within(dialog).getByRole("button", { name: /Финансы и закупки/ }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Переслать объявление" })).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/chats/finance/forwards"), expect.objectContaining({
      method: "POST", body: expect.stringContaining('"sourceId":"feed-1"'),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Мессенджер" }));
    const card = await screen.findByRole("button", { name: /Новости Workspace.*Открыть в ленте/ });
    fireEvent.click(card);
    const original = await screen.findByRole("article", { name: "Новости Workspace" });
    await waitFor(() => expect(original).toHaveFocus());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/feed/posts/feed-1"), expect.anything());
  });

  it("creates an event in the shared calendar", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("aziza", "home");

    clickWithFocus(within(document.querySelector(".app-rail")!).getByRole("button", {
      name: "Календарь",
    }));
    await screen.findByRole("button", { name: "Новое событие" });
    const calendar = screen.getByRole("region", { name: "Календарь" });
    expect(within(calendar).queryByRole("heading", { name: "Календарь" })).not.toBeInTheDocument();
    expect(within(calendar).getByRole("button", { name: "Фильтры" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", {
      name: `Открыть задачу: ${initialTasks[0]!.title}`,
    })).not.toBeInTheDocument();
    clickWithFocus(within(calendar).getByRole("button", { name: "Новое событие" }));
    const dialog = await screen.findByRole("dialog", { name: "Новое мероприятие" });
    expect(dialog).toBeInTheDocument();
    const form = within(dialog);
    act(() => form.getByLabelText("Название события").focus());
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-hidden", "true"));
    changeField(form.getByRole("textbox", { name: "Название события" }), {
      target: { value: "Встреча BP-8" },
    });
    fireEvent.click(await form.findByLabelText("Проект события"));
    fireEvent.click(await screen.findByRole("option", { name: "WS-26 · Workspace" }));
    fireEvent.click(form.getByLabelText("Направление события"));
    fireEvent.click(await screen.findByRole("option", { name: "Проведение форума" }));
    fireEvent.click(form.getByLabelText("Работа направления события"));
    fireEvent.click(await screen.findByRole("option", { name: "Мероприятие · Форум" }));
    fireEvent.click(form.getByRole("button", { name: "Добавить задачу" }));
    changeField(form.getByRole("textbox", { name: "Название внутренней задачи 1" }), {
      target: { value: "Подготовить материалы" },
    });
    const dueDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const taskDueAt = new Date(dueDate.getTime() - dueDate.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    changeField(form.getByLabelText("Срок внутренней задачи 1"), { target: { value: taskDueAt } });
    changeField(form.getByRole("combobox", { name: "Приоритет внутренней задачи 1" }), { target: { value: "high" } });
    changeField(form.getByRole("textbox", { name: "Описание внутренней задачи 1" }), { target: { value: "Собрать презентацию" } });
    fireEvent.click(form.getByRole("button", { name: "Добавить заявку" }));
    changeField(form.getByRole("textbox", { name: "Название подготовленной заявки" }), {
      target: { value: "Оплата площадки" },
    });
    changeField(form.getByRole("textbox", { name: "Сумма подготовленной заявки в сумах" }), {
      target: { value: "250000" },
    });
    fireEvent.click(form.getByRole("button", { name: "Создать мероприятие" }));
    // The agenda can show the new title before linked records finish saving and the details open.
    const eventDialog = await screen.findByRole("dialog", { name: "Встреча BP-8" });
    expect(within(eventDialog).getByText("Встреча BP-8")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/calendar/events"),
      expect.objectContaining({ method: "POST" }),
    );
    const calendarRequest = fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/calendar/events") && options?.method === "POST",
    );
    expect(JSON.parse(String(calendarRequest?.[1]?.body))).toMatchObject({
      projectId: "hub-project-1", workstreamId: "hub-stream-1", projectItemId: "hub-item-1",
    });
    const taskRequest = fetchMock.mock.calls.find(([url, options]) => (
      String(url).endsWith("/tasks") && options?.method === "POST"
    ));
    expect(JSON.parse(String(taskRequest?.[1]?.body))).toMatchObject({
      title: "Подготовить материалы",
      calendarEventId: "calendar-created",
      dueAt: new Date(taskDueAt).toISOString(),
      priority: "high",
      description: "Собрать презентацию",
    });
    const paymentRequest = fetchMock.mock.calls.find(([url, options]) => (
      String(url).endsWith("/approval-requests") && options?.method === "POST"
    ));
    expect(JSON.parse(String(paymentRequest?.[1]?.body))).toMatchObject({
      title: "Оплата площадки",
      amount: 250000,
      calendarEventId: "calendar-created",
      projectId: "hub-project-1",
      workstreamId: "hub-stream-1",
      projectItemId: "hub-item-1",
    });
    fireEvent.click(within(eventDialog).getByText("Отменить событие"));
    expect(await screen.findByText("Событие отменено")).toBeInTheDocument();
  });

  it("opens the employee directory and creates a position", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika", "home");

    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    const positions = await screen.findByRole("button", { name: "Должности" });
    await waitFor(() => expect(positions).toBeEnabled());
    expect(screen.getByRole("heading", { name: "Сотрудники" })).toBeInTheDocument();
    fireEvent.click(positions);
    changeField(screen.getByRole("textbox", { name: "Название новой должности" }), {
      target: { value: "Yangi lavozim" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect((await screen.findAllByText("Yangi lavozim")).length).toBeGreaterThan(0);
  });

  it("shows invitation activation without entering the workspace", () => {
    mockServer();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Активация приглашения" }));
    expect(screen.getByRole("heading", { name: "Создание учётной записи" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Код приглашения/)).toBeInTheDocument();
  });

  it("shows administrator-issued password recovery without entering the workspace", () => {
    mockServer();
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Сброс доступа" }));
    expect(screen.getByRole("heading", { name: "Новый пароль" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Код сброса доступа/)).toBeInTheDocument();
  });
});
import { changeField } from "./test-fixtures/rich-editor";
