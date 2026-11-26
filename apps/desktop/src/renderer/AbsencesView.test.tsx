import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AbsenceRequest } from "@yuksalish/contracts";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { AbsencesView } from "./AbsencesView";
import { workspaceTheme } from "./workspace-theme";
import * as profileLinks from "./EmployeeProfileLink";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("keeps the absence draft and shows an error inside the form on failure", async () => {
  const create = vi.fn().mockRejectedValue(new Error("Временная ошибка"));
  render(<FluentProvider theme={workspaceTheme}><AbsencesView currentUserId="self" people={[]} requests={[]} summary={[]} canAdmin={false}
    onCreate={create} onAction={vi.fn()} onUploadDocument={vi.fn()} /></FluentProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Сообщить об отсутствии" }));
  const dialog = screen.getByRole("dialog");
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Причина" }), { target: { value: "Сохранить основание" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Отправить руководителю" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Временная ошибка");
  expect(within(dialog).getByRole("textbox", { name: "Причина" })).toHaveValue("Сохранить основание");
  expect(within(dialog).getByRole("button", { name: "Отправить руководителю" })).toBeEnabled();
});
const view = (canAdmin: boolean) => render(<FluentProvider theme={workspaceTheme}><AbsencesView
  currentUserId="test" people={[]} requests={[]} summary={[]} canAdmin={canAdmin}
  onCreate={vi.fn()} onAction={vi.fn()} onUploadDocument={vi.fn()}
/></FluentProvider>);
const absence: AbsenceRequest = { id: "absence", requesterUserId: "self", directManagerUserId: "manager", kind: "personal_time",
  reason: "Посещение учреждения", startsAt: "2026-11-26T07:00:00Z", endsAt: "2026-11-26T10:00:00Z", status: "pending", statusLabel: "Ждёт решения",
  documentStatus: "not_required", canEdit: false, allowedActions: [], actions: [], createdAt: "2026-11-26T06:00:00Z", updatedAt: "2026-11-26T06:00:00Z" };

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
it("keeps request dates readable and tolerates an invalid server date in cards and details", () => {
  const request = { ...absence, endsAt: "invalid" };
  render(<FluentProvider theme={workspaceTheme}><AbsencesView currentUserId="self" people={[]} requests={[request]} summary={[]} canAdmin={false}
    onCreate={vi.fn()} onAction={vi.fn()} onUploadDocument={vi.fn()} /></FluentProvider>);
  expect(screen.getByText(/26\.11\.2026, .* — Invalid Date/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Посещение учреждения/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Invalid Date")).toBeInTheDocument();
  expect(within(dialog).getByText(/26\.11\.2026,/)).toBeInTheDocument();
});
it("does not render request and presence profile links again while the absence reason is typed", () => {
  const profiles = vi.spyOn(profileLinks, "EmployeeProfileLink");
  render(<FluentProvider theme={workspaceTheme}><AbsencesView currentUserId="self" people={[]} requests={[absence]} summary={[{ userId: "self", status: "working" }]} canAdmin
    onCreate={vi.fn()} onAction={vi.fn()} onUploadDocument={vi.fn()} /></FluentProvider>);
  expect(profiles).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Сообщить об отсутствии" }));
  profiles.mockClear();
  fireEvent.change(within(screen.getByRole("dialog")).getByRole("textbox", { name: "Причина" }), { target: { value: "Новый текст причины" } });
  expect(profiles).not.toHaveBeenCalled();
});
