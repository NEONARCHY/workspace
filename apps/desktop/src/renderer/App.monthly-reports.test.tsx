import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import type { MonthlyOverview } from "@yuksalish/contracts";
import { App } from "./App";
import { clickWithFocus, loginToWorkspace, mockServer, render, response } from "./app-test-harness";
import "./TeamDashboardView";

const monthly: MonthlyOverview = {
  today: "2026-11-25", activeMonth: "2026-11-01", dashboardVisible: true,
  canReview: true, canAuthorize: false, canConfigure: false, reminderMonth: null,
  payrollNotice: null, payrollNoticeId: null, reports: [], cycles: [{
    month: "2026-11-01", reminderOn: "2026-11-25", total: 1, submitted: 0,
    authorizedAt: null, authorizedByName: null, comment: "", canSubmit: true,
    members: [{ userId: "aziza", name: "Тестовая Азиза", department: "ЦА", report: null }],
  }],
};
function serverWithMonthly(data = monthly) {
  const server = mockServer();
  const original = server.getMockImplementation()!;
  server.mockImplementation(async (input, options) => {
    if (String(input).endsWith("/monthly-reports")) return response(data);
    return original(input, options);
  });
  return server;
}

it("opens monthly CA statistics in place and returns focus without leaving the team overview", async () => {
  serverWithMonthly();
  render(<App />);
  await loginToWorkspace("malika", "home");
  fireEvent.click(screen.getByRole("button", { name: /^Обзор команды/ }));
  const block = await screen.findByRole("button", { name: /Ойлик ҳисоботлар.*Сдали 0/ });
  clickWithFocus(block);
  const dialog = await screen.findByRole("dialog", { name: "Ойлик ҳисоботлар" });
  expect(within(dialog).getByText("Тестовая Азиза")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Скачать шаблон отчёта" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Разрешить начисление заработной платы" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Вернуться в рабочее пространство" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ойлик ҳисоботлар" })).not.toBeInTheDocument());
  await waitFor(() => expect(block).toHaveFocus());
  expect(screen.getByRole("region", { name: "Обзор команды" })).toBeInTheDocument();
});

it("offers the monthly reports page inside the AI group and follows server capabilities", async () => {
  serverWithMonthly({ ...monthly, canReview: false, dashboardVisible: false,
    cycles: monthly.cycles.map(cycle => ({ ...cycle, members: [] })) });
  render(<App />);
  await loginToWorkspace("aziza", "home");
  fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
  fireEvent.click(await screen.findByRole("button", { name: "Ойлик ҳисоботлар" }));
  expect(await screen.findByRole("heading", { name: "Ойлик ҳисоботлар" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Прикрепить файлы отчёта" })).toBeInTheDocument();
  expect(screen.queryByText("Тестовая Азиза")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Разрешить начисление заработной платы" })).not.toBeInTheDocument();
});
