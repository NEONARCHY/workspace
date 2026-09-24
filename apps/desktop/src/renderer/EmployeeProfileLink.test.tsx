import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmployeeProfileLink, EmployeeProfileProvider } from "./EmployeeProfileLink";

describe("EmployeeProfileLink", () => {
  it("opens the requested profile by mouse and keyboard without triggering the parent card", () => {
    const openProfile = vi.fn();
    const openCard = vi.fn();
    render(
      <EmployeeProfileProvider onOpenProfile={openProfile}>
        <button type="button" onClick={openCard}>
          <EmployeeProfileLink userId="employee-7" personName="Азиза Каримова">
            Азиза Каримова
          </EmployeeProfileLink>
        </button>
      </EmployeeProfileProvider>,
    );

    const link = screen.getByRole("button", { name: "Открыть профиль: Азиза Каримова" });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });

    expect(openProfile).toHaveBeenNthCalledWith(1, "employee-7");
    expect(openProfile).toHaveBeenNthCalledWith(2, "employee-7");
    expect(openCard).not.toHaveBeenCalled();
  });

  it("keeps plain identity text inert when the employee is not available", () => {
    render(<EmployeeProfileLink personName="Неизвестный сотрудник">Неизвестный сотрудник</EmployeeProfileLink>);

    expect(screen.getByText("Неизвестный сотрудник")).not.toHaveAttribute("role", "button");
  });

  it("does not highlight profile-opening names or avatars on hover", () => {
    const styles = ["employee-recognition.css", "spatial-workspace.css", "message-layout.css"]
      .map((file) => readFileSync(resolve(process.cwd(), "src/renderer", file), "utf8"))
      .join("\n");

    expect(styles).not.toMatch(/\.employee-profile-link\.is-interactive:hover/);
    expect(styles).not.toMatch(/\.workspace-identity(?:-profile)?:hover/);
    expect(styles).not.toMatch(/\.identity-popover-profile:hover/);
    expect(styles).not.toMatch(/\.message-reaction-tooltip-people\s*>\s*button:hover/);
    expect(styles).toMatch(/\.employee-profile-link\.is-interactive:focus-visible/);
  });
});
