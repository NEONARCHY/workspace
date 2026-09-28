import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceDepartment, WorkspacePerson } from "@yuksalish/contracts";
import { ScopedPeopleCheckboxes } from "./ScopedPeopleCheckboxes";

const departments: WorkspaceDepartment[] = [
  { id: "central", code: "central", name: "ЦА", scope: "central", assignedUsersCount: 1 },
  { id: "regional", code: "regional", name: "Регион", scope: "regional", assignedUsersCount: 1 },
];
const people: WorkspacePerson[] = [
  { id: "a", name: "Азиза", initials: "А", role: "employee", color: "#0091a8", departmentId: "central" },
  { id: "b", name: "Бобур", initials: "Б", role: "employee", color: "#293a55", departmentId: "regional" },
];

describe("ScopedPeopleCheckboxes", () => {
  it("shows one group at a time without clearing selected people in another group", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScopedPeopleCheckboxes label="Исполнители" people={people} departments={departments} selectedIds={["b"]} onChange={onChange} />);
    const list = screen.getByRole("group", { name: "Исполнители · выбрано 1" });
    expect(within(list).getByText("Бобур")).toBeInTheDocument();
    expect(within(list).queryByText("Азиза")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Центральный аппарат" }));
    expect(within(list).getByText("Азиза")).toBeInTheDocument();
    expect(within(list).queryByText("Бобур")).toBeNull();
    fireEvent.click(within(list).getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(["b", "a"]);
    rerender(<ScopedPeopleCheckboxes label="Исполнители" people={people} departments={departments} selectedIds={["b", "a"]} onChange={onChange} />);
    expect(screen.getByText("Исполнители · выбрано 2")).toBeInTheDocument();
  });
});
