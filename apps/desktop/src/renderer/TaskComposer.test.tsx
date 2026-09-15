import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("flushes the new task draft before a web update reload", async () => {
  const loadDraft = vi.fn().mockResolvedValue(null);
  const saveDraft = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("yuksalish", {
    loadDraft,
    clearDraft: vi.fn().mockResolvedValue(undefined),
    saveDraft,
  });

  render(<FluentProvider theme={webLightTheme}>
    <TaskComposer open people={people} tasks={[]} currentUserId="aziza"
      onClose={vi.fn()} onSubmit={vi.fn()} />
  </FluentProvider>);

  await waitFor(() => expect(loadDraft).toHaveBeenCalledWith("task:aziza"));
  fireEvent.change(screen.getByRole("textbox", { name: "Название задачи" }), {
    target: { value: "Задача перед обновлением" },
  });
  window.dispatchEvent(new Event("yuksalish:prepare-web-update"));
  await waitFor(() => expect(saveDraft).toHaveBeenCalledWith(
    "task:aziza",
    expect.stringContaining('"title":"Задача перед обновлением"'),
  ));
});
