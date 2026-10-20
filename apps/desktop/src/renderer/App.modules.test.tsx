import { dropSpatialCard, installSpatialGeometry } from "./spatial-test-helpers";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { initialTasks } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, mockServer, clickWithFocus, loginToWorkspace } from "./app-test-harness";

describe("corporate workspace authentication alpha", () => {
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
});
