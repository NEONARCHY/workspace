import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmployeeAvatar } from "./EmployeeAvatar";

describe("EmployeeAvatar", () => {
  it("uses given name and surname for a formal directory name", () => {
    render(<EmployeeAvatar name="Каримова Нигора Рустамовна" size={36} />);
    expect(screen.getByText("НК")).toBeInTheDocument();
  });
});
