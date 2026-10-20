import { act, cleanup, fireEvent, render as renderTestingLibrary, screen } from "@testing-library/react";
import { createDOMRenderer, RendererProvider } from "@fluentui/react-components";
import type { ReactElement } from "react";
import { disposeTabster, getTabster } from "tabster";
import { afterEach, vi } from "vitest";
import type { AIReferentLetter, ApprovalRequestSummary, CalendarEvent, CalendarEventInput, ChatMessage, FeedPost, NotificationPreferences, PaymentRequestDetails, TripRequest, WorkspaceAttachment, WorkspaceProject, WorkspaceNotification, WorkspaceTask } from "@yuksalish/contracts";
import { initialChats, initialMessages, initialTasks, people } from "./test-fixtures/demo-data";
import { homeEfficiency, homeRecognition } from "./test-fixtures/personal-home-fixture";
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
import { changeField } from "./test-fixtures/rich-editor";

// Shared real-app harness. Each isolated suite registers identical cleanup.
// Preloaded workflow modules preserve the original cold-transform behaviour.
export function render(element: ReactElement) {
  // Each scenario models a new app session. A shared Griffel renderer retains
  // unrelated screens' CSS, making jsdom accessibility queries slower over time.
  const renderer = createDOMRenderer(document, {
    styleElementAttributes: { "data-app-test-renderer": "true" },
  });
  return renderTestingLibrary(<RendererProvider renderer={renderer}>{element}</RendererProvider>);
}

export const workflow = {
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

export const paymentDetails: PaymentRequestDetails = {
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

export const position = {
  id: "position-finance",
  name: "Bosh hisobchi",
  isActive: true,
  sortOrder: 10,
  source: "bitrix",
  assignedUsersCount: 1,
};

export const directory = {
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

export function response(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    blob: async () => new Blob(),
  } as Response;
}

export function mockServer(
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

export function clickWithFocus(control: HTMLElement) {
  // A pointer click focuses a button before invoking its handler. fireEvent alone
  // omits that step, which leaves Fluent's modal restoration target on the body.
  act(() => control.focus());
  fireEvent.click(control);
}

export async function loginToWorkspace(username = "aziza", targetSection: "home" | "messenger" | "payment_requests" | "projects" = "messenger") {
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

export async function selectPaymentDirection() {
  fireEvent.click(screen.getByLabelText("проект"));
  fireEvent.click(await screen.findByRole("option", { name: "WS-26 · Workspace" }));
  fireEvent.click(screen.getByLabelText("направление"));
  fireEvent.click(await screen.findByRole("option", { name: "Проведение форума" }));
}

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
