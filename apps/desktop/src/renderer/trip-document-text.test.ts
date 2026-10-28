import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import { tripBriefPreview } from "./trip-brief-generator";
import { tripDestinationPhrase, tripDestinationText, tripDocumentText } from "./trip-document-text";

const cases: [string, string, string][] = JSON.parse(readFileSync(
  new URL("../../../../tests/fixtures/trip-destination-phrases.json", import.meta.url), "utf8",
));

describe("Uzbek trip destination grammar (shared API cases)", () => {
  it.each(cases)("%s", (source, name, phrase) => {
    expect(tripDestinationText(source)).toBe(name);
    expect(tripDestinationPhrase(source)).toBe(phrase);
    expect(tripDestinationPhrase(phrase)).toBe(phrase);
    expect(tripBriefPreview({ destination: source, startDate: "2026-10-28", endDate: "2026-10-29",
      purpose: "Loyiha doirasida joylarda monitoring o'tkazish", expenseSource: "Loyiha mablag'lari",
    })).toContain(`${phrase} xizmat safari rejalashtirilgan`);
  });

  it.each([
    ["Ferghana, Uzbekistan hududiga", "Farg'ona shahriga"],
    ["Ferghana, Uzbekistanga", "Farg'ona shahriga"],
    ["Ферганская область hududiga", "Farg'ona viloyatiga"],
    ["Xiva shahri hududiga", "Xiva shahriga"],
    ["Xiva hududiga", "Xiva shahriga"],
  ])("normalizes saved %s", (source, phrase) => {
    expect(tripDocumentText(`Safar: ${source}.\n\nMaqsad o'zgarmaydi.`))
      .toBe(`Safar: ${phrase}.\n\nMaqsad o'zgarmaydi.`);
  });
});
