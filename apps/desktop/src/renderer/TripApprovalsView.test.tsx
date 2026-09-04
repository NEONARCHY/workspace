import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { TripRequest } from "@yuksalish/contracts";
import { TripApprovalsView } from "./TripApprovalsView";
import { people } from "./demo-data";

const request: TripRequest = {
  id: "test-trip", number: "TR-TEST", requesterUserId: people[0]!.id,
  purpose: "Встреча с региональной командой", destination: "Самарканд", startDate: "2026-09-18", endDate: "2026-09-20",
  employeeIds: [people[0]!.id], stage: "manager_approval", stageLabel: "Утверждение руководителем",
  status: "running", statusLabel: "На согласовании", canEdit: false, allowedActions: ["approve", "return", "reject"],
  actions: [], createdAt: "2026-09-04T09:00:00Z", updatedAt: "2026-09-04T09:00:00Z",
};
function setup(item = request, onAction = vi.fn(async () => undefined as TripRequest | undefined)) {
  const onCreate = vi.fn(async () => undefined);
  render(<FluentProvider theme={webLightTheme}><TripApprovalsView requests={[item]} people={people} currentUser={people[0]!} onCreate={onCreate} onUpdate={vi.fn()} onAction={onAction} /></FluentProvider>);
  return { onAction, onCreate };
}
const column = (key: string) => document.querySelector(`.trip-column[data-stage-key="${key}"]`)!;
const card = () => document.querySelector(".trip-board-card")!;
function drop(target: string) {
  fireEvent.dragStart(card(), { dataTransfer: { setData: vi.fn() } });
  fireEvent.drop(column(target));
}
afterEach(cleanup);
describe("Trip approvals interaction", () => {
  it("starts on the coloured board and filters the same cards in list view", () => {
    setup();
    expect(screen.getByLabelText("Стадии поездок")).toBeInTheDocument();
    expect(column("manager_approval")).toHaveStyle({ "--approval-stage-color": "#88b9ff" });
    expect(within(column("manager_approval") as HTMLElement).getByText("Не задана")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Поиск поездок"), { target: { value: "нет совпадений" } });
    expect(document.querySelectorAll(".trip-board-card")).toHaveLength(0);
    expect(within(column("manager_approval") as HTMLElement).getByText("0 UZS")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Поиск поездок"), { target: { value: "самарканд" } });
    fireEvent.click(screen.getByRole("button", { name: "Список" }));
    expect(screen.getByLabelText("Список поездок").children).toHaveLength(1);
  });
  it("uses the existing approval action for a permitted drop, with no optimistic stage write", async () => {
    const { onAction } = setup();
    drop("hr");
    await waitFor(() => expect(onAction).toHaveBeenCalledExactlyOnceWith(request, "approve", undefined));
    expect(column("manager_approval").querySelector(".trip-board-card")).not.toBeNull();
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось изменить стадию");
  });
  it("blocks skipped stages and cards without permission", () => {
    const { onAction } = setup({ ...request, stage: "launch", status: "draft", allowedActions: [] });
    expect(card()).toHaveAttribute("draggable", "false");
    drop("approved");
    expect(onAction).not.toHaveBeenCalled();
  });
  it("requires a reason for a return, and cancelling leaves the card untouched", async () => {
    const onAction = vi.fn(async () => ({ ...request, stage: "launch" as const, stageLabel: "Запуск" }));
    setup(request, onAction);
    drop("launch");
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Подтвердить решение" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Вернуть на доработку" }));
    fireEvent.change(screen.getByLabelText("Причина решения"), { target: { value: "Уточнить даты" } });
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить решение" }));
    await waitFor(() => expect(onAction).toHaveBeenCalledExactlyOnceWith(request, "return", "Уточнить даты"));
  });
  it("requires a reason for rejection too", () => {
    const { onAction } = setup();
    drop("rejected");
    expect(screen.getByRole("form", { name: "Причина отклонения" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подтвердить решение" })).toBeDisabled();
    expect(onAction).not.toHaveBeenCalled();
  });
  it("does not send a second action while the first is pending", async () => {
    let finish!: (value: TripRequest | undefined) => void;
    const onAction = vi.fn(() => new Promise<TripRequest | undefined>((resolve) => { finish = resolve; }));
    setup(request, onAction);
    drop("hr");
    drop("hr");
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Согласовать: TR-TEST" })).toBeDisabled();
    finish(undefined);
    await screen.findByRole("alert");
  });
  it("validates missing fields and reversed dates without creating a trip", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Новая командировка" }));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Укажите цель");
    fireEvent.change(screen.getByLabelText("Цель поездки"), { target: { value: "Тест" } });
    fireEvent.change(screen.getByLabelText("Куда едем"), { target: { value: "Бухара" } });
    fireEvent.change(screen.getByLabelText("Дата начала"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("Дата окончания"), { target: { value: "2026-09-18" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Дата окончания не может быть раньше даты начала");
    expect(onCreate).not.toHaveBeenCalled();
  });
});
