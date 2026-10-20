import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SurveyAnalysisDetail } from "@yuksalish/contracts";
import { App } from "./App";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, response, mockServer, loginToWorkspace } from "./app-test-harness";

describe("corporate workspace authentication alpha", () => {
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

  it("opens the chairman's signature letter from the team metrics", async () => {
    mockServer({ chairmanLogin: true });
    render(<App />);
    await loginToWorkspace("malika", "home");
    const metrics = screen.getByRole("region", { name: "Ключевые показатели команды" });
    const signatures = within(metrics).getByRole("button", { name: /Письма на подпись/ });
    await waitFor(() => expect(signatures).toHaveTextContent("1"));
    expect(within(metrics).getAllByRole("button")).toHaveLength(7);
    fireEvent.click(signatures);
    fireEvent.click(within(screen.getByRole("region", { name: "Письма, ожидающие вашей подписи" })).getByRole("button", { name: /Письмо из обзора команды/ }));
    expect(await screen.findByRole("dialog", { name: /Письмо из обзора команды/ })).toBeInTheDocument();
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
