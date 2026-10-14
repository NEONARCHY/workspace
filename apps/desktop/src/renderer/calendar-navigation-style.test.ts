import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("keeps the calendar navigation shell transparent without changing its buttons", () => {
  const read = (file: string) => readFileSync(resolve(process.cwd(), "src/renderer", file), "utf8");
  expect(read("styles.css")).toContain(".calendar-month-navigation { padding: 3px; border: 1px solid transparent; border-radius: 10px; background: transparent; box-shadow: none; }");
  for (const file of ["section-headers.css", "dark-theme.css"]) {
    expect(read(file)).not.toMatch(/:is\([^{}]*\.calendar-month-navigation\)\s*\{/);
  }
  expect(read("dark-theme.css")).toContain(".calendar-month-navigation .fui-Button");
});
