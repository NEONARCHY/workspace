import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { TaskPlansView } from "./TaskPlansView";

const people = [
  { id: "me", name: "Автор", initials: "А", role: "manager" as const, color: "blue", status: "active" as const },
  { id: "owner", name: "Нигора", initials: "Н", role: "employee" as const, color: "blue", status: "active" as const },
];

const plan = {
  id: "plan-1", title: "Недельный план", kind: "work" as const,
  periodStart: null, periodEnd: null, ownerUserId: "owner", status: "active" as const,
  createdByUserId: "me", createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z", taskIds: ["task-1"],
};

afterEach(cleanup);

it("does not create a plan before confirmation and preserves input on failed save", async () => {
  const onCreate = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined);
  render(<FluentProvider theme={webLightTheme}><TaskPlansView
    plans={[]} tasks={[]} loading={false} error="" onRetry={vi.fn()}
    onCreate={onCreate} onSelect={vi.fn()} />
  </FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Новый план" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название" }), {
    target: { value: "Иш режа 2026" },
  });
  expect(onCreate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить план" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить план");
  expect(screen.getByRole("textbox", { name: "Название" })).toHaveValue("Иш режа 2026");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить план" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  expect(onCreate).toHaveBeenLastCalledWith({
    title: "Иш режа 2026", kind: "work", periodStart: null, periodEnd: null,
  });
});

it("opens the selected plan without mutating tasks", () => {
  const onSelect = vi.fn();
  render(<FluentProvider theme={webLightTheme}><TaskPlansView
    plans={[{
      id: "plan-1", title: "Региональный план", kind: "regional",
      periodStart: null, periodEnd: null, ownerUserId: "author", status: "active", createdByUserId: "author",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", taskIds: [],
    }]} tasks={[]} loading={false} error="" onRetry={vi.fn()}
    onCreate={vi.fn()} onSelect={onSelect} />
  </FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Показать задачи" }));
  expect(onSelect).toHaveBeenCalledWith("plan-1");
  expect(screen.queryByText("Выберите регион")).not.toBeInTheDocument();
});

it("defaults the plan owner to the current user and lets the author select another owner", async () => {
  const onCreate = vi.fn().mockResolvedValue(undefined);
  render(<FluentProvider theme={webLightTheme}><TaskPlansView
    plans={[]} tasks={[]} people={people} currentUserId="me" loading={false} error=""
    onRetry={vi.fn()} onCreate={onCreate} onSelect={vi.fn()} />
  </FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Новый план" }));
  expect(screen.getByRole("combobox", { name: "Постановщик" })).toHaveTextContent("Автор");
  fireEvent.click(screen.getByRole("combobox", { name: "Постановщик" }));
  fireEvent.click(await screen.findByRole("option", { name: "Нигора" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название" }), {
    target: { value: "Новый план" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить план" }));
  await waitFor(() => expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
    title: "Новый план", ownerUserId: "owner",
  })));
});

it("edits a plan, hides completed plans by default and restores one without touching tasks", async () => {
  const onUpdate = vi.fn().mockResolvedValue(undefined);
  const onStatusChange = vi.fn().mockResolvedValue(undefined);
  const renderView = (status: "active" | "completed") => <FluentProvider theme={webLightTheme}><TaskPlansView
    plans={[{ ...plan, status }]} tasks={[]} people={people} currentUserId="me"
    loading={false} error="" onRetry={vi.fn()} onCreate={vi.fn()}
    onUpdate={onUpdate} onStatusChange={onStatusChange} onSelect={vi.fn()} />
  </FluentProvider>;
  const view = render(renderView("active"));
  fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название" }), {
    target: { value: "Переименованный план" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Сохранить план" }));
  await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("plan-1", expect.objectContaining({
    title: "Переименованный план",
  })));
  expect(onUpdate.mock.calls[0]?.[1]).not.toHaveProperty("ownerUserId");
  fireEvent.click(screen.getByRole("button", { name: "Завершить план" }));
  expect(screen.getByText(/Задачи останутся в «Задачах»/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить завершение" }));
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("plan-1", "completed"));
  view.rerender(renderView("completed"));
  expect(screen.queryByText("Недельный план")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Показать завершённые планы" }));
  expect(screen.getByText("Недельный план")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Поиск планов" }), {
    target: { value: "нет совпадений" },
  });
  expect(screen.queryByText("Недельный план")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Поиск планов" }), {
    target: { value: "Нигора" },
  });
  expect(screen.getByText("Недельный план")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Вернуть в активные" }));
  await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith("plan-1", "active"));
  expect(plan.taskIds).toEqual(["task-1"]);
});
