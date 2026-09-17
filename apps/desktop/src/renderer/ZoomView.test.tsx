import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspacePerson, ZoomMeeting, ZoomMeetingsRegistry } from "@yuksalish/contracts";

import { ZoomView, formatMeetingId, invitationText, zonedWallTimeToIso } from "./ZoomView";
import { workspaceTheme } from "./workspace-theme";
import {
  cancelZoomMeeting,
  createZoomMeeting,
  loadZoomAvailability,
} from "./workspace-api";

vi.mock("./workspace-api", () => ({
  loadZoomAvailability: vi.fn(),
  createZoomMeeting: vi.fn(),
  updateZoomMeeting: vi.fn(),
  cancelZoomMeeting: vi.fn(),
}));

const people: readonly WorkspacePerson[] = [
  { id: "me", username: "dilshod", name: "Дильшод Рахимов", initials: "ДР", role: "employee", color: "brand" },
  { id: "peer", username: "aziza", name: "Азиза Каримова", initials: "АК", role: "employee", color: "brand" },
];

const meeting: ZoomMeeting = {
  id: "meeting-1",
  topic: "Планёрка отдела",
  description: "Итоги недели",
  startsAt: "2026-10-01T04:00:00Z",
  endsAt: "2026-10-01T05:00:00Z",
  durationMinutes: 60,
  status: "scheduled",
  source: "workspace",
  organizerUserId: "me",
  organizerName: "Дильшод Рахимов",
  participantIds: ["peer"],
  zoomMeetingId: "81234567890",
  joinUrl: "https://zoom.us/j/81234567890",
  passcode: "7788",
  canEdit: true,
  canCancel: true,
};

const registry: ZoomMeetingsRegistry = {
  configured: true,
  timezone: "Asia/Tashkent",
  reminderMinutes: 30,
  bookingHorizonDays: 180,
  slotMinutes: 15,
  meetings: [meeting],
};

const onRefresh = vi.fn();
const mount = (props: Partial<React.ComponentProps<typeof ZoomView>> = {}) => render(
  <FluentProvider theme={workspaceTheme}>
    <ZoomView
      token="test-token"
      people={people}
      currentUserId="me"
      registry={registry}
      loading={false}
      onRefresh={onRefresh}
      {...props}
    />
  </FluentProvider>,
);

/** A safely future calendar date in the organization timezone. */
const futureDay = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadZoomAvailability).mockResolvedValue({
    configured: true,
    timezone: "Asia/Tashkent",
    slotMinutes: 15,
    hostCalendarSynced: true,
    intervals: [],
  });
});
afterEach(cleanup);

