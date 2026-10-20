import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluentProvider } from "@fluentui/react-components";
import { workspaceTheme } from "./workspace-theme";
import type { EdoIncomingLetter, WorkspacePerson } from "@yuksalish/contracts";
import { IncomingLettersView } from "./IncomingLettersView";
import {
  addEdoIncomingAssignment, completeEdoIncomingLetter, loadEdoIncomingLetter,
  loadEdoIncomingLetters, downloadEdoIncomingAttachment, loadEdoIncomingOfficePreview,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  addEdoIncomingAssignment: vi.fn(), completeEdoIncomingLetter: vi.fn(),
  downloadEdoIncomingAttachment: vi.fn(), loadEdoIncomingLetter: vi.fn(),
  loadEdoIncomingLetters: vi.fn(), loadEdoIncomingOfficePreview: vi.fn(),
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
  return render(<FluentProvider theme={workspaceTheme}><IncomingLettersView token="test-token" people={people} currentUserId="current" canEdit={canEdit} /></FluentProvider>);
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

  it("uses the shared viewer and the authorized EDO Office route only after opening a file", async () => {
    vi.mocked(loadEdoIncomingLetter).mockResolvedValue({ data: {
      ...letter, attachments: [{ id: "external-doc", name: "Ответ.docx", size: 2000 }],
    }, deadline_timezone_verified: false });
    vi.mocked(loadEdoIncomingOfficePreview).mockResolvedValue({ kind: "word", blocks: [{ kind: "paragraph", text: "Текст оригинала ЭДО", rows: [] }], sheets: [], sheetIndex: 0, rowOffset: 0, totalRows: 0, rows: [], truncated: false });
    show(); await openLetter();
    expect(loadEdoIncomingOfficePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Просмотреть" }));
    expect(await screen.findByText("Текст оригинала ЭДО")).toBeInTheDocument();
    expect(loadEdoIncomingOfficePreview).toHaveBeenCalledWith("test-token", 17, "external-doc", 0, 0, expect.any(AbortSignal));
    expect(downloadEdoIncomingAttachment).not.toHaveBeenCalled();
    expect(document.querySelector("iframe")).toBeNull();
    const signal = vi.mocked(loadEdoIncomingOfficePreview).mock.calls[0]![5]!;
    fireEvent.click(screen.getByRole("button", { name: "Закрыть просмотрщик" }));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows status tones independently of selection and filters through a styled listbox", async () => {
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue({ ...page, data: [
      { ...letter, status: null }, { ...letter, id: 18, in_num: "EX-18", status: 1 },
      { ...letter, id: 19, in_num: "EX-19", status: 2 }, { ...letter, id: 20, in_num: "EX-20", status: 3 },
    ] });
    show();
    expect(await screen.findByRole("button", { name: /EX-17/ })).toHaveAttribute("data-status", "new");
    expect(screen.getByRole("button", { name: /EX-18/ })).toHaveAttribute("data-status", "1");
    expect(screen.getByRole("button", { name: /EX-19/ })).toHaveAttribute("data-status", "2");
    expect(screen.getByRole("button", { name: /EX-20/ })).toHaveAttribute("data-status", "3");
    fireEvent.click(screen.getByRole("combobox", { name: "Состояние" }));
    expect(screen.getByRole("listbox")).toHaveClass("workspace-select-listbox");
    fireEvent.click(screen.getByRole("option", { name: "Выполнено" }));
    await waitFor(() => expect(loadEdoIncomingLetters).toHaveBeenLastCalledWith("test-token", expect.objectContaining({ status: "completed", page: 1 })));
  });

  it("adds the next executor with the current version and keeps the original visible", async () => {
    vi.mocked(addEdoIncomingAssignment).mockResolvedValue({ data: {
      ...letter, version: 5, assignments: [...letter.assignments, {
        user_id: 102, employee_id: "next", queue: 1, assigned_at_legacy: null, viewed: false,
      }],
    }, deadline_timezone_verified: false });
    show();
    await openLetter();
    fireEvent.click(screen.getByRole("combobox", { name: "Передать следующему исполнителю" }));
    fireEvent.click(screen.getByRole("option", { name: "Следующий исполнитель" }));
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Подтвердить выполнение" })).toBeEnabled());
    expect(completeEdoIncomingLetter).toHaveBeenCalledTimes(1);
  });

  it("does not offer writes without module edit permission", async () => {
    show(false);
    await openLetter();
    expect(screen.queryByRole("button", { name: "Добавить исполнителя" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отметить выполненным" })).not.toBeInTheDocument();
  });

  it("shows full-read scope without granting execution or access administration", async () => {
    vi.mocked(loadEdoIncomingLetters).mockResolvedValue({ ...page, visibility: "all" });
    vi.mocked(loadEdoIncomingLetter).mockResolvedValue({
      data: { ...letter, assignments: [] }, deadline_timezone_verified: false, visibility: "all",
    });
    show();
    await openLetter();
    expect(screen.getByText(/Все входящие письма/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Доступ к письмам" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Добавить исполнителя" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отметить выполненным" })).not.toBeInTheDocument();
  });
});
