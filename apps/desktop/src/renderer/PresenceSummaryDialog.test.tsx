import { fireEvent, render, screen, within, cleanup } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import type { AbsenceRequest, PresenceSummaryItem, WorkspacePerson } from "@yuksalish/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { AbsencesView } from "./AbsencesView";
import { findPresenceRequest, PresenceSummaryDialog, presenceStatusLabels } from "./PresenceSummaryDialog";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
const people: WorkspacePerson[] = [
  { id: "employee", name: "Малика Нурова", initials: "МН", role: "employee", color: "#e0cca0", jobTitle: "Длинная должность сотрудника регионального подразделения" },
  { id: "manager", name: "Назначенный руководитель", initials: "НР", role: "manager", color: "#a7eacc" },
  { id: "actor", name: "Фактический согласующий", initials: "ФС", role: "admin", color: "#a7eacc" },
];
const item: PresenceSummaryItem = { userId: "employee", status: "vacation", startsAt: "2026-10-04T04:00:00Z", endsAt: "2026-10-10T13:00:00Z" };
const request: AbsenceRequest = {
  id: "absence", requesterUserId: "employee", directManagerUserId: "manager", kind: "vacation", reason: "Семейная поездка\nВстреча с родными", startsAt: item.startsAt!, endsAt: item.endsAt!,
  status: "approved", statusLabel: "Согласовано", documentStatus: "not_required", canEdit: false, allowedActions: [],
  actions: [{ id: "action", actorUserId: "actor", action: "approve", createdAt: "2026-10-01T09:00:00Z" }], createdAt: "2026-09-30T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z",
};
const dialog = (status: PresenceSummaryItem["status"], summary: PresenceSummaryItem[], requests: AbsenceRequest[] = []) => {
  const onClose = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><PresenceSummaryDialog status={status} summary={summary} requests={requests} people={people} onClose={onClose} /></FluentProvider>);
  return onClose;
};

it("opens and closes every summary tile, including empty categories, without mutations", () => {
  const onCreate = vi.fn(), onAction = vi.fn(), onUploadDocument = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><AbsencesView currentUserId="actor" people={people} summary={[{ userId: "employee", status: "working" }]} requests={[]} canAdmin onCreate={onCreate} onAction={onAction} onUploadDocument={onUploadDocument} /></FluentProvider>);
  const tiles = within(screen.getByRole("region", { name: "Сводка присутствия" })).getAllByRole("button");
  expect(tiles).toHaveLength(7);
  for (const tile of tiles) {
    fireEvent.click(tile);
    const popup = screen.getByRole("dialog");
    expect(within(popup).getByRole("heading", { name: tile.querySelector("span")!.textContent! })).toBeInTheDocument();
    expect(tile).toHaveAttribute("aria-expanded", "true");
    if (tile.dataset.presenceStatus === "working") expect(within(popup).getByText("Малика Нурова")).toBeInTheDocument();
    else expect(within(popup).getByText("Список пока пуст")).toBeInTheDocument();
    fireEvent.click(within(popup).getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(tile).toHaveAttribute("aria-expanded", "false");
  }
  expect(onCreate).not.toHaveBeenCalled(); expect(onAction).not.toHaveBeenCalled(); expect(onUploadDocument).not.toHaveBeenCalled();
});

it("shows full identity, exact period, reason and actual approving actor", () => {
  dialog("vacation", [item], [request]);
  expect(screen.getByText("Малика Нурова")).toBeInTheDocument();
  expect(screen.getByText(people[0]!.jobTitle!)).toBeInTheDocument();
  expect(screen.getByText(/Семейная поездка/)).toHaveTextContent("Встреча с родными");
  expect(screen.getByText("Фактический согласующий")).toBeInTheDocument();
  expect(screen.queryByText("Назначенный руководитель")).not.toBeInTheDocument();
  expect(screen.getByText("Начало").nextElementSibling).toHaveTextContent("4 октября 2026");
  expect(screen.getByText("Окончание").nextElementSibling).toHaveTextContent("10 октября 2026");
  expect(screen.getByText("Согласовал(а)")).toBeInTheDocument();
});