describe("Zoom conference booking", () => {
  it("shows the shared schedule and the connection details of an own meeting", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Планёрка отдела/ }));
    expect(screen.getByText("812 3456 7890")).toBeInTheDocument();
    expect(screen.getByText("7788")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Подключиться" })).toBeInTheDocument();
  });

  it("books a free slot as an absolute instant of the organization timezone", async () => {
    vi.mocked(createZoomMeeting).mockResolvedValue({ ...meeting, id: "meeting-2" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Новая конференция" }));
    fireEvent.change(screen.getByPlaceholderText("Например, планёрка отдела"), {
      target: { value: "Разбор задач" },
    });
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: futureDay() } });
    fireEvent.change(screen.getByLabelText("Начало"), { target: { value: "09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "45 мин" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать конференцию" }));
    await waitFor(() => expect(createZoomMeeting).toHaveBeenCalledWith("test-token", {
      topic: "Разбор задач",
      description: "",
      startsAt: `${futureDay()}T04:00:00.000Z`,
      durationMinutes: 45,
      participantIds: [],
    }));
  });

  it("keeps the form open and the input intact when the server refuses the slot", async () => {
    vi.mocked(createZoomMeeting).mockRejectedValue(
      new Error("Это время уже занято другой конференцией. Выберите другое время."),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Новая конференция" }));
    fireEvent.change(screen.getByPlaceholderText("Например, планёрка отдела"), {
      target: { value: "Разбор задач" },
    });
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: futureDay() } });
    fireEvent.click(screen.getByRole("button", { name: "Создать конференцию" }));
    expect(await screen.findByText(/Это время уже занято другой конференцией/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Например, планёрка отдела")).toHaveValue("Разбор задач");
  });

  it("refuses an empty name and a start that has already passed", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Новая конференция" }));
    expect(screen.getByRole("button", { name: "Создать конференцию" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Например, планёрка отдела"), {
      target: { value: "Разбор задач" },
    });
    fireEvent.change(screen.getByLabelText("Дата"), { target: { value: "2020-01-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Создать конференцию" }));
    expect(await screen.findByText("Нельзя создать конференцию в прошлом.")).toBeInTheDocument();
    expect(createZoomMeeting).not.toHaveBeenCalled();
  });

  it("asks for confirmation before cancelling and only then calls the server", async () => {
    vi.mocked(cancelZoomMeeting).mockResolvedValue({ ...meeting, status: "cancelled" });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /Планёрка отдела/ }));
    fireEvent.click(screen.getByRole("button", { name: "Отменить конференцию" }));
    expect(cancelZoomMeeting).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Оставить" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отменить конференцию" }));
    fireEvent.click(screen.getByRole("button", { name: "Да, отменить" }));
    await waitFor(() => expect(cancelZoomMeeting).toHaveBeenCalledWith("test-token", "meeting-1"));
  });

  it("hides the link and the controls from an employee outside the meeting", async () => {
    mount({
      registry: {
        ...registry,
        meetings: [{
          ...meeting,
          organizerUserId: "peer",
          organizerName: "Азиза Каримова",
          participantIds: [],
          zoomMeetingId: null,
          joinUrl: null,
          passcode: null,
          canEdit: false,
          canCancel: false,
        }],
      },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Планёрка отдела/ }));
    expect(screen.queryByRole("button", { name: "Подключиться" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Отменить конференцию" })).not.toBeInTheDocument();
    expect(screen.getByText(/Ссылка доступна организатору/)).toBeInTheDocument();
  });

  it("explains that the section is idle while Zoom is not connected", async () => {
    mount({ registry: { ...registry, configured: false, meetings: [] } });
    expect(await screen.findByText("Zoom ещё не подключён")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Новая конференция" })).not.toBeInTheDocument();
  });

  it("reports a failed load instead of showing an empty schedule", async () => {
    mount({ registry: undefined, error: "Сервер вернул ошибку 502" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Сервер вернул ошибку 502");
  });

  it("warns when the host calendar could not be read", async () => {
    vi.mocked(loadZoomAvailability).mockResolvedValue({
      configured: true,
      timezone: "Asia/Tashkent",
      slotMinutes: 15,
      hostCalendarSynced: false,
      intervals: [],
    });
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Новая конференция" }));
    expect(await screen.findByText(/Календарь Zoom сейчас недоступен/)).toBeInTheDocument();
  });
});

describe("Conference formatting helpers", () => {
  it("groups the Zoom identifier the way Zoom prints it", () => {
    expect(formatMeetingId("81234567890")).toBe("812 3456 7890");
    expect(formatMeetingId("8123456789")).toBe("812 345 6789");
    expect(formatMeetingId(null)).toBe("");
  });

  it("builds the invitation with the link, the identifier and the passcode", () => {
    const text = invitationText(meeting, "Asia/Tashkent");
    expect(text).toContain("https://zoom.us/j/81234567890");
    expect(text).toContain("Идентификатор конференции: 812 3456 7890");
    expect(text).toContain("Код доступа: 7788");
    expect(text).toContain("09:00");
  });

  it("reads a wall time of the organization as the right absolute instant", () => {
    // Tashkent is UTC+5 all year, so 09:00 local is 04:00 UTC.
    expect(zonedWallTimeToIso("2026-10-01", "09:00", "Asia/Tashkent")).toBe("2026-10-01T04:00:00.000Z");
    expect(zonedWallTimeToIso("", "09:00", "Asia/Tashkent")).toBe("");
  });
});
