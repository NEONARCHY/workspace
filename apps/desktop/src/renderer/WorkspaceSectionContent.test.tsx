import { lazy, type ComponentType } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { observePageScrollRail, WorkspaceSectionContent } from "./WorkspaceSectionContent";

afterEach(cleanup);
it("renders data and save results in the current section immediately", () => {
  const view = render(<WorkspaceSectionContent authorityKey="employee-a" section="tasks"><h1>До сохранения</h1></WorkspaceSectionContent>);
  screen.getByRole("main").scrollTop = 180;
  view.rerender(<WorkspaceSectionContent authorityKey="employee-a" section="tasks"><h1>Результат сохранён</h1></WorkspaceSectionContent>);
  expect(screen.getByRole("heading", { name: "Результат сохранён" })).toBeVisible();
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false");
  expect(screen.getByRole("main").scrollTop).toBe(180);
});
function pendingSection() {
  let finish!: (module: { default: ComponentType<{ target: string }> }) => void;
  const promise = new Promise<{ default: ComponentType<{ target: string }> }>(resolve => { finish = resolve; });
  return { View: lazy(() => promise), finish };
}
it("keeps the actual old page until the next chunk is ready, then commits its target together", async () => {
  const next = pendingSection();
  const view = render(<WorkspaceSectionContent authorityKey="employee-a" section="home"><h1>Текущая страница</h1></WorkspaceSectionContent>);
  const heading = screen.getByRole("heading");
  screen.getByRole("main").scrollTop = 220;
  view.rerender(<WorkspaceSectionContent authorityKey="employee-a" section="letters"><next.View target="Письмо №42" /></WorkspaceSectionContent>);
  expect(heading).toBeVisible();
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("main").scrollTop).toBe(220);
  expect(screen.queryByRole("status")).toBeNull();
  await act(async () => next.finish({ default: ({ target }) => <h1>{target}</h1> }));
  expect(await screen.findByRole("heading", { name: "Письмо №42" })).toBeVisible();
  expect(heading).not.toBeInTheDocument();
  expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false");
  expect(screen.getByRole("main").scrollTop).toBe(0);
});
it("does not retain another identity's or revoked-access page while a chunk is pending", () => {
  const next = pendingSection();
  const view = render(<WorkspaceSectionContent authorityKey="employee-a:allowed" section="home"><h1>Закрытый раздел</h1></WorkspaceSectionContent>);
  view.rerender(<WorkspaceSectionContent authorityKey="employee-b:restricted" section="letters"><next.View target="Доступный раздел" /></WorkspaceSectionContent>);
  expect(screen.queryByRole("heading", { name: "Закрытый раздел" })).toBeNull();
});
it("discards an obsolete pending navigation when the user opens another ready page", async () => {
  const next = pendingSection();
  const view = render(<WorkspaceSectionContent authorityKey="employee-a" section="home"><h1>Главная</h1></WorkspaceSectionContent>);
  view.rerender(<WorkspaceSectionContent authorityKey="employee-a" section="letters"><next.View target="Отменённый переход" /></WorkspaceSectionContent>);
  view.rerender(<WorkspaceSectionContent authorityKey="employee-a" section="calendar"><h1>Последний выбор</h1></WorkspaceSectionContent>);
  expect(await screen.findByRole("heading", { name: "Последний выбор" })).toBeVisible();
  screen.getByRole("main").scrollTop = 170;
  await act(async () => next.finish({ default: ({ target }) => <h1>{target}</h1> }));
  expect(screen.queryByRole("heading", { name: "Отменённый переход" })).toBeNull();
  expect(screen.getByRole("main").scrollTop).toBe(170);
});

it("measures classic and overlay scrollbar reservation, and cleans up", async () => {
  const pane = document.createElement("main"); document.body.append(pane);
  pane.style.setProperty("--ws-page-scrollbar-fallback", "6px");
  Object.defineProperty(pane, "offsetWidth", { configurable: true, value: 200 });
  Object.defineProperty(pane, "clientWidth", { configurable: true, value: 194 });
  const stop = observePageScrollRail(pane);
  expect(pane.style.getPropertyValue("--ws-page-scrollbar-width")).toBe("6px");
  expect(pane.style.getPropertyValue("--ws-page-scrollbar-inset")).toBe("6px");
  Object.defineProperty(pane, "clientWidth", { configurable: true, value: 200 });
  window.dispatchEvent(new Event("resize"));
  await waitFor(() => expect(pane.style.getPropertyValue("--ws-page-scrollbar-inset")).toBe("0px"));
  expect(pane.style.getPropertyValue("--ws-page-scrollbar-width")).toBe("6px");
  stop(); expect(pane.style.getPropertyValue("--ws-page-scrollbar-width")).toBe("");
  window.dispatchEvent(new Event("resize"));
  expect(pane.style.getPropertyValue("--ws-page-scrollbar-inset")).toBe("");
  pane.remove();
});
