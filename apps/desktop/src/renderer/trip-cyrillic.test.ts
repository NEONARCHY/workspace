import { describe, expect, it } from "vitest";
import { tripCyrillic } from "./trip-cyrillic";

describe("Cyrillic trip document preview", () => {
  it.each([
    ["Oʻzbekiston", "Ўзбекистон"], ["G'ulom", "Ғулом"],
    ["Bosh mutaxassis", "Бош мутахассис"], ["Yuksalish", "Юксалиш"],
    ["ma'lumot va e'lon", "маълумот ва эълон"],
    ["Евгений ўз мақсадини ёзади", "Евгений ўз мақсадини ёзади"],
  ])("shows %s as %s without changing existing Cyrillic", (source, expected) => {
    expect(tripCyrillic(source)).toBe(expected);
  });
});
