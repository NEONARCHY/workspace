import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import type { GrantSummary } from "@yuksalish/contracts";
import { TaskRecords } from "./TaskRecords";
import { GrantRecords } from "./GrantRecords";
import { EmployeeProfileProvider } from "./EmployeeProfileLink";
import { workspaceTheme } from "./workspace-theme";
import { initialTasks, people } from "./test-fixtures/demo-data";
import { grantStatusLabels } from "./GrantsView";

afterEach(cleanup);
const wrap = (node: React.ReactNode) => <FluentProvider theme={workspaceTheme}><EmployeeProfileProvider onOpenProfile={vi.fn()}>{node}</EmployeeProfileProvider></FluentProvider>;

it("bounds compact task avatars, opens the full task and cleans up the sorting portal", () => {
  const onSelect = vi.fn(), target = document.createElement("div");
  document.body.append(target);
  const task = { ...initialTasks[0]!, participants: people.slice(0, 3).map(person => ({ userId: person.id, role: "co_assignee" as const })) };
  const view = render(wrap(<TaskRecords tasks={[task]} people={people} filterKey="phone" compact compactToolsTarget={target} onSelect={onSelect} />));
  const row = view.container.querySelector(".record-row")!;
  expect(row.querySelectorAll(".task-participant-anchor")).toHaveLength(2);
  expect(row.querySelectorAll("td")).toHaveLength(4);
  fireEvent.click(screen.getByRole("button", { name: "Ещё 2 участников задачи" }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(task.id);
  fireEvent.click(within(target).getByRole("button", { name: "Сортировка: задачи" }));
  expect(screen.getAllByRole("menuitem")).toHaveLength(7);
  fireEvent.click(screen.getByRole("menuitem", { name: "План" }));
  expect(within(target).getByRole("button", { name: "Сортировка: задачи" })).toHaveAttribute("title", "План ↑");
  view.unmount();
  expect(target).toBeEmptyDOMElement();
  target.remove();
});

it("keeps grant sort, paging and all participants available with compact cards", () => {
  const base: GrantSummary = { id: "grant", title: "Грант", description: "", authorUserId: people[0]!.id,
    initiatorUserId: people[1]!.id, assigneeId: people[0]!.id, coAssigneeIds: people.slice(1, 4).map(person => person.id),
    leaderUserId: people[1]!.id, chairUserId: people[2]!.id, dueAt: "2099-12-01T09:00:00Z", status: "in_progress", revision: 1,
    checklist: [], allowedActions: [], resultText: "", chatId: "grant-chat", createdAt: "2026-11-27T09:00:00Z", updatedAt: "2026-11-27T09:00:00Z",
    workflowVersion: 1, launchApprovedAt: null, launchApprovedByUserId: null };
  const grants = Array.from({ length: 31 }, (_, i) => ({ ...base, id: `g-${i}`, title: `Грант ${i + 1}` }));
  const onSelect = vi.fn();
  const view = render(wrap(<GrantRecords grants={grants} people={people} token="test" filterKey="phone" compact statusLabels={grantStatusLabels} now={0} onSelect={onSelect} />));
  expect(view.container.querySelectorAll(".record-row")).toHaveLength(25);
  expect(view.container.querySelector(".record-row")!.querySelectorAll(".task-participant-anchor")).toHaveLength(2);
  expect(view.container.querySelector(".record-row")!.querySelectorAll(".grant-participant")).toHaveLength(1);
  fireEvent.click(screen.getAllByRole("button", { name: "Ещё 2 участников гранта" })[0]!);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("g-0");
  fireEvent.click(screen.getByRole("button", { name: "Следующая страница: гранты" }));
  expect(view.container.querySelectorAll(".record-row")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Сортировка: гранты" }));
  expect(screen.getAllByRole("menuitem")).toHaveLength(5);
  fireEvent.click(screen.getByRole("menuitem", { name: "Название" }));
  expect(view.container.querySelectorAll(".record-row")).toHaveLength(25);
  expect(screen.getByRole("status")).toHaveTextContent("1–25 из 31");
});