it("describes sick leave acknowledgement without claiming permission was granted", () => {
  dialog("sick_leave", [{ ...item, status: "sick_leave" }], [{ ...request, kind: "sick_leave", status: "acknowledged", actions: [{ ...request.actions[0]!, action: "acknowledge" }] }]);
  expect(screen.getByText("Получение подтвердил(а)")).toBeInTheDocument();
  expect(screen.queryByText("Согласовал(а)")).not.toBeInTheDocument();
});

it("does not guess a reason or approver when only the summary is authorized", () => {
  dialog("vacation", [item], [{ ...request, requesterUserId: "other" }]);
  expect(screen.getByText("Причина и согласование недоступны в вашей сводке.")).toBeInTheDocument();
  expect(screen.queryByText(/Семейная поездка/)).not.toBeInTheDocument();
  expect(screen.queryByText("Фактический согласующий")).not.toBeInTheDocument();
  expect(screen.getByText("Начало")).toBeInTheDocument();
});

it("shows all and only members of the selected status and honest working semantics", () => {
  dialog("working", [{ userId: "employee", status: "working" }, { ...item, userId: "actor" }], [request]);
  expect(screen.getByText("Малика Нурова")).toBeInTheDocument();
  expect(screen.queryByText("Фактический согласующий")).not.toBeInTheDocument();
  expect(screen.getByText(/отметки начала рабочего дня здесь не учитываются/)).toBeInTheDocument();
  expect(screen.queryByText("Начало")).not.toBeInTheDocument();
});

it("does not invent missing approval history or unavailable people", () => {
  dialog("vacation", [{ ...item, userId: "unknown" }], [{ ...request, requesterUserId: "unknown", actions: [] }]);
  expect(screen.getByText("Сотрудник")).toBeInTheDocument();
  expect(screen.getByText("В истории заявки нет сведений о согласующем.")).toBeInTheDocument();
});

it("keeps a long list in one keyboard-focusable scroll region with closing actions outside", () => {
  const members: WorkspacePerson[] = Array.from({ length: 100 }, (_, index) => ({ ...people[0]!, id: `person-${index}`, name: `Сотрудник ${index + 1}` }));
  const onClose = vi.fn();
  render(<FluentProvider theme={workspaceTheme}><PresenceSummaryDialog status="working" summary={members.map(person => ({ userId: person.id, status: "working" }))} requests={[]} people={members} onClose={onClose} /></FluentProvider>);
  const popup = screen.getByRole("dialog");
  const region = within(popup).getByLabelText("Список сотрудников");
  expect(region).toHaveAttribute("tabindex", "0");
  expect(within(region).getAllByRole("listitem")).toHaveLength(100);
  expect(within(region).getByText("Сотрудник 100")).toBeInTheDocument();
  expect(region).not.toContainElement(within(popup).getByRole("heading", { name: "На работе" }));
  const close = within(popup).getByRole("button", { name: /^Закрыть$/ });
  expect(region).not.toContainElement(close);
  fireEvent.click(close);
  expect(onClose).toHaveBeenCalledOnce();
});

it("correlates only one exact confirmed interval, accounting for timezone representation", () => {
  expect(findPresenceRequest(item, [request])).toBe(request);
  expect(findPresenceRequest({ ...item, startsAt: "2026-10-04T09:00:00+05:00" }, [request])).toBe(request);
  for (const change of [{ status: "pending" as const }, { kind: "sick_leave" as const }, { requesterUserId: "other" }, { startsAt: "2025-10-04T04:00:00Z" }, { endsAt: "2026-10-09T13:00:00Z" }]) {
    expect(findPresenceRequest(item, [{ ...request, ...change }])).toBeUndefined();
  }
  expect(findPresenceRequest(item, [request, { ...request, id: "duplicate" }])).toBeUndefined();
  expect(findPresenceRequest({ ...item, startsAt: null }, [request])).toBeUndefined();
  expect(findPresenceRequest({ ...item, status: "working" }, [request])).toBeUndefined();
  expect(findPresenceRequest({ ...item, status: "trip" }, [request])).toBeUndefined();
  expect(Object.keys(presenceStatusLabels)).toHaveLength(7);
});
