import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripDestinationPicker } from "./TripDestinationPicker";
import { loadTripGeoIndex } from "./trip-geo";

vi.mock("./trip-geo", () => ({
  loadTripGeoIndex: vi.fn(async () => ({})),
  searchTripPlaces: vi.fn(() => [
    { id: "city:1", name: "Ташкент", context: "Узбекистан", destination: "Ташкент, Узбекистан", latitude: 41.26, longitude: 69.22, kind: "city" },
    { id: "city:2", name: "Ташкентская область", context: "Узбекистан", destination: "Ташкентская область, Узбекистан", latitude: 41.1, longitude: 69.1, kind: "city" },
  ]),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("trip destination picker", () => {
  it("offers keyboard-accessible destinations while retaining free text", async () => {
    const onChange = vi.fn();
    render(<FluentProvider theme={webLightTheme}><TripDestinationPicker value="Таш" onChange={onChange} /></FluentProvider>);
    const field = screen.getByRole("combobox", { name: "Куда едем" });
    fireEvent.focus(field);
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(field).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Ташкентская область, Узбекистан");
    expect(field).toHaveAttribute("aria-expanded", "false");
    fireEvent.change(field, { target: { value: "Место встречи у вокзала" } });
    expect(onChange).toHaveBeenLastCalledWith("Место встречи у вокзала");
  });

  it("keeps manual entry available when the offline index fails, and can retry", async () => {
    vi.mocked(loadTripGeoIndex).mockRejectedValueOnce(new Error("unavailable"));
    const onChange = vi.fn();
    render(<FluentProvider theme={webLightTheme}><TripDestinationPicker value="Таш" onChange={onChange} /></FluentProvider>);
    const field = screen.getByRole("combobox", { name: "Куда едем" });
    fireEvent.focus(field);
    expect(await screen.findByText(/Справочник мест недоступен/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "повторите загрузку" }));
    expect(await screen.findAllByRole("option")).toHaveLength(2);
    fireEvent.change(field, { target: { value: "Адрес встречи" } });
    expect(onChange).toHaveBeenCalledWith("Адрес встречи");
  });
});
