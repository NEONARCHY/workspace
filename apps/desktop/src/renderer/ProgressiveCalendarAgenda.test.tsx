import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProgressiveCalendarAgenda } from "./ProgressiveCalendarAgenda";
import { useProgressiveList } from "./useProgressiveList";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function agenda(resetKey = "day-one", total = 35) {
  return <ProgressiveCalendarAgenda total={total} resetKey={resetKey}>{shown => Array.from({ length: shown }, (_, i) => <button key={i} className="calendar-agenda-card">Запись {i + 1}</button>)}</ProgressiveCalendarAgenda>;
}
it("starts with ten records, adds ten and focuses the next record after manual loading", () => {
  render(agenda());
  expect(screen.queryByText("Запись 11")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10" }));
  expect(screen.getByText("Запись 11")).toHaveFocus();
  expect(screen.queryByText("Запись 21")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10" }));
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё 5" }));
  expect(screen.getByText("Запись 35")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Показать ещё/ })).not.toBeInTheDocument();
});
it("resets the window on a new day/filter and on leaving the agenda", () => {
  const view = render(agenda());
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10" }));
  view.rerender(agenda("day-two"));
  expect(screen.queryByText("Запись 11")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Показать ещё 10" }));
  view.rerender(agenda("day-two-filter"));
  expect(screen.queryByText("Запись 11")).not.toBeInTheDocument();
  view.unmount(); render(agenda("day-two-filter"));
  expect(screen.queryByText("Запись 11")).not.toBeInTheDocument();
});
it("disconnects automatic loading when the agenda unmounts", () => {
  const observers: { callback: IntersectionObserverCallback; observer: IntersectionObserver; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal("IntersectionObserver", class {
    disconnect = vi.fn(); observe = vi.fn(); unobserve = vi.fn();
    constructor(callback: IntersectionObserverCallback) { observers.push({ callback, observer: this as unknown as IntersectionObserver, disconnect: this.disconnect }); }
  });
  const view = render(agenda());
  const first = observers[0];
  if (!first) throw new Error("Agenda did not create its loading observer");
  act(() => first.callback([{ isIntersecting: true } as IntersectionObserverEntry], first.observer));
  expect(screen.getByText("Запись 20")).toBeInTheDocument();
  expect(screen.queryByText("Запись 21")).not.toBeInTheDocument();
  view.unmount();
  expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
  act(() => observers.at(-1)!.callback([{ isIntersecting: true } as IntersectionObserverEntry], observers.at(-1)!.observer));
  expect(screen.queryByText("Запись 1")).not.toBeInTheDocument();
});
it("preserves the fifteen-record default used by notifications and chats", () => {
  function DefaultList() { const { shown } = useProgressiveList(40, "default", "button"); return <span>Показано: {shown}</span>; }
  render(<DefaultList />);
  expect(screen.getByText("Показано: 15")).toBeInTheDocument();
});
