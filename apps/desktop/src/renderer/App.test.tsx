import { dropSpatialCard, installSpatialGeometry } from "./spatial-test-helpers";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApprovalRequestSummary,
  CalendarEvent,
  CalendarEventInput,
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

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
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
  } = {},
) {
  let failApprovalActionOnce = serverOptions.failApprovalActionOnce ?? false;
  let currentUser = people[0]!;
  let tasks: WorkspaceTask[] = initialTasks.map((task) => ({ ...task }));
  let requests: ApprovalRequestSummary[] = serverOptions.withReturnedRequest
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
      endDate: "2026-12-20",
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
  let calendarEvents: CalendarEvent[] = [
    {
      id: "calendar-1",
      organizerUserId: people[0]!.id,
      title: "Планирование недели",
      description: "Общий статус",
      eventType: "meeting",
      startsAt: "2026-09-06T05:00:00Z",
      endsAt: "2026-09-06T06:00:00Z",
      allDay: false,
      location: "Переговорная",
      status: "scheduled",
      attendeeIds: [people[0]!.id],
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
      currentUser = people.find((person) => person.username === payload.username) ?? people[0]!;
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
        positions: directory.positions.map(({ id, name }) => ({ id, name })),
        chats: initialChats,
        messages: initialMessages,
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
      return response({
        id: "server-message",
        chatId: initialChats[0]!.id,
        authorId: people[0]!.id,
        body: payload.body,
        time: "12:00",
        own: true,
      });
    }
    if (url.includes("/chats/") && url.endsWith("/read") && options?.method === "POST") {
      return { ...response(undefined), status: 204, json: async () => undefined } as Response;
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
        stage: payload.action === "submit" ? "manager_approval" : trip.stage,
        stageLabel: payload.action === "submit" ? "Утверждение руководителем" : trip.stageLabel,
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
    if (url.endsWith("/approval-requests") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        title: string;
        amount: number;
        purpose: string;
        sourceTaskId?: string;
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
        purpose: string;
      };
      const current = requests[0]!;
      const revised = {
        ...current,
        ...payload,
        revision: current.revision + 1,
        versions: [
          ...current.versions,
          {
            version: current.revision + 1,
            title: payload.title,
            amount: payload.amount,
            currency: "UZS",
            purpose: payload.purpose,
            details: { ...current.details, ...payload },
            attachmentIds: [],
            editedByUserId: currentUser.id,
            changeReason: "correction",
            createdAt: "2026-09-03T11:00:00Z",
          },
        ],
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

async function loginToWorkspace(username = "aziza") {
  await screen.findByRole("button", { name: "Войти" });
  fireEvent.change(screen.getByLabelText(/^Логин/), {
    target: { value: username },
  });
  fireEvent.change(screen.getByLabelText(/^Пароль/), {
    target: { value: "Yuksalish-Local-2026!" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Войти" }));
  await screen.findByText("Сервер подключён");
}

describe("corporate workspace authentication alpha", () => {
  afterEach(() => {
    cleanup();
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
    fireEvent.change(composer, { target: { value: "Заявку подготовила" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    expect(await screen.findByText("Заявку подготовила")).toBeInTheDocument();
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
    fireEvent.change(screen.getByRole("textbox", { name: "Новое сообщение" }), { target: { value: "Не отправлено" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить сообщение" }));
    const failedStatus = await screen.findByText("Не удалось выполнить операцию");
    expect(failedStatus.closest("button")).toHaveClass("connection-indicator", "has-error");
    expect(failedStatus).not.toHaveClass("online");
    expect(screen.queryByText("Сервер подключён")).not.toBeInTheDocument();
  });

  it("opens the attention queue, marks an item read and follows its deep link", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    expect(screen.getByRole("heading", { name: "Требует моего внимания" })).toBeInTheDocument();
    expect(screen.getByText("2", { selector: ".rail-badge" })).toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".notification-metrics strong" })).toBeInTheDocument();

    fireEvent.click(screen.getByText("Задача требует внимания").closest("button")!);
    expect(await screen.findByRole("heading", { name: initialTasks[0]!.title })).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/notification-task/read"),
      expect.objectContaining({ method: "PATCH" }),
    ));
    fireEvent.click(screen.getByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }));
    expect(await screen.findByRole("heading", { name: initialTasks[1]!.title })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Уведомления" }));
    fireEvent.click(screen.getByRole("button", { name: "Прочитать все" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/notifications/read-all"),
      expect.objectContaining({ method: "POST" }),
    ));
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
    fireEvent.click(screen.getByText("Исправить заявку").closest("button")!);
    expect(await screen.findByRole("dialog", { name: "Вернувшаяся заявка" })).toBeInTheDocument();
  });

  it("uploads a real attachment with a new message", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    const file = new File(["invoice"], "invoice.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Файлы сообщения"), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Новое сообщение" }), {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить счёт из переписки" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить задачу" }));

    expect(await screen.findByText("Создана из сообщения · связь сохранена")).toBeInTheDocument();
    const closeNotice = screen.queryByRole("button", { name: "Закрыть уведомление" });
    if (closeNotice) fireEvent.click(closeNotice);
    await waitFor(() => {
      expect(screen.queryByText("Создана из сообщения · связь сохранена")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog", { name: "Новая задача" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Проверить счёт из переписки").length).toBeGreaterThan(0);
  });

  it("creates a task after authentication", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая задача" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить новый маршрут оплаты" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Описание новой задачи" }), {
      target: { value: "Сверить роли и вернуть проверяемый результат" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Проект новой задачи" }), {
      target: { value: "Маршруты" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Приоритет новой задачи" }), {
      target: { value: "high" },
    });
    const plan = screen.getByText("План выполнения").closest("details")!;
    expect(plan).not.toHaveAttribute("open");
    fireEvent.click(plan.querySelector("summary")!);
    expect(plan).toHaveAttribute("open");
    fireEvent.change(screen.getByRole("textbox", { name: "Новый пункт чек-листа при создании" }), {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
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
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск задач" }), { target: { value: "__no_task_matches__" } });
    expect(document.querySelectorAll(".task-row")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(document.querySelectorAll(".kanban-card")).toHaveLength(0);
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск задач" }), { target: { value: "" } });
    expect(document.querySelectorAll(".kanban-card").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Просроченные" }));
    const cards = [...document.querySelectorAll(".kanban-card")];
    expect(cards.length).toBe(initialTasks.filter((task) => task.status === "overdue").length);
    expect(cards.every((card) => card.closest('[data-task-status="overdue"]'))).toBe(true);
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "PATCH")).toHaveLength(0);
  });

  it("shows filtered tasks in the calendar with their automatic chat beside the details", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(within(document.querySelector(".view-switch")!).getByRole("button", { name: "Календарь" }));
    expect(screen.getByRole("heading", { name: "Календарь задач" })).toBeInTheDocument();
    expect(document.querySelector(".tasks-view.calendar-mode > .tasks-main > .section-toolbar")).toBeNull();
    expect(screen.getByRole("grid", { name: /Календарь задач:/ })).toBeInTheDocument();
    expect(document.querySelectorAll(".task-calendar-item")).toHaveLength(initialTasks.length);

    fireEvent.click(screen.getByRole("button", {
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

  it("finds employees without changing their roles or selected record", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika");
    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    const search = await screen.findByRole("textbox", { name: "Поиск сотрудников" });
    const selectedName = document.querySelector(".directory-heading h2")?.textContent;
    fireEvent.change(search, { target: { value: "__no_employee_matches__" } });
    expect(screen.getByText("Сотрудники не найдены")).toBeInTheDocument();
    expect(document.querySelectorAll(".employee-row")).toHaveLength(0);
    expect(document.querySelector(".directory-heading h2")?.textContent).toBe(selectedName);
    fireEvent.change(search, { target: { value: "" } });
    expect(document.querySelectorAll(".employee-row").length).toBeGreaterThan(0);
  });

  it("opens the existing invitation form directly from the employee list", async () => {
    mockServer(); render(<App />); await loginToWorkspace("malika");
    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    fireEvent.click(await screen.findByRole("button", { name: "Пригласить сотрудника" }));
    expect(screen.getByRole("dialog", { name: "Приглашение сотрудника" })).toBeInTheDocument();
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
    const board = screen.getByLabelText("Kanban задач");
    expect(board).toBeInTheDocument();
    expect(board.querySelectorAll(".kanban-column")).toHaveLength(5);
    expect(screen.getByLabelText("Новые: задачи")).toHaveAttribute("tabindex", "0");
    expect(screen.getAllByText("Новые").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();
    expect(screen.queryByRole("button", { name: "К списку задач" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Редактировать карточку" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название в карточке" }), {
      target: { value: "Полная карточка BP-5" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Описание задачи" }), {
      target: { value: "Описание, участники и контроль исполнения" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить карточку" }));
    expect(await screen.findByRole("heading", { name: "Полная карточка BP-5" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Новый участник"), {
      target: { value: people[0]!.id },
    });
    fireEvent.change(screen.getByLabelText("Роль участника"), {
      target: { value: "observer" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Добавить" })[0]!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/participants"),
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    fireEvent.change(screen.getByLabelText("Новый пункт чек-листа"), {
      target: { value: "Проверить результат" },
    });
    const checklistForm = screen.getByLabelText("Новый пункт чек-листа").closest(".inline-task-form")!;
    fireEvent.click(checklistForm.querySelector("button")!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/checklist"), expect.objectContaining({ method: "POST" })));
    const checklistItem = await screen.findByRole("checkbox", { name: "Проверить результат" });
    fireEvent.click(checklistItem);
    await waitFor(() => expect(screen.getByText("1/1")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Зависимая задача"), {
      target: { value: initialTasks[1]!.id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Связать" }));
    expect((await screen.findAllByText(initialTasks[1]!.title)).length).toBeGreaterThan(1);

    fireEvent.click(screen.getByRole("button", { name: "Добавить цикл" }));
    fireEvent.change(screen.getByLabelText("Период повторения"), {
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

    fireEvent.change(screen.getByRole("textbox", { name: "Новый комментарий" }), {
      target: { value: "Карточка готова к проверке" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Карточка готова к проверке")).toBeInTheDocument();
  });

  it("lets an administrator delete an active task after confirmation", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    const confirmation = await screen.findByRole("dialog", { name: "Удалить задачу?" });
    fireEvent.click(within(confirmation).getByText("Удалить").closest("button")!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/tasks\/[^/]+$/),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a subtask and runs result review with a motivated return", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Добавить подзадачу" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название подзадачи" }), {
      target: { value: "Сверить итоговые цифры" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать подзадачу" }));
    expect((await screen.findAllByText("Сверить итоговые цифры")).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("textbox", { name: "Результат задачи" }), {
      target: { value: "Договор и расчёты приложены" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить на проверку" }));
    expect(await screen.findByText("Договор и расчёты приложены", { selector: "p" })).toBeInTheDocument();
    await screen.findByRole("button", { name: "Принять результат" });
    expect(screen.getByText("Ожидает решения")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Вернуть на доработку" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Пояснение причины" }), {
      target: { value: "Добавьте номер договора" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителю" }));
    await waitFor(() => expect(screen.getByText("Добавьте номер договора", { selector: "p" })).toBeInTheDocument());
    expect(screen.getByText("Нужны исправления")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Результат задачи" }), {
      target: { value: "Номер договора добавлен" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить на проверку" }));
    fireEvent.click(await screen.findByRole("button", { name: "Принять результат" }));
    expect(await screen.findByText("Принято")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/accept-result"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("creates a payment request from the selected task", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Создать заявку на оплату" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название заявки из задачи" }), {
      target: { value: "Оплатить поставку по задаче" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Сумма заявки из задачи" }), {
      target: { value: "4800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));

    expect(await screen.findByText("Оплатить поставку по задаче")).toBeInTheDocument();
    expect(screen.getByText("Версия 1 · создана из задачи")).toBeInTheDocument();
  });

  it("submits the complete payment card and publishes a workflow version", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    expect(screen.getByRole("navigation").closest(".app-shell")).not.toHaveClass("approval-shell");
    expect(screen.getByLabelText("Сводка заявок")).toHaveTextContent("В работе");
    expect(screen.queryByLabelText("Сводка заявок на оплату")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новая заявка" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название заявки" }), {
      target: { value: "Полная заявка BP-6" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Сумма заявки" }), {
      target: { value: "12500000" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Назначение платежа" }), {
      target: { value: "Оплата подрядчику" },
    });
    fireEvent.change(screen.getByLabelText("тип перевода"), {
      target: { value: "Другие услуги" },
    });
    fireEvent.change(screen.getByLabelText("название проекта"), {
      target: { value: "Workspace" },
    });
    fireEvent.change(screen.getByLabelText("код проекта"), {
      target: { value: "WS-26" },
    });
    fireEvent.change(screen.getByLabelText("категория платежа"), {
      target: { value: "Оплата за услуги" },
    });
    fireEvent.change(screen.getByLabelText("основание платежа"), {
      target: { value: "Договор 42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));

    expect(await screen.findByRole("button", { name: "Открыть заявку №502: Полная заявка BP-6" })).toBeInTheDocument();
    const createCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).endsWith("/approval-requests") && options?.method === "POST",
    );
    const payload = JSON.parse(String(createCall?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      transferType: "Другие услуги",
      projectName: "Workspace",
      projectCode: "WS-26",
      paymentPurpose: "Оплата за услуги",
      paymentReason: "Договор 42",
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
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая заявка" }));
    expect(screen.getByText("Что оплачиваем")).toBeInTheDocument();
    expect(screen.getByText("Реквизиты платежа")).toBeInTheDocument();
    expect(screen.getByText("Документы", { selector: "strong" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Название заявки" }), {
      target: { value: "Заявка для доски" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Сумма заявки" }), {
      target: { value: "7350000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));

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

    const card = openCard.closest("article");
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
    fireEvent.change(screen.getByLabelText("Поиск заявок"), { target: { value: "Нет такого названия" } });
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("0 UZS");
    fireEvent.change(screen.getByLabelText("Поиск заявок"), { target: { value: "" } });
    expect(screen.getByLabelText("Сумма в колонке «Согласовано»")).toHaveTextContent("7 350 000 UZS");
  });

  it("keeps a payment card in place after a rejected board move and allows retry", async () => {
    const fetchMock = mockServer({ failApprovalActionOnce: true });
    render(<App />);
    await loginToWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая заявка" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название заявки" }), {
      target: { value: "Заявка с повтором" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Сумма заявки" }), {
      target: { value: "7350000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить по маршруту" }));

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
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    expect(screen.getByText("Исправьте сумму и приложите новый счёт")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Исправить заявку" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Исправленная сумма заявки" }), {
      target: { value: "4800000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить и отправить повторно" }));

    expect((await screen.findAllByText(/4.800.000 UZS/)).length).toBeGreaterThan(0);
    expect(screen.getByText("Версия 2 · создана из задачи")).toBeInTheDocument();
  });

  it("opens the workflow designer inside the authenticated shell", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    expect(screen.getByRole("button", { name: "Новая заявка" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    expect(screen.getByLabelText("Дерево согласования заявки на оплату")).toBeInTheDocument();
    expect(screen.getByLabelText("Настройки выбранного блока")).toHaveTextContent("Выберите блок");
    expect(screen.getByText("Карта процесса")).toBeInTheDocument();
  });

  it("keeps the workflow designer unavailable to a manager", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza");

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    expect(screen.queryByRole("button", { name: "Конструктор маршрутов" }))
      .not.toBeInTheDocument();
  });

  it("stores deadline reminders and escalation rules on an approval stage", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    const approvalNode = screen.getAllByText("Согласование").find(
      (element) => element.closest(".react-flow__node"),
    );
    expect(approvalNode).toBeDefined();
    fireEvent.click(approvalNode!);
    fireEvent.change(screen.getByLabelText("Первое напоминание, ч."), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Повторное, ч."), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Эскалировать после просрочки, ч."), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Получатель эскалации"), {
      target: { value: people[1]!.id },
    });
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
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));

    const undoButton = screen.getByRole("button", { name: "Назад (Ctrl+Z)" });
    const redoButton = screen.getByRole("button", { name: "Вперёд (Ctrl+Shift+Z)" });
    const cancelButton = screen.getByRole("button", { name: "Отменить все изменения маршрута" });
    expect(undoButton).toBeDisabled();
    expect(redoButton).toBeDisabled();
    expect(cancelButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Условие" }));
    const nameInput = screen.getByLabelText("Название");
    fireEvent.change(nameInput, { target: { value: "Порог суммы" } });
    expect(nameInput).toHaveValue("Порог суммы");
    expect(undoButton).toBeEnabled();
    expect(cancelButton).toBeEnabled();

    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true });
    expect(nameInput).toHaveValue("Условие");
    expect(redoButton).toBeEnabled();

    fireEvent.keyDown(nameInput, { key: "z", ctrlKey: true, shiftKey: true });
    expect(nameInput).toHaveValue("Порог суммы");

    fireEvent.click(undoButton);
    expect(nameInput).toHaveValue("Условие");
    fireEvent.click(redoButton);
    expect(nameInput).toHaveValue("Порог суммы");

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
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    expect(screen.getByRole("button", { name: "Новая заявка" })).toBeDisabled();
    expect(
      screen.getByText("Ваша должность не может создавать заявки на оплату"),
    ).toBeInTheDocument();
  });

  it("shows the Bitrix-derived navigation in the confirmed order", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    const navigation = screen.getByRole("navigation");
    const labels = Array.from(navigation.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toEqual([
      "CRM",
      "Задачи",
      "Заявки на оплату",
      "AI Referent",
      "Лента",
      "Список проектов",
      "Согласование поездок",
      "Отсутствия",
      "Работа с членами",
      "HR",
      "Мессенджер",
      "Календарь",
      "Zoom-конференции",
      "Сотрудники",
      "Уведомления",
      "Настройки",
    ]);
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
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Список проектов" }));
    expect(screen.getByLabelText("Стадии проектов")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новый проект" }));
    fireEvent.change(screen.getByLabelText("Код проекта"), { target: { value: "BP7-TEST" } });
    fireEvent.change(screen.getByLabelText("Название проекта"), { target: { value: "Тестовый проект BP-7" } });
    fireEvent.change(screen.getByLabelText("Бюджет проекта"), { target: { value: "50000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("heading", { name: "Тестовый проект BP-7" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Подготовка" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/projects/project-created/stage"),
      expect.objectContaining({ method: "PATCH" }),
    ));
  });

  it("creates and submits a trip request", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Согласование поездок" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    fireEvent.change(screen.getByLabelText("Цель поездки"), { target: { value: "Рабочая встреча BP-7" } });
    fireEvent.change(screen.getByLabelText("Куда едем"), { target: { value: "Бухара" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("heading", { name: "Бухара" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Отправить руководителю" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/trip-requests/trip-created/actions"),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByText("На согласовании")).toBeInTheDocument();
  });

  it("publishes and discusses a corporate feed post", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Лента" }));
    expect(screen.getByText("Корпоративная лента подключена.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Новое объявление" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Заголовок публикации" }), {
      target: { value: "Итоги рабочего дня" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Текст публикации" }), {
      target: { value: "Ключевые задачи выполнены." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Опубликовать" }));
    expect(await screen.findByRole("heading", { name: "Итоги рабочего дня" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", {
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

  it("creates an event in the shared calendar", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(within(document.querySelector(".app-rail")!).getByRole("button", {
      name: "Календарь",
    }));
    expect(screen.getByRole("heading", { name: "Календарь" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: `Открыть задачу: ${initialTasks[0]!.title}`,
    }));
    expect(await screen.findByRole("heading", { name: initialTasks[0]!.title })).toBeInTheDocument();
    fireEvent.click(within(document.querySelector(".app-rail")!).getByRole("button", {
      name: "Календарь",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Новое событие" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), {
      target: { value: "Встреча BP-8" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("heading", { name: "Встреча BP-8" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/calendar/events"),
      expect.objectContaining({ method: "POST" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Отменить событие" }));
    expect(await screen.findByText("Событие отменено")).toBeInTheDocument();
  });

  it("opens the employee directory and creates a position", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    expect(await screen.findByRole("heading", { name: "Сотрудники" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Должности" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название новой должности" }), {
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
