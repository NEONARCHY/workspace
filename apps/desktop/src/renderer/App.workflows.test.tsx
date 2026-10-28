import { dropSpatialCard, installSpatialGeometry } from "./spatial-test-helpers";
import { fireEvent, screen, waitFor, within, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { people, initialTasks } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, mockServer, clickWithFocus, loginToWorkspace, selectPaymentDirection, response } from "./app-test-harness";

// Compile only the real workflows covered by this isolated suite.
import "./ApprovalsView";
import "./EmployeesView";
import "./ProjectHubView";
import "./ProjectsView";
import "./TripApprovalsView";
import "./FeedView";
import "./CalendarView";

describe("corporate workspace authentication alpha", () => {
  it("submits the complete payment card and publishes a workflow version", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika", "payment_requests");
    expect(screen.getByRole("navigation").closest(".app-shell")).not.toHaveClass("approval-shell");
    const approvalFilters = await screen.findByRole("group", { name: "Фильтр заявок" });
    expect(within(approvalFilters).getByRole("button", { name: "В работе" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Сводка заявок")).not.toBeInTheDocument();
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
    expect(card).toHaveTextContent("Субсидия · первый заместитель председателя");
    fireEvent.click(screen.getByRole("button", { name: "Новая заявка" }));
    fireEvent.click(screen.getByLabelText("проект"));
    fireEvent.click(await screen.findByRole("option", { name: "SUB · Субсидия" }));
    expect(screen.getByText(/этап руководства согласует первый заместитель председателя Аскар Маматханов/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("проект"));
    fireEvent.click(screen.getByRole("option", { name: "WS-26 · Workspace" }));
    expect(screen.queryByText(/этап руководства согласует первый заместитель председателя Аскар Маматханов/)).not.toBeInTheDocument();
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
      "Гранты",
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
      "Почта",
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

  it("shows the calendar API conflict in the creation form and preserves the draft", async () => {
    const fetchMock = mockServer();
    const original = fetchMock.getMockImplementation()!;
    const reason = "Невозможно назначить мероприятие: заняты Тестовый сотрудник. Выберите другое время.";
    fetchMock.mockImplementation(async (input, options) => {
      if (String(input).endsWith("/calendar/events") && options?.method === "POST") {
        return response({ detail: reason }, 409);
      }
      return original(input, options);
    });
    render(<App />);
    await loginToWorkspace("aziza", "home");
    clickWithFocus(within(document.querySelector(".app-rail")!).getByRole("button", { name: "Календарь" }));
    clickWithFocus(await screen.findByRole("button", { name: "Новое событие" }));
    const dialog = await screen.findByRole("dialog", { name: "Новое мероприятие" });
    const form = within(dialog);
    act(() => form.getByLabelText("Название события").focus());
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-hidden", "true"));
    changeField(form.getByRole("textbox", { name: "Название события" }), { target: { value: "Тестовая встреча" } });
    fireEvent.click(form.getByRole("button", { name: "Создать мероприятие" }));
    expect(await form.findByRole("alert")).toHaveTextContent(reason);
    expect(form.getByRole("textbox", { name: "Название события" })).toHaveValue("Тестовая встреча");
    expect(form.getByRole("button", { name: "Создать мероприятие" })).toBeEnabled();
    expect(form.queryByText("Не удалось создать мероприятие. Повторите попытку.")).not.toBeInTheDocument();
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
