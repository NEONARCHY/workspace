import { act, fireEvent, screen, waitFor, within, cleanup } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, mockServer, loginToWorkspace } from "./app-test-harness";

// Compile only the real workflows covered by this isolated suite.
import "./TasksView";

describe("corporate workspace authentication alpha", () => {
  it("creates a task after authentication", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    // Flush the real lazy module's asynchronous transition on a cold file.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
      await import("./TasksView");
    });
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

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
      await import("./TasksView");
    });
    // This suite must work cold, without an earlier task scenario warming React.lazy.
    fireEvent.click((await screen.findAllByRole("button", { name: /^Открыть задачу:/ }))[0]!);
    fireEvent.click(await screen.findByRole("button", { name: "Удалить задачу" }));
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
});
