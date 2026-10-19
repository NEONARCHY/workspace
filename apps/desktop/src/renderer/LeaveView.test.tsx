import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { LeaveRequest } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveView } from "./LeaveView";

const api = vi.hoisted(() => ({
  loadLeaves: vi.fn(), loadContext: vi.fn(), create: vi.fn(), revise: vi.fn(),
  reviewHr: vi.fn(), previewHrOrder: vi.fn(), saveRules: vi.fn(), reviewDeputy: vi.fn(), withdraw: vi.fn(), document: vi.fn(), signature: vi.fn(),
}));
vi.mock("./workspace-api", () => ({
  loadWorkspaceLeaves: api.loadLeaves,
  loadWorkspaceLeaveContext: api.loadContext,
  createWorkspaceLeave: api.create,
  reviseWorkspaceLeave: api.revise,
  reviewWorkspaceLeaveHr: api.reviewHr,
  previewWorkspaceLeaveHrOrder: api.previewHrOrder,
  saveWorkspaceLeaveTenureRules: api.saveRules,
  reviewWorkspaceLeaveDeputy: api.reviewDeputy,
  withdrawWorkspaceLeave: api.withdraw,
  loadWorkspaceLeaveDocument: api.document,
  saveWorkspaceLeaveSignature: api.signature,
}));
vi.mock("./FileViewer", () => ({ ExternalFileViewer: () => <div>Встроенный просмотр</div> }));

const employee = { id: "employee", name: "Тестова Зебо", initials: "ТЗ", role: "employee", jobTitle: "бош мутахассис", color: "#008fa0" };
const deputy = { id: "deputy", name: "Тестов Али", initials: "ТА", role: "employee", color: "#008fa0" };
const request: LeaveRequest = {
  id: "leave-1", requesterUserId: "employee", applicationText: "Менга меҳнат таътили беришингизни сўрайман.",
  requestedStartsOn: "2026-11-19", requestedEndsOn: null,
  startsOn: null, endsOn: null, workYearStartsOn: null, workYearEndsOn: null,
  calendarDays: null, paidDays: null, tenureAdditionalDays: null, organizationEmploymentDate: null, returnOn: null, accountingOfficer: null,
  orderEmployeeName: null, orderJobTitle: null, orderSignerName: null,
  orderClause1: null, orderClause2: null, orderClause3: null,
  status: "pending_hr", statusLabel: "На проверке кадровой службы", orderNumber: null,
  orderYear: null, signedByUserId: null, approvedAt: null,
  canRevise: false, canReviewHr: true, canReviewDeputy: false,
  canWithdraw: false, hasOrder: false, actions: [],
  createdAt: "2026-10-16T10:00:00Z", updatedAt: "2026-10-16T10:00:00Z",
};

function view(currentUserId = "employee") {
  return render(<FluentProvider theme={webLightTheme}><LeaveView token="test-token"
    people={[employee, deputy]} currentUserId={currentUserId} canCreate /></FluentProvider>);
}

