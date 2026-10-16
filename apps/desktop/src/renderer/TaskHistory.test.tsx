import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TaskHistoryPage } from "@yuksalish/contracts";
import { TaskHistory } from "./TaskHistory";
import { loadTaskHistory } from "./workspace-api";

vi.mock("./workspace-api", () => ({ loadTaskHistory: vi.fn() }));
vi.mock("./EmployeeProfileLink", () => ({ EmployeeProfileLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const revision = {};
const page: TaskHistoryPage = {
  historyComplete: false, nextOffset: null,
  events: [{ id: "approved", kind: "deadline_approved", occurredAt: "2026-10-10T10:00:00Z",
    actorUserId: "manager", actorName: "Руководитель", oldDueAt: "2026-10-11T10:00:00Z",
    dueAt: "2026-10-20T10:00:00Z", reason: "Нужны данные от отдела" }],
};

it("loads on expansion and shows who approved, both deadlines, reason and incomplete history notice", async () => {
  vi.mocked(loadTaskHistory).mockResolvedValue(page);
  render(<TaskHistory token="test" taskId="task" revision={revision} />);
  expect(loadTaskHistory).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Маршрут и история" }));
  expect(await screen.findByText("Перенос срока одобрен")).toBeTruthy();
  expect(screen.getByText("Руководитель")).toBeTruthy();
  expect(screen.getByText("Нужны данные от отдела")).toBeTruthy();
  expect(screen.getByText(/Срок:.*11\.10\.2026.*20\.10\.2026/)).toBeTruthy();
  expect(screen.getByText(/Ранние действия могли не фиксироваться/)).toBeTruthy();
  expect(loadTaskHistory).toHaveBeenCalledWith("test", "task", 0);
});

it("shows a retryable error without inventing history", async () => {
  vi.mocked(loadTaskHistory).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(page);
  render(<TaskHistory token="test" taskId="task" revision={revision} />);
  fireEvent.click(screen.getByRole("button", { name: "Маршрут и история" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("Перенос срока одобрен")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("Перенос срока одобрен")).toBeTruthy();
});

it("appends older pages and refreshes from newest after task updates", async () => {
  vi.mocked(loadTaskHistory).mockResolvedValueOnce({ ...page, nextOffset: 50 })
    .mockResolvedValueOnce({ ...page, events: [{ id: "created", kind: "task_created", occurredAt: "2026-10-01T10:00:00Z" }] })
    .mockResolvedValue(page);
  const view = render(<TaskHistory token="test" taskId="task" revision={revision} />);
  fireEvent.click(screen.getByRole("button", { name: "Маршрут и история" }));
  fireEvent.click(await screen.findByRole("button", { name: "Показать более ранние события" }));
  expect(await screen.findByText("Задача поставлена")).toBeTruthy();
  expect(screen.getByText("Перенос срока одобрен")).toBeTruthy();
  view.rerender(<TaskHistory token="test" taskId="task" revision={{ changed: true }} />);
  await waitFor(() => expect(loadTaskHistory).toHaveBeenLastCalledWith("test", "task", 0));
});

it("ignores late responses after navigating to another task", async () => {
  let resolve!: (value: TaskHistoryPage) => void;
  vi.mocked(loadTaskHistory).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValueOnce({ historyComplete: true, events: [] });
  const view = render(<TaskHistory key="old" token="test" taskId="old" revision={revision} />);
  fireEvent.click(screen.getByRole("button", { name: "Маршрут и история" }));
  view.rerender(<TaskHistory key="new" token="test" taskId="new" revision={revision} />);
  fireEvent.click(screen.getByRole("button", { name: "Маршрут и история" }));
  resolve(page);
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  expect(screen.queryByText("Перенос срока одобрен")).toBeNull();
});
