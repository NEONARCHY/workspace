import { describe, expect, it } from "vitest";
import tripPlaces from "./assets/trip-places.json";
import { createTripGeoIndex, resolveTripDestination, resolveTripDestinations, searchTripPlaces } from "./trip-geo";

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


describe("saved trip routes", () => {
  const index = createTripGeoIndex(tripPlaces);

  it.each([
    ["Андижон, Фаргона, Наманган", ["city:1514588", "city:1514019", "city:1513157"]],
    ["Surxondaryo viloyati, Termiz shahri", ["city:1215957"]],
    ["Сурхандарьинская область, г. Термез", ["city:1215957"]],
    ["Бухара, Узбекистан → Термиз, Узбекистан", ["city:1217662", "city:1215957"]],
  ])("resolves every known stop in %s", (route, expected) => {
    const result = resolveTripDestinations(index, route);
    expect(result.places.map(({ id }) => id)).toEqual(expected);
    expect(result.incomplete).toBe(false);
  });

  it("marks a region at its labeled administrative center", () => {
    expect(resolveTripDestinations(index, "Qoraqalpog'iston Respublikasi")).toMatchObject({
      places: [{ id: "region:UZ:09", kind: "region", context: "Административный центр · Нукус" }],
      incomplete: false,
    });
  });

  it("deduplicates repeated stops and keeps unresolved or contradictory stops visible", () => {
    expect(resolveTripDestinations(index, "Андижон, Андижан; офис партнёра возле вокзала")).toMatchObject({
      places: [{ id: "city:1514588" }], incomplete: true,
    });
    expect(resolveTripDestinations(index, "Surxondaryo viloyati, Andijon")).toEqual({
      places: [], incomplete: true,
    });
    expect(resolveTripDestinations(places, "Paris")).toEqual({ places: [], incomplete: true });
  });
});
