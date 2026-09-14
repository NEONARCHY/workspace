import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";

import { TaskComposer } from "./TaskComposer";
import { people } from "./demo-data";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("restores a task draft, then deletes the local copy", async () => {
  const loadDraft = vi.fn().mockResolvedValue(JSON.stringify({
    title: "Продолжить задачу", description: "Результат", project: "Команда",
  }));
  const clearDraft = vi.fn().mockResolvedValue(undefined);
  const saveDraft = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("yuksalish", { loadDraft, clearDraft, saveDraft });

  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} tasks={[]} currentUserId="aziza"
      onClose={vi.fn()} onSubmit={vi.fn()} />
  </FluentProvider>);

  await waitFor(() => expect(screen.getByRole("textbox", { name: "Название задачи" })).toHaveValue("Продолжить задачу"));
  expect(loadDraft).toHaveBeenCalledWith("task:aziza");
  await waitFor(() => expect(clearDraft).toHaveBeenCalledWith("task:aziza"));
  expect(saveDraft).not.toHaveBeenCalled();
});
