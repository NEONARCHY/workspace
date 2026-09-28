import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspacePeopleProvider, WorkspaceSelect } from "./WorkspaceSelect";

describe("WorkspaceSelect", () => {
  it("renders an accessible combobox and preserves select-like value changes", () => {
    const onChange = vi.fn();
    render(
      <WorkspaceSelect aria-label="Приоритет" value="normal" onChange={onChange}>
        <option value="normal">Обычный</option>
        <option value="high">Высокий</option>
      </WorkspaceSelect>,
    );

    const select = screen.getByRole("combobox", { name: "Приоритет" });
    expect(select).toHaveTextContent("Обычный");
    expect(select).toHaveValue("normal");
    fireEvent.change(select, { target: { value: "high" } });

    expect(onChange).toHaveBeenCalledWith({
      target: { value: "high" },
      currentTarget: { value: "high", selectedOptions: [{ value: "high" }] },
    });
  });

  it("shows an avatar next to employee names when values use IDs or usernames", () => {
    const person = { id: "person-1", username: "aziza", name: "Азиза Каримова", initials: "АК", role: "employee", color: "#0091a8" };
    render(<WorkspacePeopleProvider people={[person]}>
      <WorkspaceSelect aria-label="Ответственный" value="person-1">
        <option value="">Выберите сотрудника</option>
        <option value="person-1">Азиза Каримова</option>
      </WorkspaceSelect>
      <WorkspaceSelect aria-label="Аккаунт Workspace" value="aziza">
        <option value="">Выберите сотрудника</option>
        <option value="aziza">Азиза Каримова · @aziza</option>
      </WorkspaceSelect>
    </WorkspacePeopleProvider>);

    expect(document.querySelectorAll(".workspace-select-person-avatar")).toHaveLength(2);
    fireEvent.click(screen.getByRole("combobox", { name: "Ответственный" }));
    expect(document.querySelector(".workspace-select-person-option .fui-Avatar")).not.toBeNull();
  });

  it("marks every priority option with its tone, including inactive choices", () => {
    render(<WorkspaceSelect aria-label="Приоритет задачи" variant="priority" value="normal">
      <option value="low">Низкий</option><option value="normal">Обычный</option>
      <option value="high">Высокий</option><option value="urgent">Срочный</option>
    </WorkspaceSelect>);
    expect(document.querySelector(".workspace-priority-select.priority-normal")).not.toBeNull();
    fireEvent.click(screen.getByRole("combobox", { name: "Приоритет задачи" }));
    for (const tone of ["low", "normal", "high", "urgent"]) {
      expect(document.querySelector(`.workspace-priority-option.priority-${tone}`)).not.toBeNull();
    }
  });
});
