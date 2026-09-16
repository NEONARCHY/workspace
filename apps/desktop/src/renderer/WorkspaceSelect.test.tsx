import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceSelect } from "./WorkspaceSelect";

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
});
