import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IncomingDocumentDetail, TaskHistoryPage } from "@yuksalish/contracts";
import { IncomingDocumentActivity } from "./IncomingDocumentActivity";
import { loadTaskHistory } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadTaskHistory: vi.fn() }));
vi.mock("./EmployeeProfileLink", () => ({ EmployeeProfileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
const detail: IncomingDocumentDetail = {
  document: { id: "source", revision: 1, number: "QA", subject: "Письмо", sender: "Организация",
    receivedAt: "2026-11-20T05:00:00Z", registeredAt: "2026-11-20T06:00:00Z", addedAt: "2026-11-21T05:00:00Z",
    source: "exat", filesExpected: false, canAssign: false, canOpenTask: true,
    execution: { taskId: "task", status: "completed", dueAt: null, assigneeId: "executor", assigneeName: "Исполнитель", authorId: "author" } },
  files: [],
};
const page: TaskHistoryPage = { historyComplete: true, nextOffset: null, events: [
  { id: "completed", kind: "task_completed", occurredAt: "2026-11-24T09:00:00Z", actorUserId: "author", actorName: "Руководитель" },
  { id: "submitted", kind: "result_submitted_for_review", occurredAt: "2026-11-23T09:00:00Z", actorUserId: "executor", actorName: "Исполнитель" },
  { id: "created", kind: "task_created", occurredAt: "2026-11-22T09:00:00Z" },
] };
beforeEach(() => { vi.mocked(loadTaskHistory).mockResolvedValue(page); });
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("automatically merges real source and execution events newest first with recorded times and actors", async () => {
  render(<IncomingDocumentActivity token="test" detail={detail} />);
  expect(await screen.findByText("Исполнение завершено")).toBeVisible();
  expect(screen.getByText("Руководитель")).toBeVisible();
  const entries = within(screen.getByRole("list")).getAllByRole("listitem");
  expect(entries.map(entry => entry.querySelector("strong")?.textContent)).toEqual([
    "Исполнение завершено", "Результат передан на проверку", "Назначено исполнение",
    "Добавлено в Workspace", "Зарегистрировано в источнике", "Письмо поступило",
  ]);
  expect(entries[0]?.querySelector("time")).toHaveAttribute("dateTime", "2026-11-24T09:00:00Z");
  expect(loadTaskHistory).toHaveBeenCalledWith("test", "task", 0);
});

it("shows source-only history without requesting a protected task when permission is absent", () => {
  render(<IncomingDocumentActivity token="test" detail={{ ...detail, document: { ...detail.document, canOpenTask: false } }} />);
  expect(screen.getByText("Письмо поступило")).toBeVisible();
  expect(screen.getByText(/История поручения недоступна/)).toBeVisible();
  expect(loadTaskHistory).not.toHaveBeenCalled();
});

it("keeps missing dates unknown instead of inferring completion from the current status", () => {
  render(<IncomingDocumentActivity token="test" detail={{ ...detail, document: {
    ...detail.document, receivedAt: null, registeredAt: null, addedAt: null, canOpenTask: false,
  } }} />);
  expect(screen.getByText("События письма пока не переданы.")).toBeVisible();
  expect(screen.queryByText("Исполнение завершено")).not.toBeInTheDocument();
  expect(loadTaskHistory).not.toHaveBeenCalled();
});

it("retains source events on a history failure, retries, and preserves the partial-history notice", async () => {
  vi.mocked(loadTaskHistory).mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ ...page, historyComplete: false });
  render(<IncomingDocumentActivity token="test" detail={detail} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить историю исполнения");
  expect(screen.getByText("Письмо поступило")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Исполнение завершено")).toBeVisible();
  expect(screen.getByText(/Ранние действия могли не фиксироваться/)).toBeVisible();
});

it("uses the server cursor for older events, deduplicates and refreshes after changes", async () => {
  vi.mocked(loadTaskHistory).mockResolvedValueOnce({ ...page, events: [page.events[0]!], nextOffset: 50 })
    .mockResolvedValueOnce(page).mockResolvedValue(page);
  const view = render(<IncomingDocumentActivity token="test" detail={detail} />);
  fireEvent.click(await screen.findByRole("button", { name: "Показать более ранние события" }));
  expect(await screen.findByText("Назначено исполнение")).toBeVisible();
  expect(screen.getAllByText("Добавлено в Workspace")).toHaveLength(1);
  expect(screen.getAllByText("Исполнение завершено")).toHaveLength(1);
  expect(loadTaskHistory).toHaveBeenLastCalledWith("test", "task", 50);
  view.rerender(<IncomingDocumentActivity token="test" detail={{ ...detail }} />);
  await waitFor(() => expect(loadTaskHistory).toHaveBeenLastCalledWith("test", "task", 0));
});
