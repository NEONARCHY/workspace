import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";
import { initialTasks } from "./test-fixtures/demo-data";
import { changeField } from "./test-fixtures/rich-editor";
import { render, mockServer, loginToWorkspace } from "./app-test-harness";

describe("corporate workspace authentication alpha", () => {
  it("lets an administrator delete an active task after confirmation", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("malika");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Удалить задачу" }));
    const confirmation = await screen.findByRole("dialog", { name: "Удалить задачу?" });
    fireEvent.click(within(confirmation).getByText("Удалить").closest("button")!);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/tasks\/[^/]+$/),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    await waitFor(() => expect(screen.queryAllByRole("dialog")).toHaveLength(0));
  });

  it("explains task sections and uploads files from the task dropzone", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    // This test also runs alone, before the lazy Tasks module is warm.
    fireEvent.click((await screen.findAllByRole("button", { name: /^Открыть задачу:/ }, { timeout: 10_000 }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Справка: Чек-лист" }));
    expect(await screen.findByText(/Отмечайте выполненные пункты по мере работы/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText(/Отмечайте выполненные пункты по мере работы/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть задачу" })).toBeInTheDocument();
    expect(screen.getByText("Перетащите файлы сюда")).toBeInTheDocument();

    fireEvent.drop(screen.getByText("Перетащите файлы сюда").closest(".ws-file-dropzone")!, {
      dataTransfer: { files: [new File(["report"], "report.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/attachments/task/"),
      expect.objectContaining({ method: "PUT" }),
    ));
    expect(await screen.findByText("report.txt")).toBeInTheDocument();
  }, 30_000);

  it("creates a subtask from the task card", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(screen.getAllByRole("button", { name: /^Открыть задачу:/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Команда и настройки задачи" }));
    fireEvent.click(screen.getByRole("button", { name: "Добавить подзадачу" }));
    changeField(screen.getByRole("textbox", { name: "Название подзадачи" }), {
      target: { value: "Сверить итоговые цифры" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать подзадачу" }));
    expect((await screen.findAllByText("Сверить итоговые цифры")).length).toBeGreaterThan(0);
  });

  it("runs result review with a motivated return", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 10_000 }));
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();
    expect(screen.getByText("Ожидает решения")).toBeInTheDocument();
    expect(screen.getByText("Результат отправлен. Ожидает решения постановщика.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Вернуть на доработку" }));
    changeField(screen.getByRole("textbox", { name: "Пояснение причины" }), {
      target: { value: "Добавьте номер договора" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Вернуть исполнителям" }));
    await waitFor(() => expect(screen.getByText("Добавьте номер договора", { selector: "p" })).toBeInTheDocument());
    expect(screen.getByText("Нужны исправления")).toBeInTheDocument();

    changeField(await screen.findByRole("textbox", { name: "Результат задачи" }), {
      target: { value: "Номер договора добавлен" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Завершить и отправить на проверку" }));
    await waitFor(() => expect(screen.getByText("Ожидает решения")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Утвердить результат" })).not.toBeInTheDocument();

    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    render(<App />);
    await loginToWorkspace("baxtiyor");
    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 10_000 }));
    fireEvent.click(await screen.findByRole("button", { name: "Утвердить результат" }, { timeout: 20_000 }));
    expect(await screen.findByText("Принято")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/accept-result"),
      expect.objectContaining({ method: "POST" }),
    );
  }, 60_000);

  it("does not offer result acceptance to a manager who is not the task author", async () => {
    mockServer();
    render(<App />);
    await loginToWorkspace("aziza");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[1]!.title}`,
    }, { timeout: 10_000 }));
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();

    expect(screen.getByRole("button", { name: "Вернуть на доработку" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Утвердить результат" })).not.toBeInTheDocument();
  });

  it("shows the executor's result actions without the former payment shortcut", async () => {
    const fetchMock = mockServer();
    render(<App />);
    await loginToWorkspace("dilshod");

    fireEvent.click(screen.getByRole("button", { name: "Задачи" }));
    fireEvent.click(await screen.findByRole("button", {
      name: `Открыть задачу: ${initialTasks[0]!.title}`,
    }, { timeout: 10_000 }));
    // DOM tests have no layout for Tabster's automatic focus search. Establish
    // focus inside the modal, as the browser does, before its delayed ARIA update.
    screen.getByRole("button", { name: "Закрыть задачу" }).focus();
    expect(screen.queryByRole("button", { name: "Создать заявку на оплату" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Завершить и отправить на проверку" })).toBeDisabled();
    changeField(screen.getByLabelText("Файлы результата"), {
      target: { files: [new File(["report"], "result.txt", { type: "text/plain" })] },
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/attachments/task/"),
      expect.objectContaining({ method: "PUT" }),
    ));
    // The request is recorded before the uploaded file and dialog finish rendering.
    expect(await screen.findByText("result.txt", {}, { timeout: 10_000 })).toBeInTheDocument();
    const resultInput = await screen.findByRole("textbox", { name: "Результат задачи" }, { timeout: 10_000 });
    expect(resultInput).toBeVisible();
    expect(resultInput.closest('[aria-hidden="true"]')).toBeNull();
    expect(resultInput).toHaveAccessibleName("Результат задачи");
    changeField(resultInput, {
      target: { value: "Работа завершена, файл приложен" },
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Завершить и отправить на проверку" })).toBeEnabled(), { timeout: 10_000 });
  }, 30_000);
});
