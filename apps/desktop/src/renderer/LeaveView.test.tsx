import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { LeaveRequest } from "@yuksalish/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeaveView } from "./LeaveView";

const api = vi.hoisted(() => ({
  loadLeaves: vi.fn(), loadContext: vi.fn(), create: vi.fn(), revise: vi.fn(),
  reviewHr: vi.fn(), reviewDeputy: vi.fn(), withdraw: vi.fn(), document: vi.fn(), signature: vi.fn(),
}));
vi.mock("./workspace-api", () => ({
  loadWorkspaceLeaves: api.loadLeaves,
  loadWorkspaceLeaveContext: api.loadContext,
  createWorkspaceLeave: api.create,
  reviseWorkspaceLeave: api.revise,
  reviewWorkspaceLeaveHr: api.reviewHr,
  reviewWorkspaceLeaveDeputy: api.reviewDeputy,
  withdrawWorkspaceLeave: api.withdraw,
  loadWorkspaceLeaveDocument: api.document,
  saveWorkspaceLeaveSignature: api.signature,
}));
vi.mock("./FileViewer", () => ({ ExternalFileViewer: () => <div>Встроенный просмотр</div> }));

const employee = { id: "employee", name: "Тестова Зебо", initials: "ТЗ", role: "employee", jobTitle: "Chief specialist", color: "#008fa0" };
const deputy = { id: "deputy", name: "Тестов Али", initials: "ТА", role: "employee", color: "#008fa0" };
const request: LeaveRequest = {
  id: "leave-1", requesterUserId: "employee", applicationText: "Менга меҳнат таътили беришингизни сўрайман.",
  requestedStartsOn: "2026-11-19", requestedEndsOn: null,
  startsOn: null, endsOn: null, workYearStartsOn: null, workYearEndsOn: null,
  calendarDays: null, paidDays: null, returnOn: null, accountingOfficer: null,
  orderEmployeeName: null, orderJobTitle: null, orderSignerName: null,
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
  api.loadContext.mockResolvedValue({ hrUserId: "hr", deputyUserId: "deputy", canConfigureSignature: false, signatureReady: false });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("LeaveView", () => {
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

  it("routes the deputy's approval through the protected decision action", async () => {
    const pending = { ...request, status: "pending_deputy" as const, statusLabel: "На утверждении первого заместителя",
      startsOn: "2026-11-19", endsOn: "2026-12-09", orderNumber: "10", canReviewHr: false, canReviewDeputy: true };
    api.loadLeaves.mockResolvedValue([pending]);
    api.loadContext.mockResolvedValue({ hrUserId: "hr", deputyUserId: "deputy", canConfigureSignature: true, signatureReady: true });
    api.reviewDeputy.mockResolvedValue({ ...pending, status: "approved", canReviewDeputy: false, hasOrder: true });
    view("deputy");
    fireEvent.click(await screen.findByRole("button", { name: /Тестова Зебо.*На утверждении/ }));
    fireEvent.click(screen.getByRole("button", { name: "Утвердить и подписать приказ" }));
    await waitFor(() => expect(api.reviewDeputy).toHaveBeenCalledWith("test-token", "leave-1", { action: "approve", comment: "" }));
  });
});
