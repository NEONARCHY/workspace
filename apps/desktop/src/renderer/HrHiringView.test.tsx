import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HiringDetail, HiringFields, HiringRegistry } from "@yuksalish/contracts";
import type * as WorkspaceApi from "./workspace-api";
import { HrHiringView } from "./HrHiringView";
import { ApiHttpError, actHiringCase, loadHiringCase, loadHiringRegistry, saveHiringCase } from "./workspace-api";

vi.mock("./workspace-api", async (original) => {
  const actual = await original<typeof WorkspaceApi>();
  return { ...actual, loadHiringRegistry: vi.fn(), loadHiringCase: vi.fn(), saveHiringCase: vi.fn(),
    actHiringCase: vi.fn(), uploadHiringDocument: vi.fn(), saveHiringSignature: vi.fn(), downloadHiringDocument: vi.fn() };
});
const fields: HiringFields = { fullName: "Тестовый сотрудник", department: "Тестовый отдел", jobTitle: "Специалист", startDate: "2026-10-12", documentDate: "2026-10-12", contractNumber: "TEST-1", orderNumber: "TEST-2", workType: "primary", term: "indefinite", endDate: null, fixedTermReason: "", probationMonths: 0, probationEligible: false, workRegime: "Нормальный", daysPerWeek: 5, hoursPerWeek: 40, annualLeave: 21, additionalLeave: 0, salaryTerms: "По штатному расписанию", allowances: "", passport: "TEST00000", pinfl: "00000000000000", address: "Тестовый адрес", phone: "+998000000000", additionalTerms: "" };
const item: HiringDetail = { id: "test-case", fullName: fields.fullName, jobTitle: fields.jobTitle, status: "draft", revision: 1, updatedAt: "2026-10-12T00:00:00Z", canEdit: true, canSign: false, fields, applicationBox: { page: 1, x: .58, y: .78, width: .3, height: .1 }, hasApplication: true, applicationPages: 1, hasEmployeeScan: false, returnComment: "", signerName: "Тестовый руководитель", approvedAt: null, documentHashes: {} };
const registry: HiringRegistry = { items: [item], total: 1, canCreate: true, canConfigureSignature: false, signatureReady: true, signerName: item.signerName };
beforeEach(() => {
  vi.mocked(loadHiringRegistry).mockResolvedValue(registry);
  vi.mocked(loadHiringCase).mockResolvedValue(item);
  vi.mocked(saveHiringCase).mockResolvedValue(item);
  vi.mocked(actHiringCase).mockResolvedValue({ ...item, status: "pending", revision: 2, canEdit: false });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount() { render(<FluentProvider theme={webLightTheme}><HrHiringView token="synthetic-token" /></FluentProvider>); }
async function openCase() { fireEvent.click(await screen.findByRole("button", { name: /Тестовый сотрудник/ })); await screen.findByLabelText(/Паспорт \/ ID-карта/); }
async function focusClick(control: HTMLElement) { await act(async () => { control.focus(); }); fireEvent.click(control); }

describe("HR hiring", () => {
  it("loads privately and retains a failed save without claiming success", async () => {
    mount(); await openCase();
    fireEvent.change(screen.getByLabelText(/Фамилия, имя и отчество/), { target: { value: "Исправленное имя" } });
    vi.mocked(saveHiringCase).mockRejectedValueOnce(new ApiHttpError(409, "Версия изменена"));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
    await screen.findByText("Версия изменена");
    expect(screen.getByLabelText(/Фамилия, имя и отчество/)).toHaveValue("Исправленное имя");
    expect(saveHiringCase).toHaveBeenCalledWith("synthetic-token", "test-case", 1,
      expect.objectContaining({ fullName: "Исправленное имя" }), item.applicationBox);
    expect(screen.getByRole("button", { name: "Отправить руководителю" })).toBeDisabled();
  });
  it("never offers another person's signature or signing to a viewing administrator", async () => {
    vi.mocked(loadHiringCase).mockResolvedValue({ ...item, status: "pending", canEdit: false });
    mount(); await openCase();
    expect(screen.queryByRole("button", { name: "Настроить мою подпись" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Подписать пакет" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Паспорт \/ ID-карта/)).toBeDisabled();
  });
  it("requires explicit package review and reuses the request key after an unknown result", async () => {
    vi.mocked(loadHiringCase).mockResolvedValue({ ...item, status: "pending", canEdit: false, canSign: true });
    vi.mocked(actHiringCase).mockRejectedValueOnce(new Error("Связь прервана"));
    mount(); await openCase();
    await focusClick(screen.getByRole("button", { name: "Подписать пакет" }));
    const dialog = await screen.findByRole("dialog", { name: "Подписать весь пакет?" });
    expect(within(dialog).getByRole("button", { name: "Подтвердить" })).toBeDisabled();
    await focusClick(within(dialog).getByRole("checkbox"));
    // fireEvent alone never gives the confirmation the focus of a real click.
    // Keep Tabster's active modal here through the disabled/pending phase.
    await focusClick(within(dialog).getByRole("button", { name: "Подтвердить" }));
    const retry = await within(dialog).findByRole("button", { name: "Повторить безопасно" });
    await waitFor(() => expect(retry).not.toBeDisabled());
    await waitFor(() => expect(dialog).not.toHaveAttribute("aria-hidden", "true"));
    expect(await within(dialog).findByRole("button", { name: "Отмена" })).toBeDisabled();
    const first = vi.mocked(actHiringCase).mock.calls[0];
    await focusClick(retry);
    await waitFor(() => expect(actHiringCase).toHaveBeenCalledTimes(2));
    expect(vi.mocked(actHiringCase).mock.calls[1]).toEqual(first);
  });
  it("shows retryable loading errors and does not expose an empty working form", async () => {
    vi.mocked(loadHiringRegistry).mockRejectedValueOnce(new Error("HR временно недоступен"));
    mount(); await screen.findByText("HR временно недоступен");
    expect(screen.queryByLabelText("JSHSHIR — 14 цифр")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
    await screen.findByRole("button", { name: "Новый приём" });
  });
});
