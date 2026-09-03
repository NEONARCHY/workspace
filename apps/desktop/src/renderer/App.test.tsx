import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function response(payload: unknown): Response {
  return { ok: true, json: async () => payload } as Response;
}

function mockServer() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/auth/login")) {
      return response({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "bearer",
        expiresIn: 900,
        user: people[0],
      });
    }
    if (url.endsWith("/workspace/bootstrap")) {
      return response({
        currentUser: people[0],
        people,
        chats: initialChats,
        messages: initialMessages,
        tasks: initialTasks,
        requests: [],
        workflow,
      });
    }
    if (url.includes("/messages") && options?.method === "POST") {
      return response({
        id: "server-message",
        chatId: initialChats[0]!.id,
        authorId: people[0]!.id,
        body: "Заявку подготовила",
        time: "12:00",
        own: true,
      });
    }
    if (url.endsWith("/tasks") && options?.method === "POST") {
      return response({
        id: "server-task",
        title: "Проверить новый маршрут оплаты",
        project: "Без проекта",
        assigneeId: people[0]!.id,
        dueLabel: "Срок не указан",
        status: "new",
        priority: "normal",
        checklistDone: 0,
        checklistTotal: 0,
      });
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

async function loginToWorkspace() {
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

  it("opens the workflow designer inside the authenticated shell", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Согласования" }));
    expect(screen.getByRole("button", { name: "Новая заявка" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Конструктор маршрутов" }));
    expect(screen.getByLabelText("Дерево согласования заявки на оплату")).toBeInTheDocument();
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
