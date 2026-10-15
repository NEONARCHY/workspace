/** Offline GeoNames search. No typed trip destination is sent to a map provider. */

export interface TripPlace {
  readonly id: string;
  readonly name: string;
  readonly context: string;
  readonly destination: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly kind: "city" | "country";
}

type CityRow = readonly [number, string, string, number, number, number, string, readonly string[]];
type CountryRow = readonly [string, string, readonly [number, number] | null];

interface CityEntry {
  readonly id: number;
  readonly name: string;
  readonly code: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly population: number;
  readonly region: string;
  readonly names: readonly string[];
  readonly normalizedNames: readonly string[];
}

interface CountryEntry {
  readonly code: string;
  readonly englishName: string;
  readonly localName: string;
  readonly center: readonly [number, number] | null;
  readonly normalizedNames: readonly string[];
}

export interface TripGeoIndex {
  readonly cities: readonly CityEntry[];
  readonly countries: readonly CountryEntry[];
  readonly countryByCode: ReadonlyMap<string, CountryEntry>;
  readonly cityNames: ReadonlyMap<string, readonly CityEntry[]>;
  readonly countryNames: ReadonlyMap<string, CountryEntry>;
}

interface Gazetteer { readonly cities: readonly CityRow[]; readonly countries: readonly CountryRow[] }

const extraNames: Readonly<Record<number, readonly string[]>> = {
  // Common Uzbek spelling not present in the source's older alternate-name row.
  1215957: ["Термиз"],
};
const preferredCyrillicNames: Readonly<Record<number, string>> = {
  1512569: "Ташкент", 1216265: "Самарканд", 1217662: "Бухара",
  601294: "Нукус", 1215957: "Термиз", 1514019: "Фергана",
  1513157: "Наманган", 1514588: "Андижан", 1216311: "Карши",
  1513131: "Навои",
};
const extraCountryNames: Readonly<Record<string, readonly string[]>> = {
  UZ: ["Ўзбекистон", "Oʻzbekiston", "O‘zbekiston", "Uzbekiston"],
  US: ["США", "AQSH", "USA"],
};

