import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LoadingSkeleton, SkeletonBlock, SkeletonTableRows } from "./LoadingSkeleton";

afterEach(cleanup);
it.each(["lines", "rows", "table", "cards", "metrics", "form", "profile", "calendar", "board", "map"] as const)("reserves a %s slot with no fake data or controls", layout => {
  const { container } = render(<LoadingSkeleton layout={layout} label="Загружаем данные раздела" />);
  expect(screen.getByRole("status", { name: "Загружаем данные раздела" })).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector(".ws-skeleton-layout")).toHaveAttribute("aria-hidden", "true");
  expect(container.querySelector("button, a, input, [tabindex]")).toBeNull();
  expect(container.querySelectorAll(".ws-skeleton-block").length).toBeGreaterThan(0);
});
it("bounds repeated rows and does not manufacture zero-value records", () => {
  const { container } = render(<LoadingSkeleton layout="table" rows={500} />);
  expect(container.querySelectorAll(".ws-skeleton-item")).toHaveLength(12);
  expect(screen.queryByText("0")).toBeNull();
});
it("reuses each list's own row layout instead of inventing avatars or columns", () => {
  const { container } = render(<LoadingSkeleton layout="custom"><div className="survey-analysis-list"><div className="survey-analysis-item"><SkeletonBlock /></div></div></LoadingSkeleton>);
  expect(container.querySelectorAll(".survey-analysis-item")).toHaveLength(1);
  expect(container.querySelector(".ws-skeleton-item")).toBeNull();
  expect(container.querySelector("[data-skeleton-deferred]")).not.toBeNull();
});
it("places placeholders inside the real table with its exact column count", () => {
  const { container } = render(<table className="employee-record-table"><thead><tr><th>Сотрудник</th></tr></thead><SkeletonTableRows columns={7} rows={7} personColumn={1} selectionColumn={0} rowClassName="record-row employee-row" /></table>);
  expect(container.querySelectorAll("tbody tr.employee-row")).toHaveLength(7);
  expect(container.querySelectorAll("tbody tr:first-child td")).toHaveLength(7);
  expect(container.querySelectorAll("tbody .is-circle")).toHaveLength(7);
  expect(container.querySelector("tbody")).toHaveAttribute("aria-busy", "true");
  expect(container.querySelector("tbody")).toHaveAttribute("data-skeleton-deferred");
});
it("uses a transform shimmer with static reduced-motion/forced-colour fallbacks", () => {
  const css = readFileSync("src/renderer/loading-skeleton.css", "utf8");
  expect(css).toContain("transform: translateX(100%)");
  expect(css).toContain("(prefers-reduced-motion: reduce), (forced-colors: active)");
  expect(css).toContain("animation: none; display: none");
  expect(css).not.toMatch(/!important|position:\s*fixed|backdrop-filter|transition:\s*all/);
  const home = readFileSync("src/renderer/PersonalHomeView.tsx", "utf8");
  expect(home).not.toMatch(/initialLoading|home-initial-loader|inert=/);
  const app = readFileSync("src/renderer/App.tsx", "utf8");
  expect(app).not.toContain("SectionLoadingSkeleton");
  expect(app).not.toContain("ws-settings-skeleton");
  expect(app).toContain("<WorkspaceSectionContent authorityKey=");
  expect(readFileSync("src/renderer/workspace-module-preload.tsx", "utf8")).toContain('export { PersonalHomeView } from "./PersonalHomeView"');
});
it("defers the entire placeholder for 250ms, retaining geometry without a minimum loading hold", () => {
  const css = readFileSync("src/renderer/loading-skeleton.css", "utf8");
  expect(css).toContain("visibility: hidden; animation: ws-skeleton-reveal 0s linear 250ms forwards");
  expect(css).toContain("@keyframes ws-skeleton-reveal { to { visibility: visible; } }");
  expect(css).not.toMatch(/display:\s*none[^}]*ws-skeleton-reveal/);
});
