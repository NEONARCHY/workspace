import { describe, expect, it } from "vitest";
import { createTripGeoIndex, resolveTripDestination, searchTripPlaces } from "./trip-geo";

const places = createTripGeoIndex({
  countries: [
    ["UZ", "Uzbekistan", [41.3, 69.2]],
    ["FR", "France", [46.6, 2.2]],
    ["US", "United States", [39.8, -98.6]],
  ],
  cities: [
    [1512569, "Tashkent", "UZ", 41.26465, 69.21627, 1900000, "13", ["Ташкен", "Ташкент", "Toshkent"]],
    [1215957, "Tirmiz", "UZ", 37.22417, 67.27833, 140000, "12", ["Термез", "Termiz"]],
    [3, "Paris", "FR", 48.8566, 2.3522, 2100000, "", ["Париж"]],
    [4, "Paris", "US", 33.66, -95.55, 24000, "TX", []],
  ],
});

describe("offline trip place suggestions", () => {
  it("finds Cyrillic aliases and keeps the chosen country unambiguous", () => {
    const suggestions = searchTripPlaces(places, "Таш");
    expect(suggestions[0]).toMatchObject({ id: "city:1512569", destination: "Ташкент, Узбекистан" });
    expect(resolveTripDestination(places, suggestions[0]!.destination)).toMatchObject({
      id: "city:1512569", latitude: 41.26465, longitude: 69.21627,
    });
    expect(searchTripPlaces(places, "Термиз")[0]?.id).toBe("city:1215957");
  });

  it("offers countries and does not guess an ambiguous city or free-text venue", () => {
    expect(searchTripPlaces(places, "Узбек").some((place) => place.id === "country:UZ")).toBe(true);
    expect(searchTripPlaces(places, "Ўзбе").some((place) => place.id === "country:UZ")).toBe(true);
    expect(resolveTripDestination(places, "Paris")).toBeUndefined();
    expect(resolveTripDestination(places, "Paris, Франция")?.id).toBe("city:3");
    expect(resolveTripDestination(places, "офис партнёра возле вокзала")).toBeUndefined();
  });

  it("rejects malformed geographical data", () => {
    expect(() => createTripGeoIndex({ cities: [[1, "Bad"]], countries: [] })).toThrow();
  });
});
