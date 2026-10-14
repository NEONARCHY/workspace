import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarFilters } from "./CalendarFilters";
import { emptyCalendarFilters } from "./calendar-filters";

afterEach(cleanup);

it("renders plain, non-activating captions while retaining accessible field names", () => {
  const change = vi.fn();
  render(<CalendarFilters value={emptyCalendarFilters} onChange={change} onReset={vi.fn()} people={[]} token="test" currentUserId="me" disabled={false} />);
  for (const text of ["Сотрудник", "Поиск события", "С даты", "По дату"]) {
    const caption = screen.getByText(text, { exact: true });
    expect(caption.tagName).toBe("SPAN");
    expect(caption.closest("label, button")).toBeNull();
    fireEvent.click(caption);
  }
  expect(change).not.toHaveBeenCalled();
  expect(screen.getByRole("combobox", { name: "Сотрудник в событиях" })).toBeEnabled();
  const search = screen.getByRole("textbox", { name: "Поиск событий" });
  expect(search.closest("label")).toBeNull();
  fireEvent.change(search, { target: { value: "встреча" } });
  expect(change).toHaveBeenCalledWith({ ...emptyCalendarFilters, query: "встреча" });
});
