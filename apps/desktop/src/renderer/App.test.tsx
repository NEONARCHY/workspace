import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ApprovalRequestSummary,
  WorkspaceAttachment,
  WorkspaceTask,
} from "@yuksalish/contracts";

import { App } from "./App";
import { initialChats, initialMessages, initialTasks, people } from "./demo-data";

const workflow = {
  id: "workflow",
  name: "Оплата",
  version: 1,
  status: "draft",
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
      id: "end",
      kind: "end" as const,
      label: "Согласовано",
      detail: "",
      positionX: 240,
      positionY: 0,
      config: {},
    },
  ],
  edges: [
    {
      id: "edge",
      source: "start",
      target: "end",
      outcome: "submit",
      condition: {},
      sortOrder: 0,
    },
  ],
};

const position = {
  id: "position-finance",
  name: "Финансовый менеджер",
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

function mockServer(options: { readonly withReturnedRequest?: boolean } = {}) {
  let currentUser = people[0]!;
  let tasks: WorkspaceTask[] = initialTasks.map((task) => ({ ...task }));
  let requests: ApprovalRequestSummary[] = options.withReturnedRequest
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
          requesterId: people[0]!.id,
          sourceTaskId: initialTasks[0]!.id,
          revision: 1,
          versions: [
            {
              version: 1,
              title: "Вернувшаяся заявка",
              amount: 5_000_000,
              currency: "UZS",
              purpose: "Требует исправления",
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
  const attachments: WorkspaceAttachment[] = [];
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
    if (url.endsWith("/workspace/bootstrap")) {
      return response({
        currentUser,
        people,
        chats: initialChats,
        messages: initialMessages,
        tasks,
        requests,
        attachments: [...attachments],
        workflow,
      });
    }
    if (url.endsWith("/directory") && options?.method === undefined) {
      return response(directory);
    }
    if (url.endsWith("/directory/positions") && options?.method === "POST") {
      return response({
        id: "position-new",
        name: "Новая должность",
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
        createdAt: "2026-09-03T10:00:00Z",
      };
      attachments.push(attachment);
      return response(attachment);
    }
    if (url.endsWith("/tasks") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        title: string;
        sourceMessageId?: string;
      };
      const created: WorkspaceTask = {
        id: "server-task",
        title: payload.title,
        description: "",
        project: "Без проекта",
        assigneeId: people[0]!.id,
        dueLabel: "Срок не указан",
        status: "new",
        priority: "normal",
        checklistDone: 0,
        checklistTotal: 0,
        sourceMessageId: payload.sourceMessageId,
        authorId: currentUser.id,
        participants: [],
        checklist: [],
        comments: [],
        dependencies: [],
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
    if (currentTask && options?.method === "PATCH" && /\/tasks\/[^/]+$/.test(url)) {
      const payload = JSON.parse(String(options.body)) as Partial<WorkspaceTask>;
      return replaceTask({
        ...currentTask,
        ...payload,
        dueLabel: payload.dueAt ? "20 сент., 14:00" : "Срок не указан",
      });
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
    if (url.endsWith("/approval-requests") && options?.method === "POST") {
      const payload = JSON.parse(String(options.body)) as {
        title: string;
        amount: number;
        purpose: string;
        sourceTaskId?: string;
      };
      const created = {
        id: "server-request",
        number: "502",
        title: payload.title,
        amount: payload.amount,
        currency: "UZS",
        purpose: payload.purpose,
        status: "running" as const,
        statusLabel: "Ожидает решения",
        activeNodeKeys: ["manager"],
        requesterId: currentUser.id,
        sourceTaskId: payload.sourceTaskId,
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
      const payload = JSON.parse(String(options?.body)) as { action: string; comment?: string };
      const current = requests[0]!;
      const changed = {
        ...current,
        status: payload.action === "resubmit" ? "running" as const : current.status,
        statusLabel: payload.action === "resubmit" ? "Ожидает решения" : current.statusLabel,
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
  });

  it("requires a password before opening the workspace", () => {
    mockServer();
    render(<App />);

    expect(screen.getByRole("heading", { name: "Добро пожаловать" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Сообщения" })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getAllByRole("button", { name: /Создать задачу из сообщения:/ })[0]!);
    fireEvent.change(screen.getByRole("textbox", { name: "Название задачи из сообщения" }), {
      target: { value: "Проверить счёт из переписки" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать задачу" }));

    expect(await screen.findByText("Создана из сообщения · связь сохранена")).toBeInTheDocument();
    expect(screen.getAllByText("Проверить счёт из переписки").length).toBeGreaterThan(0);
  });

  it("creates a task after authentication", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Новая задача" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
      target: { value: "Проверить новый маршрут оплаты" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    await waitFor(() =>
      expect(screen.getAllByText("Проверить новый маршрут оплаты").length).toBeGreaterThan(0),
    );
  });

  it("opens the Kanban board and manages a full task card", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(screen.getByLabelText("Kanban задач")).toBeInTheDocument();
    expect(screen.getAllByText("Новые").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Список" }));

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
      target: { value: "weekly" },
    });
    fireEvent.change(screen.getByLabelText("Интервал повторения"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить цикл" }));
    expect(await screen.findByText(/Каждую неделю · интервал 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отключить" }));
    expect(await screen.findByText(/Отключено · Каждую неделю/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Новый комментарий" }), {
      target: { value: "Карточка готова к проверке" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(await screen.findByText("Карточка готова к проверке")).toBeInTheDocument();
  });

  it("creates a payment request from the selected task", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
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

    expect(await screen.findByText(/4.800.000 UZS/)).toBeInTheDocument();
    expect(screen.getByText("Версия 2 · создана из задачи")).toBeInTheDocument();
  });

  it("opens the workflow designer inside the authenticated shell", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Заявки на оплату" }));
    expect(screen.getByRole("button", { name: "Новая заявка" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    expect(screen.getByLabelText("Дерево согласования заявки на оплату")).toBeInTheDocument();
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
      "Лента",
      "Список проектов",
      "Согласование поездок",
      "Мессенджер",
      "Календарь",
      "Сотрудники",
    ]);
  });

  it("opens the employee directory and creates a position", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Сотрудники" }));
    expect(await screen.findByRole("heading", { name: "Сотрудники" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Название новой должности" }), {
      target: { value: "Новая должность" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить" }));
    expect((await screen.findAllByText("Новая должность")).length).toBeGreaterThan(0);
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
