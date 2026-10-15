import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it } from "vitest";
import { TaskParticipantAvatar, WorkingUserIdsContext } from "./TaskParticipantAvatar";
import { TaskRecords } from "./TaskRecords";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);

describe("Task avatar workday rings", () => {
  it.each(["Постановщик", "Исполнитель", "Соисполнитель", "Наблюдатель"] as const)(
    "marks an open workday for %s and restores the original ring on finish", (role) => {
      const person = people[0]!;
      const avatar = (ids: readonly string[]) => <FluentProvider theme={workspaceTheme}>
        <WorkingUserIdsContext.Provider value={ids}>
          <TaskParticipantAvatar person={person} role={role} />
        </WorkingUserIdsContext.Provider>
      </FluentProvider>;
      const view = render(avatar([]));
      const anchor = document.querySelector(".task-participant-anchor")!;
      const originalClass = anchor.className;
      expect(anchor).not.toHaveAttribute("data-working");
      view.rerender(avatar([person.id]));
      expect(anchor).toHaveAttribute("data-working", "true");
      expect(anchor.className).toBe(originalClass);
      fireEvent.focus(anchor.querySelector(".employee-profile-link")!);
      expect(screen.getByRole("dialog", { name: `${role}: ${person.name}` }).textContent).toBe(`${role}${person.name}`);
      view.rerender(avatar([]));
      expect(anchor).not.toHaveAttribute("data-working");
      expect(screen.queryByText("Работа начата")).toBeNull();
      expect(screen.getByRole("dialog", { name: `${role}: ${person.name}` }).textContent).toBe(`${role}${person.name}`);
    },
  );

  it("keeps legacy data neutral and marks only the correct people in the task table", () => {
    const [author, assignee, co, observer] = people;
    const task = { ...initialTasks[0]!, authorId: author!.id, assigneeId: assignee!.id,
      participants: [{ userId: co!.id, role: "co_assignee" as const }, { userId: observer!.id, role: "observer" as const }] };
    const table = <TaskRecords tasks={[task]} people={people} filterKey="all" onSelect={() => undefined} />;
    const view = render(<FluentProvider theme={workspaceTheme}>{table}</FluentProvider>);
    expect(document.querySelectorAll('[data-working="true"]')).toHaveLength(0);
    view.rerender(<FluentProvider theme={workspaceTheme}>
      <WorkingUserIdsContext.Provider value={[author!.id, co!.id]}>{table}</WorkingUserIdsContext.Provider>
    </FluentProvider>);
    expect(document.querySelectorAll('[data-working="true"]')).toHaveLength(2);
    expect(document.querySelector(".task-participant-author")).toHaveAttribute("data-working", "true");
    expect(document.querySelector(".task-participant-co")).toHaveAttribute("data-working", "true");
    expect(document.querySelector(".task-participant-primary")).not.toHaveAttribute("data-working");
    expect(document.querySelector(".task-participant-observer")).not.toHaveAttribute("data-working");
  });
});
