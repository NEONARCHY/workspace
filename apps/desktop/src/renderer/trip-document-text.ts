/** Reviewed Uzbek place names; kept in parity with API by shared regression cases. */
const cyrillic = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяўқғҳ";
const latin = ["a", "b", "v", "g", "d", "e", "yo", "j", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "x", "ts", "ch", "sh", "shch", "ʼ", "i", "", "e", "yu", "ya", "oʻ", "q", "gʻ", "h"] as const;
const replacements = new Map([...cyrillic].map((letter, index) => [letter, latin[index] ?? letter]));

export function tripTextToLatin(value: string): string {
  const translated = [...value].map((letter) => {
    const result = replacements.get(letter.toLowerCase());
    return result === undefined ? letter : letter === letter.toUpperCase()
      ? result.charAt(0).toUpperCase() + result.slice(1) : result;
  }).join("");
  return value === value.toUpperCase() ? translated.toUpperCase() : translated;
}

const regions: Readonly<Record<string, string>> = {
  "Андижанская область": "Andijon viloyati", "Бухарская область": "Buxoro viloyati",
  "Джизакская область": "Jizzax viloyati", "Кашкадарьинская область": "Qashqadaryo viloyati",
  "Навоийская область": "Navoiy viloyati", "Наманганская область": "Namangan viloyati",
  "Самаркандская область": "Samarqand viloyati", "Сурхандарьинская область": "Surxondaryo viloyati",
  "Сырдарьинская область": "Sirdaryo viloyati", "Ташкентская область": "Toshkent viloyati",
  "Ферганская область": "Farg'ona viloyati", "Хорезмская область": "Xorazm viloyati",
  "Республика Каракалпакстан": "Qoraqalpog'iston Respublikasi", "город Ташкент": "Toshkent shahri",
};
const cities: Readonly<Record<string, readonly string[]>> = {
  Andijon: ["Андижан", "Andijan"], Buxoro: ["Бухара", "Bukhara"],
  Jizzax: ["Джизак", "Jizzakh"], Qarshi: ["Карши", "Karshi"], Navoiy: ["Навои", "Navoi"],
  Namangan: ["Наманган"], Samarqand: ["Самарканд", "Samarkand"],
  Termiz: ["Термез", "Термиз", "Termez"], Guliston: ["Гулистан", "Gulistan"],
  Toshkent: ["Ташкент", "Tashkent"], "Farg'ona": ["Фергана", "Фарғона", "Fergana", "Ferghana"],
  Urganch: ["Ургенч", "Urgench"], Nukus: ["Нукус"], Xiva: ["Хива", "Khiva"],
};
const apostrophes = ["'", "ʻ", "ʼ", "‘", "’"];
const canonicalApostrophes = (value: string) => value.replace(/['ʻʼ‘’]/gu, "'");
const aliases = new Map<string, string>();
const bareCities = new Map<string, string>();
function addAlias(alias: string, name: string): void {
  for (const variant of [alias, tripTextToLatin(alias)]) {
    for (const apostrophe of apostrophes) {
      aliases.set(variant.replace(/['ʻʼ‘’]/gu, apostrophe).toLowerCase(), name);
    }
  }
}
for (const [alias, name] of Object.entries(regions)) {
  addAlias(alias, name);
  addAlias(name, name);
}
for (const [city, variants] of Object.entries(cities)) {
  for (const alias of [city, ...variants]) {
    for (const variant of [alias, tripTextToLatin(alias)]) {
      bareCities.set(canonicalApostrophes(variant).toLowerCase(), city);
    }
    for (const label of [`город ${alias}`, `г. ${alias}`, `${alias} shahri`]) addAlias(label, `${city} shahri`);
    addAlias(`${alias} hududiga`, `${city} shahriga`);
    for (const country of ["Uzbekistan", "Узбекистан", "O'zbekiston", "Ўзбекистон"]) {
      addAlias(`${alias}, ${country}`, `${city} shahri`);
    }
  }
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${[...aliases.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join("|")})(ga)?(?![\\p{L}\\p{N}_])`, "giu");
const adminEnding = /\b(viloyati|shahri|tumani|respublikasi)(?:ga)?$/iu;

export function tripDocumentText(value: string): string {
  return tripTextToLatin(value).replace(pattern, (_match: string, place: string, direction: string | undefined) =>
    (aliases.get(place.toLowerCase()) ?? place) + (direction ?? ""))
    .replace(/\b(viloyati|shahri|tumani|respublikasi)(?:ga)?(?:\s+hududiga|ga)\b/giu, "$1ga");
}

export function tripDestinationText(value: string): string {
  const normalized = tripDocumentText(value.replace(/\s+/gu, " ").trim());
  const city = bareCities.get(canonicalApostrophes(normalized).toLowerCase());
  return city ? `${city} shahri` : normalized;
}

export function tripDestinationPhrase(value: string): string {
  const place = tripDestinationText(value);
  if (adminEnding.test(place)) return place.replace(adminEnding, "$1ga");
  return place.toLowerCase().endsWith(" hududiga") ? place : `${place} hududiga`;
}
