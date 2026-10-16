import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarFilters } from "./CalendarFilters";
import { emptyCalendarFilters } from "./calendar-filters";

afterEach(cleanup);

it("collapses desktop filters without clearing values, exposes the count and resets explicitly", () => {
  function Harness() {
    const [value, setValue] = useState(emptyCalendarFilters);
    return <CalendarFilters value={value} onChange={setValue} onReset={() => setValue(emptyCalendarFilters)} people={[]} token="test" currentUserId="me" disabled={false} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Поиск событий" }), { target: { value: "План" } });
  fireEvent.click(screen.getByRole("button", { name: "Мои события" }));
  fireEvent.click(screen.getByRole("button", { name: "Фильтры · 2" }));
  expect(screen.queryByRole("textbox", { name: "Поиск событий" })).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Фильтры · 2" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);
  expect(screen.getByRole("textbox", { name: "Поиск событий" })).toHaveValue("План");
  expect(screen.getByRole("button", { name: "Мои события" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "Сбросить фильтры" }));
  expect(screen.getByRole("button", { name: "Фильтры" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("textbox", { name: "Поиск событий" })).toHaveValue("");
});
it("does not open filters while editing is locked", () => {
  render(<CalendarFilters value={emptyCalendarFilters} onChange={vi.fn()} onReset={vi.fn()} people={[]} token="test" currentUserId="me" disabled />);
  fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
  expect(screen.getByRole("button", { name: "Фильтры" })).toBeDisabled();
  expect(screen.queryByRole("textbox", { name: "Поиск событий" })).not.toBeInTheDocument();
});

it("renders plain, non-activating captions while retaining accessible field names", () => {
  const change = vi.fn();
  render(<CalendarFilters value={emptyCalendarFilters} onChange={change} onReset={vi.fn()} people={[]} token="test" currentUserId="me" disabled={false} />);
  expect(screen.queryByRole("textbox", { name: "Поиск событий" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Фильтры" }));
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
