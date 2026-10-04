import { cleanup, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { AbsencesView } from "./AbsencesView";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
const view = (canAdmin: boolean) => render(<FluentProvider theme={workspaceTheme}><AbsencesView
  currentUserId="test" people={[]} requests={[]} summary={[]} canAdmin={canAdmin}
  onCreate={vi.fn()} onAction={vi.fn()} onUploadDocument={vi.fn()}
/></FluentProvider>);

it("gives all seven summary tiles stable semantic status identities", () => {
  view(true);
  const tiles = screen.getByRole("region", { name: "Сводка присутствия" }).children;
  expect(Array.from(tiles, (tile) => tile.getAttribute("data-presence-status"))).toEqual([
    "working", "trip", "vacation", "personal_time", "late_arrival", "sick_leave", "business_event",
  ]);
  expect(Array.from(tiles, (tile) => tile.querySelector("strong")?.textContent)).toEqual(Array(7).fill("0"));
});
it("keeps the organization summary hidden without administration rights", () => {
  view(false);
  expect(screen.queryByRole("region", { name: "Сводка присутствия" })).not.toBeInTheDocument();
});
