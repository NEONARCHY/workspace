import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TasksView } from "./TasksView";
import { workspaceTheme } from "./workspace-theme";
import { chairmanScenarioProps, chairmanScenarioTask, taskChairman } from "./test-fixtures/task-chairman-scenarios";

vi.mock("./IncomingDocumentsView", () => ({
  IncomingDocumentsView: ({ personal, token }: { personal: boolean; token: string }) =>
    <section aria-label="Личный реестр писем" data-personal={personal} data-token={token} />,
}));
afterEach(cleanup);

const letter = chairmanScenarioTask({ id: "letter-task", title: "Поручение из письма", status: "new",
  incomingDocumentId: "source", assigneeId: taskChairman.id });
const ordinary = chairmanScenarioTask({ id: "ordinary", title: "Письмо № обычная задача", status: "new" });
const props = { ...chairmanScenarioProps(letter), focusTaskId: undefined, tasks: [letter, ordinary],
  token: "synthetic-only", canViewIncomingLetters: true };

describe("Tasks personal letters domain", () => {
  it("separates by source identity and opens the personal registry in its own tab", () => {
    render(<FluentProvider theme={workspaceTheme}><TasksView {...props} /></FluentProvider>);
    expect(screen.getByRole("button", { name: "Открыть задачу: Письмо № обычная задача" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Открыть задачу: Поручение из письма" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Мои письма 1" }));
    expect(screen.getByRole("region", { name: "Личный реестр писем" })).toHaveAttribute("data-personal", "true");
    expect(screen.getByRole("region", { name: "Личный реестр писем" })).toHaveAttribute("data-token", "synthetic-only");
    fireEvent.click(screen.getByRole("tab", { name: "Задачи" }));
    expect(screen.getByRole("button", { name: "Открыть задачу: Письмо № обычная задача" })).toBeVisible();
  });

  it("counts personal participation once and excludes unrelated letter tasks", () => {
    const unrelated = { ...letter, id: "unrelated", title: "Письмо подчинённого", assigneeId: "qa-executor", authorId: "qa-author", participants: [] };
    const observer = { ...letter, id: "observer", assigneeId: "qa-executor", participants: [{ userId: taskChairman.id, role: "observer" as const }] };
    render(<FluentProvider theme={workspaceTheme}><TasksView {...props} tasks={[letter, unrelated, observer]} /></FluentProvider>);
    expect(screen.getByRole("tab", { name: "Мои письма 2" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Открыть задачу: Письмо подчинённого" })).toBeVisible();
  });

  it("retains native work when the incoming letters module is unavailable", () => {
    render(<FluentProvider theme={workspaceTheme}><TasksView {...props} canViewIncomingLetters={false} /></FluentProvider>);
    expect(screen.queryByRole("tab", { name: /Мои письма/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Открыть задачу: Поручение из письма" })).toBeVisible();
  });

  it("keeps an explicit native task deep link available as a dialog", async () => {
    render(<FluentProvider theme={workspaceTheme}><TasksView {...props} dialogOnly focusTaskId={letter.id} /></FluentProvider>);
    expect(await screen.findByRole("dialog")).toBeVisible();
    expect(screen.queryByRole("tab", { name: /Мои письма/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: letter.title })).toBeVisible();
  });
});
