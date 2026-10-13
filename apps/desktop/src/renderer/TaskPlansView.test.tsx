import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { TaskPlansView } from "./TaskPlansView";

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
      periodStart: null, periodEnd: null, createdByUserId: "author",
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", taskIds: [],
    }]} tasks={[]} loading={false} error="" onRetry={vi.fn()}
    onCreate={vi.fn()} onSelect={onSelect} />
  </FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Показать задачи" }));
  expect(onSelect).toHaveBeenCalledWith("plan-1");
  expect(screen.queryByText("Выберите регион")).not.toBeInTheDocument();
});