beforeEach(() => {
  api.loadLeaves.mockResolvedValue([]);
  api.loadContext.mockResolvedValue({ hrUserId: "hr", deputyUserId: "deputy", canConfigureSignature: false, signatureReady: false,
    tenureRules: [{ afterYears: 5, extraDays: 2 }, { afterYears: 10, extraDays: 4 }, { afterYears: 15, extraDays: 6 }], canEditTenureRules: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LeaveView", () => {
  it("shows the leave application example beside the editor without changing the draft", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Новое заявление" }));
    const editor = screen.getByRole("textbox", { name: "Текст заявления" });
    fireEvent.change(editor, { target: { value: "Мой текст заявления" } });
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть пример аризы" }));
    const example = screen.getByRole("region", { name: "Пример аризы на отпуск" });
    expect(example).toHaveTextContent("АРИЗА");
    expect(example).toHaveTextContent("раисининг биринчи ўринбосари — ижрочи директор Тестов Алига");
    expect(example).toHaveTextContent("«Юксалиш» ҳаракати бош мутахассис Тестова Зебодан");
    fireEvent.click(screen.getByRole("button", { name: "Предпросмотр текста" }));
    const preview = screen.getByRole("region", { name: "Предпросмотр заявления" });
    expect(preview).toHaveTextContent("раисининг биринчи ўринбосари — ижрочи директор Тестов Алига");
    expect(preview).toHaveTextContent("«Юксалиш» ҳаракати бош мутахассис Тестова Зебодан");
    expect(preview).toHaveTextContent("Мой текст заявления");
    expect(editor).toHaveValue("Мой текст заявления");
    expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть пример аризы" }));
    expect(screen.queryByRole("region", { name: "Пример аризы на отпуск" })).not.toBeInTheDocument();
  });

  it("keeps the employee's text after a failed submission and needs no drawn signature", async () => {
    api.create.mockRejectedValue(new Error("Сервер временно недоступен"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Новое заявление" }));
    expect(screen.queryByText(/нарисуйте подпись/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Предполагаемое начало/), { target: { value: "2026-11-19" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Текст заявления" }), { target: { value: "Прошу отпуск" } });
    fireEvent.click(screen.getByRole("button", { name: "Отправить кадрам" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер временно недоступен");
    expect(screen.getByRole("textbox", { name: "Текст заявления" })).toHaveValue("Прошу отпуск");
    expect(api.create).toHaveBeenCalledWith("test-token", {
      applicationText: "Прошу отпуск", startsOn: "2026-11-19", endsOn: null,
    });
  });

  it("shows HR review with manual order fields and the private PDF viewer", async () => {
    api.loadLeaves.mockResolvedValue([request]);
    view("hr");
    fireEvent.click(await screen.findByRole("button", { name: /Тестова Зебо.*На проверке/ }));
    expect(screen.getByText("Проверка кадровой службы")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Номер приказа (без «-сон а/ф»)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Заявление PDF" }));
    expect(screen.getByText("Встроенный просмотр")).toBeInTheDocument();
  });

  it("lets HR select organization-only tenure days and preview edited order before approval", async () => {
    api.loadLeaves.mockResolvedValue([{ ...request, organizationEmploymentDate: "2019-11-01" }]);
    api.previewHrOrder.mockResolvedValue(new Blob(["pdf"], { type: "application/pdf" }));
    view("hr");
    fireEvent.click(await screen.findByRole("button", { name: /Тестова Зебо.*На проверке/ }));
    expect(screen.getByText(/положено 2 дн/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Добавить дней по стажу" }), { target: { value: "2" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Пункт 2 (необязательно)" }), { target: { value: "Исправленный пункт" } });
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть проект приказа PDF" }));
    await waitFor(() => expect(api.previewHrOrder).toHaveBeenCalledWith("test-token", "leave-1",
      expect.objectContaining({ tenureAdditionalDays: 2, orderClause2: "Исправленный пункт" })));
    expect(screen.getByText("Встроенный просмотр")).toBeInTheDocument();
    expect(api.reviewHr).not.toHaveBeenCalled();
  });

  it("lets the appointed HR reviewer correct the application without creating a new request", async () => {
    api.loadLeaves.mockResolvedValue([{ ...request, canRevise: true }]);
    api.revise.mockResolvedValue({ ...request, applicationText: "Текст после правки", canRevise: true });
    view("hr");
    fireEvent.click(await screen.findByRole("button", { name: /Тестова Зебо.*На проверке/ }));
    fireEvent.click(screen.getByRole("button", { name: "Исправить заявление" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Текст заявления" }), { target: { value: "Текст после правки" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить исправления кадровика" }));
    await waitFor(() => expect(api.revise).toHaveBeenCalledWith("test-token", "leave-1",
      expect.objectContaining({ applicationText: "Текст после правки" })));
    expect(api.create).not.toHaveBeenCalled();
  });

  it("routes the deputy's approval through the protected decision action", async () => {
    const pending = { ...request, status: "pending_deputy" as const, statusLabel: "На утверждении первого заместителя",
      startsOn: "2026-11-19", endsOn: "2026-12-09", orderNumber: "10", canReviewHr: false, canReviewDeputy: true };
    api.loadLeaves.mockResolvedValue([pending]);
    api.loadContext.mockResolvedValue({ hrUserId: "hr", deputyUserId: "deputy", canConfigureSignature: true, signatureReady: true });
    api.reviewDeputy.mockResolvedValue({ ...pending, status: "approved", canReviewDeputy: false, hasOrder: true });
    view("deputy");
    fireEvent.click(await screen.findByRole("button", { name: /Тестова Зебо.*На утверждении/ }));
    fireEvent.click(screen.getByRole("button", { name: "Утвердить и подписать приказ" }));
    await waitFor(() => expect(api.reviewDeputy).toHaveBeenCalledWith("test-token", "leave-1", { action: "approve", comment: "", expectedUpdatedAt: request.updatedAt }));
  });

  it("opens the current application text for editing when reached from a notification", async () => {
    api.loadLeaves.mockResolvedValue([{ ...request, canRevise: true }]);
    render(<FluentProvider theme={webLightTheme}><LeaveView token="test-token" people={[employee, deputy]}
      currentUserId="hr" canCreate focusRequestId={request.id} /></FluentProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Исправить заявление" }));
    expect(screen.getByRole("textbox", { name: "Текст заявления" })).toHaveValue(request.applicationText);
    expect(screen.getByLabelText(/Предполагаемое начало/)).toHaveValue(request.requestedStartsOn);
  });

  it("does not give an old HR form a new revision after refreshing the list", async () => {
    api.loadLeaves.mockResolvedValue([request]);
    api.previewHrOrder.mockRejectedValue(new Error("Заявление уже изменилось"));
    view("hr");
    fireEvent.click(await screen.findByRole("button", { name: /Тестова Зебо.*На проверке/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Пункт 2 (необязательно)" }), { target: { value: "Моя правка" } });
    api.loadLeaves.mockResolvedValue([{ ...request, updatedAt: "2026-10-17T10:00:00Z" }]);
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    expect(await screen.findByText(/Заявление изменилось после открытия формы/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Посмотреть проект приказа PDF" }));
    await waitFor(() => expect(api.previewHrOrder).toHaveBeenCalledWith("test-token", request.id,
      expect.objectContaining({ expectedUpdatedAt: request.updatedAt, orderClause2: "Моя правка" })));
    expect(await screen.findByRole("alert")).toHaveTextContent("Заявление уже изменилось");
    expect(screen.getByRole("textbox", { name: "Пункт 2 (необязательно)" })).toHaveValue("Моя правка");
  });
});
