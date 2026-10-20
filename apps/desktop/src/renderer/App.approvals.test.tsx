import { dropSpatialCard, installSpatialGeometry } from "./spatial-test-helpers";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { people } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, mockServer, clickWithFocus, loginToWorkspace, selectPaymentDirection } from "./app-test-harness";

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
});
