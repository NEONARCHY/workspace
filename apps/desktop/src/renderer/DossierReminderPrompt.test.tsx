import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { DossierReminder } from "@yuksalish/contracts";
import type * as Api from "./workspace-api";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DossierReminderPrompt } from "./DossierReminderPrompt";
import { answerDossierReminder, loadDossier, loadDossierHistory, loadDossierReminder, saveDossier } from "./workspace-api";
import { workspaceTheme } from "./workspace-theme";

vi.mock("./workspace-api", async (original) => ({ ...await original<typeof Api>(),
  loadDossierReminder: vi.fn(), answerDossierReminder: vi.fn(), loadDossier: vi.fn(),
  loadDossierHistory: vi.fn(), saveDossier: vi.fn(),
}));
const pending: DossierReminder = { period: "2026-10", dueDate: "2026-10-25", due: true, status: "pending", respondedAt: null };
const fields = { birthDate: null, birthPlace: "", appointmentDate: null, nationality: "", partyMembership: "", educationLevel: "", education: [], employment: [], languages: "", academicDegree: "", academicTitle: "", militaryRank: "", electedMembership: "", awards: "", relatives: [], additionalInfo: "" };
const record = { userId: "self", fullName: "Тестовый Сотрудник", jobTitle: "Специалист", revision: 1, status: "draft" as const, fields, updatedAt: null, permissions: { canView: true, canEdit: true } };
function show(paused = false, key = "self") {
  return render(<FluentProvider theme={workspaceTheme}><DossierReminderPrompt key={key} token="token" userId={key} people={[]} paused={paused} /></FluentProvider>);
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadDossierReminder).mockResolvedValue(pending);
  vi.mocked(answerDossierReminder).mockImplementation(async (_, value) => ({ ...pending, status: value.action, due: value.action === "update_requested", respondedAt: "2026-10-25T09:00:00Z" }));
  vi.mocked(loadDossier).mockResolvedValue(record);
  vi.mocked(loadDossierHistory).mockResolvedValue([]);
});
afterEach(cleanup);

it("uses the server's due flag rather than the computer date and never submits automatically", async () => {
  vi.mocked(loadDossierReminder).mockResolvedValue({ ...pending, due: false });
  show();
  await waitFor(() => expect(loadDossierReminder).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(answerDossierReminder).not.toHaveBeenCalled();
});

it("ignores an incompatible API payload without breaking other workspace modules", async () => {
  vi.mocked(loadDossierReminder).mockResolvedValueOnce({ ...pending, period: "" });
  show();
  await waitFor(() => expect(loadDossierReminder).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.focus(window);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});

it.each(["no_changes", "skipped"] as const)("persists %s and does not repeat it after refocus or remount", async action => {
  const view = show();
  await screen.findByRole("dialog", { name: "Ежемесячная проверка объективки" });
  fireEvent.click(screen.getByRole("button", { name: action === "no_changes" ? "Изменений нет" : "Пропустить" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(answerDossierReminder).toHaveBeenCalledWith("token", { period: "2026-10", action });
  vi.mocked(loadDossierReminder).mockResolvedValue({ ...pending, due: false, status: action });
  fireEvent.focus(window);
  view.unmount(); show();
  await waitFor(() => expect(loadDossierReminder).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("retains the question after a failed response and supports retry", async () => {
  vi.mocked(answerDossierReminder).mockRejectedValueOnce(new Error("Временная ошибка сервера"));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Изменений нет" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Временная ошибка сервера");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Изменений нет" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(answerDossierReminder).toHaveBeenCalledTimes(2);
});

it("blocks duplicate answers while saving and does not optimistically hide the prompt", async () => {
  vi.mocked(answerDossierReminder).mockImplementation(() => new Promise(() => {}));
  show();
  const button = await screen.findByRole("button", { name: "Изменений нет" });
  fireEvent.click(button); fireEvent.click(button);
  expect(answerDossierReminder).toHaveBeenCalledTimes(1);
  expect(button).toBeDisabled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("waits for another modal instead of stealing its focus", async () => {
  const blocker = document.createElement("div");
  blocker.setAttribute("role", "dialog"); blocker.setAttribute("aria-label", "Другая форма");
  document.body.append(blocker);
  show();
  await waitFor(() => expect(loadDossierReminder).toHaveBeenCalled());
  expect(screen.queryByRole("dialog", { name: "Ежемесячная проверка объективки" })).not.toBeInTheDocument();
  blocker.remove();
  expect(await screen.findByRole("dialog", { name: "Ежемесячная проверка объективки" })).toBeInTheDocument();
});

it("opens only the current employee's editor without completing the check-in", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Обновить объективку" }));
  const editor = await screen.findByRole("dialog", { name: "Объективка сотрудника" });
  expect(editor).toBeInTheDocument();
  expect(loadDossier).toHaveBeenCalledWith("token", "self");
  expect(answerDossierReminder).toHaveBeenCalledWith("token", { period: "2026-10", action: "update_requested" });
  expect(saveDossier).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть объективку" }));
  expect(await screen.findByRole("button", { name: "Продолжить проверку" })).toBeInTheDocument();
});

it("re-checks the next server month without requiring logout", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Пропустить" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  vi.mocked(loadDossierReminder).mockResolvedValue({ ...pending, period: "2026-11", dueDate: "2026-11-25" });
  fireEvent.focus(window);
  expect(await screen.findByRole("dialog")).toHaveTextContent("11.2026");
});

it("refreshes completion only after a successful final save, not a draft or failed save", async () => {
  vi.mocked(saveDossier).mockImplementationOnce(async (_, __, value) => ({ ...record, revision: 2, status: "draft", fields: value.fields }))
    .mockRejectedValueOnce(new Error("Ошибка сохранения анкеты"))
    .mockImplementationOnce(async (_, __, value) => {
      vi.mocked(loadDossierReminder).mockResolvedValue({ ...pending, due: false, status: "updated" });
      return { ...record, revision: 3, status: "saved", fields: value.fields };
    });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Обновить объективку" }));
  const field = await screen.findByRole("textbox", { name: "Место рождения" });
  fireEvent.change(field, { target: { value: "Город" } });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить черновик" }));
  await screen.findByText("Объективка сохранена. Версия 2.");
  expect(loadDossierReminder).toHaveBeenCalledTimes(1);
  // Tabster restores the modal's accessibility after focus moves off the disabled form.
  // Text may already be rendered before that asynchronous focus lifecycle completes.
  const finalSave = await screen.findByRole("button", { name: "Сохранить объективку" });
  expect(finalSave).toBeEnabled();
  expect(screen.getByRole("dialog", { name: "Объективка сотрудника" })).not.toHaveAttribute("aria-hidden", "true");
  fireEvent.click(finalSave);
  expect(await screen.findByRole("alert")).toHaveTextContent("Ошибка сохранения анкеты");
  expect(loadDossierReminder).toHaveBeenCalledTimes(1);
  const retrySave = await screen.findByRole("button", { name: "Сохранить объективку" });
  expect(retrySave).toBeEnabled();
  fireEvent.click(retrySave);
  await screen.findByText("Объективка сохранена. Версия 3.");
  await waitFor(() => expect(loadDossierReminder).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Закрыть объективку" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Продолжить проверку" })).not.toBeInTheDocument();
});

it("does not interrupt the workspace after a background API failure and retries on focus", async () => {
  vi.mocked(loadDossierReminder).mockRejectedValueOnce(new Error("API недоступен"));
  show();
  await waitFor(() => expect(loadDossierReminder).toHaveBeenCalled());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  fireEvent.focus(window);
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
});
