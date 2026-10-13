import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, expect, it, vi } from "vitest";
import { CalendarView } from "./CalendarView";
import { sampleEvent, sampleZoom } from "./test-fixtures/calendar-filter-data";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);
const event = sampleEvent("Рабочая встреча", { canEdit: true, canRespond: true,
  description: "Обсуждаем план команды", location: "Переговорная" });
function setup(onUpdate = vi.fn().mockResolvedValue(undefined), onRespond = vi.fn().mockResolvedValue(undefined)) {
  const openZoom = vi.fn();
  function Harness() {
    const [events, setEvents] = useState([event]);
    return <FluentProvider theme={workspaceTheme}><CalendarView events={events} zoomMeetings={[sampleZoom()]}
    people={[]} currentUserId="me" onCreate={vi.fn()} onUpdate={async (record, payload) => {
      const saved = await onUpdate(record, payload);
      if (saved) setEvents([saved]);
      return saved;
    }} onRespond={onRespond}
    onCancel={vi.fn()} onOpenZoomMeeting={openZoom} /></FluentProvider>;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Перейти к дате"), { target: { value: "2026-10-13" } });
  return { openZoom };
}
it("opens the complete event in a modal without replacing the day agenda", async () => {
  setup();
  const agenda = screen.getByRole("complementary", { name: "События выбранного дня" });
  const initialAgenda = agenda.textContent;
  const trigger = within(screen.getByRole("grid")).getByRole("button", { name: /Рабочая встреча/ });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: event.title });
  expect(within(dialog).getByText(event.description)).toBeInTheDocument();
  expect(within(dialog).getByText(event.location)).toBeInTheDocument();
  expect(agenda.textContent).toBe(initialAgenda);
  expect(agenda.querySelector(".calendar-detail")).toBeNull();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: event.title })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("keeps an edited draft after Escape and a failed save, then saves on retry", async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error("Соединение потеряно"))
    .mockResolvedValueOnce({ ...event, title: "Новый план" });
  setup(update);
  fireEvent.click(within(screen.getByRole("grid")).getByRole("button", { name: /Рабочая встреча/ }));
  fireEvent.click(screen.getByRole("button", { name: "Изменить" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Название события" }), { target: { value: "Новый план" } });
  fireEvent.keyDown(screen.getByRole("dialog", { name: event.title }), { key: "Escape" });
  expect(screen.getByRole("textbox", { name: "Название события" })).toHaveValue("Новый план");
  expect(screen.getByRole("button", { name: "Закрыть форму" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Соединение потеряно");
  expect(screen.getByRole("textbox", { name: "Название события" })).toHaveValue("Новый план");
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Название события" })).not.toBeInTheDocument());
  expect(update).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("dialog", { name: "Новый план" })).toBeInTheDocument();
});
it("serializes attendance responses and prevents closing while a response is pending", async () => {
  let finish: (value: typeof event) => void = () => {};
  const respond = vi.fn(() => new Promise<typeof event>(resolve => { finish = resolve; }));
  setup(undefined, respond);
  fireEvent.click(within(screen.getByRole("grid")).getByRole("button", { name: /Рабочая встреча/ }));
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить участие" }));
  expect(screen.getByRole("button", { name: "Подтвердить участие" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Закрыть событие" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog", { name: event.title }), { key: "Escape" });
  expect(screen.getByRole("dialog", { name: event.title })).toBeInTheDocument();
  await act(async () => { finish({ ...event, canRespond: false }); });
  expect(respond).toHaveBeenCalledTimes(1);
  expect(respond).toHaveBeenCalledWith(event, "accepted");
});
it("opens Zoom in a calendar modal and navigates to its module only on an explicit action", () => {
  const { openZoom } = setup();
  fireEvent.click(within(screen.getByRole("grid")).getByRole("button", { name: /Zoom-сессия/ }));
  const dialog = screen.getByRole("dialog", { name: "Zoom-сессия" });
  expect(within(dialog).getByText("Zoom-конференция")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
  expect(openZoom).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Открыть в Zoom-конференциях" }));
  expect(openZoom).toHaveBeenCalledWith("zoom");
});
it("does not expose editing or attendance actions for a read-only event", () => {
  const readonlyEvent = sampleEvent("Доступный только для просмотра");
  render(<CalendarView events={[readonlyEvent]} people={[]} currentUserId="me"
    onCreate={vi.fn()} onUpdate={vi.fn()} onCancel={vi.fn()} onRespond={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Перейти к дате"), { target: { value: "2026-10-13" } });
  fireEvent.click(within(screen.getByRole("grid")).getByRole("button", { name: /Доступный только для просмотра/ }));
  const dialog = screen.getByRole("dialog", { name: readonlyEvent.title });
  expect(within(dialog).queryByRole("button", { name: "Изменить" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Подтвердить участие" })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Отменить событие" })).not.toBeInTheDocument();
});