export function normalizeTripPlace(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
    .toLocaleLowerCase("ru-RU").replaceAll("ё", "е").replaceAll("ў", "у")
    .replace(/[ʻ‘’`']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function isGazetteer(value: unknown): value is Gazetteer {
  if (typeof value !== "object" || value === null || !("cities" in value) || !("countries" in value)) return false;
  if (!Array.isArray(value.cities) || !Array.isArray(value.countries)) return false;
  return value.cities.every((city: unknown) => Array.isArray(city) && city.length === 8 &&
    typeof city[0] === "number" && typeof city[1] === "string" && typeof city[2] === "string" &&
    typeof city[3] === "number" && typeof city[4] === "number" && typeof city[5] === "number" &&
    typeof city[6] === "string" && Array.isArray(city[7]) && city[7].every((alias: unknown) => typeof alias === "string")) &&
    value.countries.every((country: unknown) => Array.isArray(country) && country.length === 3 &&
      typeof country[0] === "string" && typeof country[1] === "string" &&
      (country[2] === null || (Array.isArray(country[2]) && country[2].length === 2 &&
        country[2].every((coordinate: unknown) => typeof coordinate === "number"))));
}

export function createTripGeoIndex(value: unknown): TripGeoIndex {
  if (!isGazetteer(value)) throw new Error("Справочник мест недоступен");
  const displayNames = new Intl.DisplayNames(["ru-RU"], { type: "region" });
  const countries: CountryEntry[] = value.countries.map(([code, englishName, center]) => {
    const localName = displayNames.of(code) ?? englishName;
    return {
      code, englishName, localName, center,
      normalizedNames: [...new Set([code, englishName, localName,
        ...(extraCountryNames[code] ?? [])].map(normalizeTripPlace))],
    };
  });
  const countryNames = new Map<string, CountryEntry>();
  const countryByCode = new Map(countries.map((country) => [country.code, country]));
  countries.forEach((country) => country.normalizedNames.forEach((name) => countryNames.set(name, country)));
  const cities: CityEntry[] = value.cities.map(([id, name, code, latitude, longitude, population, region, aliases]) => {
    const names = [...new Set([name, ...aliases, ...(extraNames[id] ?? [])])];
    return { id, name, code, latitude, longitude, population, region, names,
      normalizedNames: [...new Set(names.map(normalizeTripPlace))] };
  });
  const cityNames = new Map<string, CityEntry[]>();
  cities.forEach((city) => city.normalizedNames.forEach((name) => {
    const entries = cityNames.get(name) ?? [];
    entries.push(city);
    cityNames.set(name, entries);
  }));
  return { cities, countries, countryByCode, cityNames, countryNames };
}

let gazetteerPromise: Promise<TripGeoIndex> | undefined;
export function loadTripGeoIndex(): Promise<TripGeoIndex> {
  if (!gazetteerPromise) {
    gazetteerPromise = import("./assets/trip-places.json?url").then(async ({ default: url }) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Не удалось загрузить справочник мест");
      const raw: unknown = await response.json();
      return createTripGeoIndex(raw);
    }).catch((error: unknown) => { gazetteerPromise = undefined; throw error; });
  }
  return gazetteerPromise;
}

function cityPlace(city: CityEntry, name: string, index: TripGeoIndex): TripPlace {
  const country = index.countryByCode.get(city.code);
  const countryName = country?.localName ?? city.code;
  const sameName = index.cityNames.get(normalizeTripPlace(name))?.filter((entry) => entry.code === city.code) ?? [];
  const region = sameName.length > 1 && city.region ? ` (${city.region})` : "";
  return {
    id: `city:${city.id}`, name, context: `${countryName}${region ? ` · регион ${city.region}` : ""}`,
    destination: `${name}${region}, ${countryName}`,
    latitude: city.latitude, longitude: city.longitude, kind: "city",
  };
}

export function searchTripPlaces(index: TripGeoIndex, input: string, limit = 8): TripPlace[] {
  const [namePart = "", qualifier = ""] = input.split(",", 2);
  const term = normalizeTripPlace(namePart);
  const countryTerm = normalizeTripPlace(qualifier);
  if (term.length < 2) return [];
  const matching: { place: TripPlace; rank: number; population: number }[] = [];
  for (const city of index.cities) {
    const country = index.countryByCode.get(city.code);
    if (countryTerm && !country?.normalizedNames.some((name) => name.startsWith(countryTerm))) continue;
    const exact = city.normalizedNames.find((name) => name === term);
    const prefix = city.normalizedNames.find((name) => name.startsWith(term));
    const word = city.normalizedNames.find((name) => name.split(" ").some((part) => part.startsWith(term)));
    if (!exact && !prefix && !word) continue;
    const matched = exact ?? prefix ?? word;
    const displayedName = /[\u0400-\u04ff]/u.test(namePart)
      ? preferredCyrillicNames[city.id] ??
        city.names.find((name) => normalizeTripPlace(name) === matched && /[\u0400-\u04ff]/u.test(name)) ?? city.name
      : city.name;
    matching.push({ place: cityPlace(city, displayedName, index),
      rank: exact ? 0 : prefix ? 1 : 2, population: city.population });
  }
  if (!countryTerm) for (const country of index.countries) {
    if (!country.center) continue;
    const exact = country.normalizedNames.includes(term);
    if (!exact && !country.normalizedNames.some((name) => name.startsWith(term))) continue;
    matching.push({ place: { id: `country:${country.code}`, name: country.localName, context: "Страна",
      destination: country.localName, latitude: country.center[0], longitude: country.center[1], kind: "country" },
    rank: exact ? 0 : 1, population: 0 });
  }
  return matching.sort((left, right) => left.rank - right.rank || right.population - left.population)
    .slice(0, limit).map(({ place }) => place);
}

export function resolveTripDestination(index: TripGeoIndex, destination: string): TripPlace | undefined {
  const raw = destination.trim();
  const country = index.countryNames.get(normalizeTripPlace(raw));
  if (country?.center) return { id: `country:${country.code}`, name: country.localName,
    context: "Страна", destination: raw, latitude: country.center[0],
    longitude: country.center[1], kind: "country" };
  const [rawName = "", rawCountry = ""] = raw.split(",", 2);
  const regionMatch = rawName.match(/^(.*?)\s+\(([^)]+)\)$/u);
  const name = normalizeTripPlace(regionMatch?.[1] ?? rawName);
  const qualifiedCountry = rawCountry ? index.countryNames.get(normalizeTripPlace(rawCountry)) : undefined;
  if (rawCountry && !qualifiedCountry) return undefined;
  const matches = (index.cityNames.get(name) ?? []).filter((city) =>
    (!qualifiedCountry || city.code === qualifiedCountry.code) &&
    (!regionMatch || city.region === regionMatch[2]));
  if (matches.length !== 1) return undefined;
  return cityPlace(matches[0]!, regionMatch?.[1] ?? rawName, index);
}
