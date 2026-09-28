import { cleanup, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AbsencesView } from "./AbsencesView";
import { FeedView } from "./FeedView";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);

describe("assistant-prepared Workspace forms", () => {
  it("opens an unsent feed announcement with the proposed text", () => {
    const onCreate = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><FeedView
      posts={[]} people={[]} token="test-token" currentUserId="me"
      onCreate={onCreate} onComment={vi.fn()} onReact={vi.fn()}
      onDeleteComment={vi.fn()} onPin={vi.fn()} onDelete={vi.fn()}
      assistantDraft={{ kind: "feed", ready: true, fields: {
        title: "Встреча команды", body: "Встречаемся в пятницу.",
      } }}
    /></FluentProvider>);
    expect(screen.getByRole("textbox", { name: "Заголовок публикации" })).toHaveValue("Встреча команды");
    expect(screen.getByRole("textbox", { name: "Текст публикации" })).toHaveValue("Встречаемся в пятницу.");
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("opens an unsent absence request with the proposed reason", () => {
    const onCreate = vi.fn();
    render(<FluentProvider theme={workspaceTheme}><AbsencesView
      currentUserId="me" people={[]} requests={[]} summary={[]} canAdmin={false}
      onCreate={onCreate} onAction={vi.fn()} onUploadDocument={vi.fn()}
      assistantDraft={{ kind: "absence", ready: true, fields: {
        reason: "Личный вопрос", startDate: "2030-10-01", endDate: "2030-10-01",
        absenceKind: "personal_time",
      } }}
    /></FluentProvider>);
    expect(screen.getByRole("textbox", { name: "Причина" })).toHaveValue("Личный вопрос");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
