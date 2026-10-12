import { describe, expect, it } from "vitest";
import { personalGreetingName } from "./personal-greeting-name";

describe("personal greeting", () => {
  it.each([
    ["Темур Алмазов", "Темур"], ["Бахтиёр Самугов", "Бахтиёр"],
    ["Мустафаева Саида Тельмановна", "Саида"], ["Самугов Бахтиёр", "Бахтиёр"],
    ["  Азиза   Каримова ", "Азиза"], ["Марина Иванова", "Марина"], ["Азиза", "Азиза"], ["", "коллега"],
  ])("extracts a short greeting from %s", (fullName, expected) => {
    expect(personalGreetingName(fullName)).toBe(expected);
  });
});
