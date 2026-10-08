import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EdoIncomingLetter, WorkspacePerson } from "@yuksalish/contracts";
import { IncomingLettersView } from "./IncomingLettersView";
import {
  addEdoIncomingAssignment, completeEdoIncomingLetter, loadEdoIncomingLetter,
  loadEdoIncomingLetters,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  addEdoIncomingAssignment: vi.fn(), completeEdoIncomingLetter: vi.fn(),
  downloadEdoIncomingAttachment: vi.fn(), loadEdoIncomingLetter: vi.fn(),
  loadEdoIncomingLetters: vi.fn(),
}));

const people: readonly WorkspacePerson[] = [
  { id: "current", name: "Текущий исполнитель", initials: "ТИ", role: "employee", color: "teal", status: "active" },
  { id: "next", name: "Следующий исполнитель", initials: "СИ", role: "employee", color: "blue", status: "active" },
];
const letter: EdoIncomingLetter = {
  id: 17, version: 4, status: 1, in_num: "EX-17", in_date: "2026-10-01 00:00:00",
  out_num: null, out_date: null, organization: "Организация", region: "Ташкент",
  description: "Подготовить ответ", deadline: "2026-10-04 00:00:00", deadline2: null,
  type: null, comment: null, result: null, result_time: null, legacy_dates_timezone: "unknown",
  assignments: [{ user_id: 101, employee_id: "current", queue: 0, assigned_at_legacy: null, viewed: true }],
  attachments: [], overdue: null,
};
const page = { data: [letter], meta: { page: 1, limit: 20, total: 1 }, deadline_timezone_verified: false };

function show(canEdit = true) {
  return render(<IncomingLettersView token="test-token" people={people} currentUserId="current" canEdit={canEdit} />);
}

async function openLetter() {
  fireEvent.click(await screen.findByRole("button", { name: /EX-17/ }));
  await screen.findByRole("heading", { name: "Краткая информация" });
}

describe("incoming EDO letters", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue(page);
    vi.mocked(loadEdoIncomingLetter).mockResolvedValue({ data: letter, deadline_timezone_verified: false });
  });
  afterEach(cleanup);

  it("shows only the server-returned letters and never guesses overdue status", async () => {
    show();
    await openLetter();
    expect(screen.getByText(/ожидает сверки часового пояса/)).toBeInTheDocument();
    expect(screen.getAllByText("Подготовить ответ")).toHaveLength(2);
    expect(screen.getByText(/Полный текст хранится в оригинальном документе/)).toBeInTheDocument();
    expect(addEdoIncomingAssignment).not.toHaveBeenCalled();
    expect(completeEdoIncomingLetter).not.toHaveBeenCalled();
  });

  it("adds the next executor with the current version and keeps the original visible", async () => {
    vi.mocked(addEdoIncomingAssignment).mockResolvedValue({ data: {
      ...letter, version: 5, assignments: [...letter.assignments, {
        user_id: 102, employee_id: "next", queue: 1, assigned_at_legacy: null, viewed: false,
      }],
    }, deadline_timezone_verified: false });
    show();
    await openLetter();
    fireEvent.change(screen.getByRole("combobox", { name: "Передать следующему исполнителю" }), {
      target: { value: "next" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Добавить исполнителя" }));
    await waitFor(() => expect(addEdoIncomingAssignment).toHaveBeenCalledWith(
      "test-token", 17, 4, "next", expect.any(String),
    ));
    expect(await screen.findByText("Следующий исполнитель")).toBeInTheDocument();
    expect(screen.getByText("Текущий исполнитель")).toBeInTheDocument();
  });

  it("confirms completing the whole letter and omits an empty optional result", async () => {
    vi.mocked(completeEdoIncomingLetter).mockResolvedValue({
      data: { ...letter, version: 5, status: 2 }, deadline_timezone_verified: false,
    });
    show();
    await openLetter();
    fireEvent.click(screen.getByRole("button", { name: "Отметить выполненным" }));
    expect(screen.getByText(/завершит всё письмо для всех исполнителей/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выполнение" }));
    await waitFor(() => expect(completeEdoIncomingLetter).toHaveBeenCalledWith(
      "test-token", 17, 4, expect.any(String), undefined,
    ));
    expect(await screen.findByText("Выполнено исполнителем")).toBeInTheDocument();
  });

  it("preserves the draft and locks writes until a failed action is reconciled", async () => {
    vi.mocked(completeEdoIncomingLetter).mockRejectedValue(new Error("Результат действия неизвестен"));
    show();
    await openLetter();
    fireEvent.change(screen.getByRole("textbox", { name: /Результат/ }), {
      target: { value: "Работа выполнена" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отметить выполненным" }));
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить выполнение" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Результат действия неизвестен");
    expect(screen.getByRole("textbox", { name: /Результат/ })).toHaveValue("Работа выполнена");
    expect(screen.getByRole("button", { name: "Подтвердить выполнение" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Проверить состояние письма" }));
    await waitFor(() => expect(loadEdoIncomingLetter).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Подтвердить выполнение" })).toBeEnabled();
    expect(completeEdoIncomingLetter).toHaveBeenCalledTimes(1);
  });

  it("does not offer writes without module edit permission", async () => {
    show(false);
    await openLetter();
    expect(screen.queryByRole("button", { name: "Добавить исполнителя" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отметить выполненным" })).not.toBeInTheDocument();
  });
});
