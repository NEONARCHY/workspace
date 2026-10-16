import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import type { TripRequest, WorkspacePerson } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripWorldMap } from "./TripWorldMap";

vi.mock("./trip-geo", () => ({
  loadTripGeoIndex: vi.fn(async () => ({})),
  resolveTripDestination: vi.fn((_index, destination: string) => destination === "Ташкент, Узбекистан"
    ? { id: "city:1", name: "Ташкент", context: "Узбекистан", destination,
      latitude: 41.26465, longitude: 69.21627, kind: "city" } : undefined),
}));

const people: WorkspacePerson[] = [
  { id: "worker-1", name: "Нигора Шокирова", initials: "НШ", color: "#456789", role: "employee", status: "active" },
];
const base: TripRequest = {
  id: "trip-1", number: "TR-001", requesterUserId: "worker-1", purpose: "Встреча",
  destination: "Ташкент, Узбекистан", startDate: "2026-10-20", endDate: "2026-10-22",
  employeeIds: ["worker-1"], stage: "approved", stageLabel: "Утверждено", status: "approved",
  statusLabel: "Утверждено", canEdit: false, allowedActions: [], actions: [],
  createdAt: "2026-10-15T08:00:00Z", updatedAt: "2026-10-15T08:00:00Z",
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("trip world map", () => {
  it("shows only approved visible trips and opens a selected trip", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ path: "M0,0L5,0L5,5Z" }) })));
    const onOpenRequest = vi.fn();
    render(<FluentProvider theme={webLightTheme}><TripWorldMap
      requests={[base, { ...base, id: "trip-2", number: "TR-002", destination: "адрес партнёра" },
        { ...base, id: "trip-3", number: "TR-003", status: "rejected", stage: "rejected" }]}
      people={people} onOpenRequest={onOpenRequest} onClose={vi.fn()} />
    </FluentProvider>);
    const map = await screen.findByRole("group", { name: "Карта мира с отметками утверждённых поездок" });
    expect(screen.getByRole("button", { name: "К поездкам" })).toHaveFocus();
    expect(map.querySelectorAll("[data-trip-pin]")).toHaveLength(1);
    const locationList = screen.getByLabelText("Поездки на карте");
    const pin = within(map).getByRole("button", { name: /Ташкент/ });
    expect(pin).toHaveAccessibleName(/1 поездка/);
    fireEvent.focus(pin);
    expect(screen.getByRole("status")).toHaveTextContent("Нигора Шокирова");
    fireEvent.keyDown(pin, { key: "Enter" });
    expect(within(locationList).getByText("Нигора Шокирова")).toBeInTheDocument();
    fireEvent.click(within(locationList).getByRole("button", { name: "Открыть карточку" }));
    expect(onOpenRequest).toHaveBeenCalledWith("trip-1");
    const clearSelection = screen.getByRole("button", { name: "Сбросить выбор места" });
    expect(clearSelection).toHaveClass("trip-map-clear-selection");
    fireEvent.click(clearSelection);
    expect(screen.queryByRole("button", { name: "Сбросить выбор места" })).not.toBeInTheDocument();
    expect(within(locationList).getByRole("button", { name: /Ташкент/ })).toBeInTheDocument();
    expect(screen.getByText("Поездки без точной отметки")).toBeInTheDocument();
    expect(screen.queryByText("TR-003")).not.toBeInTheDocument();
  });

  it("shows a recoverable error when the local map asset cannot be loaded", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ path: "M0,0L5,0L5,5Z" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<FluentProvider theme={webLightTheme}><TripWorldMap
      requests={[base]} people={people} onOpenRequest={vi.fn()} onClose={vi.fn()} />
    </FluentProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Карту не удалось загрузить");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByRole("group", { name: "Карта мира с отметками утверждённых поездок" })).toBeInTheDocument();
  });

  it("frames trip locations and zooms with the wheel, selected pin and keyboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ path: "M0,0L5,0L5,5Z" }) })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    vi.stubGlobal("PointerEvent", MouseEvent);
    render(<FluentProvider theme={webLightTheme}><TripWorldMap
      requests={[base]} people={people} onOpenRequest={vi.fn()} onClose={vi.fn()} />
    </FluentProvider>);
    const map = await screen.findByRole("group", { name: "Карта мира с отметками утверждённых поездок" });
    await waitFor(() => expect(map.getAttribute("viewBox")).not.toBe("0 0 1000 500"));
    const initialWidth = Number(map.getAttribute("viewBox")!.split(" ")[2]);
    vi.spyOn(map, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 1000, height: 500, right: 1000, bottom: 500,
      x: 0, y: 0, toJSON: () => ({}),
    });
    fireEvent.wheel(map, { deltaY: -100, clientX: 500, clientY: 250 });
    expect(Number(map.getAttribute("viewBox")!.split(" ")[2])).toBeLessThan(initialWidth);
    fireEvent.click(screen.getByRole("button", { name: /Ташкент: 1 поездка/ }));
    expect(screen.getByRole("heading", { name: "Ташкент" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ташкент: 1 поездка/ }));
    expect(screen.getByLabelText("Масштаб 8.0")).toBeInTheDocument();
    fireEvent.keyDown(map, { key: "Home" });
    expect(map).toHaveAttribute("viewBox", "0 0 1000 500");
    fireEvent.click(screen.getByRole("button", { name: "Все места" }));
    expect(Number(map.getAttribute("viewBox")!.split(" ")[2])).toBeLessThan(1000);
    const beforePan = Number(map.getAttribute("viewBox")!.split(" ")[0]);
    map.setPointerCapture = vi.fn();
    fireEvent.pointerDown(map, { pointerId: 1, pointerType: "mouse", button: 0, clientX: 500, clientY: 250 });
    fireEvent.pointerMove(map, { pointerId: 1, pointerType: "mouse", clientX: 550, clientY: 250 });
    fireEvent.pointerUp(map, { pointerId: 1 });
    expect(Number(map.getAttribute("viewBox")!.split(" ")[0])).toBeLessThan(beforePan);
    fireEvent.keyDown(map, { key: "Home" });
    fireEvent.doubleClick(map, { clientX: 500, clientY: 250 });
    expect(Number(map.getAttribute("viewBox")!.split(" ")[2])).toBeLessThan(1000);
  });
});
