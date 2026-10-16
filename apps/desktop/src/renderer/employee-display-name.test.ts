import { describe, expect, it } from "vitest";
import { employeeDisplayName, employeeDisplayPerson, employeeInitials } from "./employee-display-name";

describe("employee labels outside the directory", () => {
  it.each([
    ["Каримова Нигора Рустамовна", "Нигора Каримова", "НК"],
    ["Самугов Бахтиёр", "Бахтиёр Самугов", "БС"],
    ["Бахтиёр Самугов", "Бахтиёр Самугов", "БС"],
    ["  Темур   Алмазов  ", "Темур Алмазов", "ТА"],
    ["Aziza Karimova", "Aziza Karimova", "AK"],
    ["Karimova Aziza Qizi", "Aziza Karimova", "AK"],
    ["Нигора", "Нигора", "Н"],
  ])("formats %s", (fullName, label, initials) => {
    expect(employeeDisplayName(fullName)).toBe(label);
    expect(employeeInitials(fullName)).toBe(initials);
  });

  it("creates a display-only person without changing the stored full name", () => {
    const person = { id: "nigora", name: "Каримова Нигора Рустамовна", initials: "КН",
      role: "employee" as const, color: "#0091a8" };
    expect(employeeDisplayPerson(person)).toMatchObject({ name: "Нигора Каримова", initials: "НК" });
    expect(person.name).toBe("Каримова Нигора Рустамовна");
  });
});
