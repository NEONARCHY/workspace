import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SurveyAnalysisDetail } from "@yuksalish/contracts";
import { SurveyAnalyticsView } from "./SurveyAnalyticsView";
import { importSurveyAnalysis, listSurveyAnalyses, loadSurveyAnalysis, saveSurveyAnalysis } from "./workspace-api";

vi.mock("./workspace-api", () => ({ importSurveyAnalysis: vi.fn(), listSurveyAnalyses: vi.fn(), loadSurveyAnalysis: vi.fn(), saveSurveyAnalysis: vi.fn(), downloadSurveyOriginal: vi.fn(), exportSurveyWorkbook: vi.fn() }));
const fixture: SurveyAnalysisDetail = {
  analysis: { id: "survey-1", title: "Опрос команды", fileName: "answers.csv", revision: 1, archived: false, createdAt: "2026-10-12T00:00:00Z", updatedAt: "2026-10-12T00:00:00Z", configuration: { sheet: 0, headerRow: 0, types: {}, separator: ";", missingValues: [], query: "", filters: [], savedViews: [] } },
  workbook: { warnings: [], sheets: [{ name: "Ответы", rows: [["Группа", "Возраст"], ["A", "20"], ["B", "30"]] }] },
};
const show = (canCreate = true, canEdit = true) => render(<SurveyAnalyticsView token="test" canCreate={canCreate} canEdit={canEdit} />);
async function open() { fireEvent.click(await screen.findByRole("button", { name: /Опрос команды/ })); await screen.findByRole("textbox", { name: "Название анализа" }); }
describe("private survey workspace", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(listSurveyAnalyses).mockResolvedValue([fixture.analysis]); vi.mocked(loadSurveyAnalysis).mockResolvedValue(fixture); });
  afterEach(cleanup);
  it("mounts the actual survey layout immediately and only skeletons library records", () => {
    vi.mocked(listSurveyAnalyses).mockImplementationOnce(() => new Promise(() => {}));
    const { container } = show();
    expect(screen.getByRole("heading", { name: "Аналитика опросов" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Загрузка опроса" })).toBeVisible();
    expect(screen.getByLabelText("Поиск анализов")).toBeInTheDocument();
    expect(container.querySelectorAll(".survey-library .survey-analysis-item")).toHaveLength(3);
    expect(container.querySelector(".ws-section-skeleton, .is-table, .is-circle")).toBeNull();
    expect(screen.getByRole("status", { name: "Загрузка личных анализов" })).toHaveAttribute("data-skeleton-deferred");
  });
  it("keeps a confirmed empty library during refresh and removes pending placeholders after a fast read", async () => {
    vi.mocked(listSurveyAnalyses).mockResolvedValueOnce([]);
    show();
    const empty = await screen.findByRole("heading", { name: "Пока нет анализов" });
    let finish!: (items: []) => void;
    vi.mocked(listSurveyAnalyses).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Обновить список" }));
    expect(empty).toBeVisible();
    expect(screen.queryByRole("status", { name: "Загрузка личных анализов" })).toBeNull();
    await act(async () => finish([]));
    expect(empty).toBeVisible();
  });
  it("uses product dropdowns and passes the chosen CSV settings only on explicit import", async () => {
    vi.mocked(importSurveyAnalysis).mockResolvedValue(fixture);
    show(); await screen.findByRole("button", { name: /Опрос команды/ });
    const encoding = screen.getByRole("combobox", { name: "Кодировка CSV" });
    const delimiter = screen.getByRole("combobox", { name: "Разделитель столбцов CSV" });
    expect(encoding.tagName).toBe("BUTTON");
    expect(delimiter.tagName).toBe("BUTTON");
    fireEvent.click(encoding);
    fireEvent.click(screen.getByRole("option", { name: "Windows-1251" }));
    fireEvent.click(delimiter);
    fireEvent.click(screen.getByRole("option", { name: "Точка с запятой" }));
    expect(importSurveyAnalysis).not.toHaveBeenCalled();
    const file = new File(["Q;A"], "sample.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Файл опроса"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить и открыть" }));
    await waitFor(() => expect(importSurveyAnalysis).toHaveBeenCalledWith("test", file, expect.any(String), "cp1251", ";"));
  });
  it("opens the author's saved analysis and computes exact source values without a mutation", async () => {
    show(); await open();
    expect(loadSurveyAnalysis).toHaveBeenCalledWith("test", "survey-1");
    expect(screen.getByText(/Ответили:/)).toHaveTextContent("2 из 2");
    expect(saveSurveyAnalysis).not.toHaveBeenCalled();
  });
  it("saves local changes only on explicit confirmation with current revision", async () => {
    vi.mocked(saveSurveyAnalysis).mockResolvedValue({ ...fixture.analysis, title: "Новое название", revision: 2 });
    show(); await open(); fireEvent.change(screen.getByRole("textbox", { name: "Название анализа" }), { target: { value: "Новое название" } });
    expect(saveSurveyAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    await waitFor(() => expect(saveSurveyAnalysis).toHaveBeenCalledWith("test", "survey-1", expect.objectContaining({ expectedRevision: 1, title: "Новое название" })));
    expect(await screen.findByText(/Анализ сохранён приватно/)).toBeInTheDocument();
  });
  it("keeps entered changes after a conflict rather than showing success", async () => {
    vi.mocked(saveSurveyAnalysis).mockRejectedValue(new Error("Версия изменена"));
    show(); await open(); fireEvent.change(screen.getByRole("textbox", { name: "Название анализа" }), { target: { value: "Мой черновик" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить изменения" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Версия изменена");
    expect(screen.getByRole("textbox", { name: "Название анализа" })).toHaveValue("Мой черновик");
  });
  it("does not let read-only users upload or persist changes", async () => {
    show(false, false); await open();
    expect(screen.getByRole("button", { name: "Загрузить и открыть" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Сохранить изменения" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "В архив" })).toBeDisabled();
  });
  it("shows a recoverable list error instead of pretending that it is empty", async () => {
    vi.mocked(listSurveyAnalyses).mockRejectedValueOnce(new Error("Хранилище недоступно"));
    show(); expect(await screen.findByRole("alert")).toHaveTextContent("Хранилище недоступно");
    fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку списка" }));
    expect(await screen.findByRole("button", { name: /Опрос команды/ })).toBeInTheDocument();
  });
  it("does not create another record when retrying an uncertain import", async () => {
    vi.mocked(importSurveyAnalysis).mockRejectedValueOnce(new Error("Таймаут")).mockResolvedValue(fixture);
    show(); await screen.findByRole("button", { name: /Опрос команды/ });
    const file = new File(["Q\nA"], "sample.csv", { type: "text/csv" });
    fireEvent.change(screen.getByLabelText("Файл опроса"), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: "Загрузить и открыть" }));
    await screen.findByRole("alert"); fireEvent.click(screen.getByRole("button", { name: "Загрузить и открыть" }));
    await screen.findByRole("textbox", { name: "Название анализа" });
    expect(vi.mocked(importSurveyAnalysis).mock.calls[0]?.[2]).toBe(vi.mocked(importSurveyAnalysis).mock.calls[1]?.[2]);
  });
  it("searches responses and updates the analysis denominator", async () => {
    show(); await open(); fireEvent.click(screen.getByText("2. Поиск, фильтры и сохранённые срезы"));
    fireEvent.change(screen.getByRole("textbox", { name: "Поиск по всем ответам" }), { target: { value: "A" } });
    expect(screen.getByText(/Ответили:/)).toHaveTextContent("1 из 1");
  });
  it("selects a dropped file without uploading before confirmation", async () => {
    show(); await screen.findByRole("button", { name: /Опрос команды/ });
    const file = new File(["Q\nA"], "dropped.csv", { type: "text/csv" });
    const drop = screen.getByLabelText("Файл опроса").closest("label")!;
    fireEvent.dragOver(drop);
    expect(drop).toHaveAttribute("data-dragging", "true");
    fireEvent.drop(drop, { dataTransfer: { files: [file] } });
    expect(screen.getByText("dropped.csv")).toBeInTheDocument();
    expect(screen.getByText("3 Б · нажмите, чтобы заменить")).toBeInTheDocument();
    expect(drop).toHaveAttribute("data-dragging", "false");
    expect(screen.getByRole("button", { name: "Загрузить и открыть" })).toBeEnabled();
    expect(importSurveyAnalysis).not.toHaveBeenCalled();
  });
  it("rejects unsupported and oversized files before import", async () => {
    show(); await screen.findByRole("button", { name: /Опрос команды/ });
    const input = screen.getByLabelText("Файл опроса");
    fireEvent.change(input, { target: { files: [new File(["text"], "answers.txt")] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Выберите файл CSV, XLSX или XLS");
    const large = new File(["Q"], "large.csv");
    Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [large] } });
    expect(screen.getByRole("alert")).toHaveTextContent("не должен превышать 10 МиБ");
    expect(screen.getByRole("button", { name: "Загрузить и открыть" })).toBeDisabled();
    expect(importSurveyAnalysis).not.toHaveBeenCalled();
  });
  it("does not accept drops without create rights or while an analysis draft is dirty", async () => {
    const view = show(false, false);
    await screen.findByRole("button", { name: /Опрос команды/ });
    const file = new File(["Q\nA"], "blocked.csv");
    fireEvent.drop(screen.getByLabelText("Файл опроса").closest("label")!, { dataTransfer: { files: [file] } });
    expect(screen.queryByText("blocked.csv")).not.toBeInTheDocument();
    view.rerender(<SurveyAnalyticsView token="test" canCreate canEdit />);
    await open();
    fireEvent.change(screen.getByRole("textbox", { name: "Название анализа" }), { target: { value: "Черновик" } });
    fireEvent.drop(screen.getByLabelText("Файл опроса").closest("label")!, { dataTransfer: { files: [file] } });
    expect(screen.queryByText("blocked.csv")).not.toBeInTheDocument();
    expect(importSurveyAnalysis).not.toHaveBeenCalled();
  });
});
