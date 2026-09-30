import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BirthdayDayPicker, birthdayMonthLength, birthdayMonthName } from "./BirthdayDayPicker";

describe("BirthdayDayPicker", () => {
  afterEach(cleanup);
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

  it("keeps a six-week calendar grid when the month changes", () => {
    render(<BirthdayDayPicker month="9" day="" disabled={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Выберите день рождения" }));
    const countCells = () => screen.getByRole("group", { name: /Дни месяца/ }).children.length;
    expect(countCells()).toBe(49);
    fireEvent.click(screen.getByRole("button", { name: "Следующий месяц" }));
    expect(countCells()).toBe(49);
    fireEvent.click(screen.getByRole("button", { name: "Следующий месяц" }));
    expect(countCells()).toBe(49);
  });
});
