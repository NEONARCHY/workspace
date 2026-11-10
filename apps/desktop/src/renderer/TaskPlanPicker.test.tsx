import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { TaskPlan } from "@yuksalish/contracts";
import { TaskPlanPicker } from "./TaskPlanPicker";
import * as api from "./workspace-api";

const planFixture = (id: string, title: string): TaskPlan => ({
  id, title, kind: "work", status: "active", ownerUserId: "aziza", createdByUserId: "aziza",
  createdAt: "2026-11-10T10:00:00Z", updatedAt: "2026-11-10T10:00:00Z",
  periodStart: null, periodEnd: null, taskIds: [],
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("does not present a load failure as an empty plan list and retries", async () => {
  const load = vi.spyOn(api, "loadTaskPlans").mockRejectedValueOnce(new Error("Synthetic failure"))
    .mockResolvedValueOnce([planFixture("work", "Иш режа")]);
  const change = vi.fn();
  render(<FluentProvider theme={webLightTheme}><TaskPlanPicker token="synthetic-token" value={[]} onChange={change} /></FluentProvider>);
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить планы");
  expect(screen.getByRole("combobox", { name: "Планы · необязательно" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку планов" }));
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Иш режа" }));
  expect(change).toHaveBeenCalledWith(["work"]);
  expect(load).toHaveBeenCalledTimes(2);
});

it("shows a selected completed plan and never allows read-only changes", () => {
  render(<FluentProvider theme={webLightTheme}><TaskPlanPicker value={["old"]} readOnly
    plans={[{ ...planFixture("old", "Прежний план"), status: "completed" }]} onChange={vi.fn()} /></FluentProvider>);
  expect(screen.getByRole("combobox")).toHaveValue("Прежний план");
  expect(screen.getByRole("combobox")).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Убрать все планы" })).not.toBeInTheDocument();
});
