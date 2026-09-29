import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BirthdayDayPicker, birthdayMonthLength, birthdayMonthName } from "./BirthdayDayPicker";

describe("BirthdayDayPicker", () => {
  it("keeps February 29 available without asking for a birth year", () => {
    expect(birthdayMonthLength(2)).toBe(29);
    expect(birthdayMonthName(2)).toBe("Февраль");
    const onChange = vi.fn();
    render(<BirthdayDayPicker month="2" day="" disabled={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Выберите день рождения" }));
    fireEvent.click(screen.getByRole("button", { name: "29 февраль" }));
    expect(onChange).toHaveBeenCalledWith("2", "29");
    expect(screen.queryByText("2024")).toBeNull();
  });
});
