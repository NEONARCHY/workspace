import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EfficiencyOverview } from "@yuksalish/contracts";

import { EfficiencyView } from "./EfficiencyView";
import { workspaceTheme } from "./workspace-theme";

afterEach(cleanup);

const overview: EfficiencyOverview = {
  period: "2026-09",
  timezone: "Asia/Tashkent",
  methodologyVersion: "EFF-1.0",
  trackingStartedAt: "2026-09-07T06:00:00Z",
  currentUserId: "u-1",
  employees: [
    {
      userId: "u-1", name: "Азиза Каримова", jobTitle: "Координатор", period: "2026-09",
      timezone: "Asia/Tashkent", percentage: 80, onTimeCount: 8, eligibleCount: 10,
      overdueCount: 2, awaitingReviewCount: 1, noDueDateCount: 3,
      returnedForRevisionCount: 1, excludedCount: 1, sampleSize: 10,
      methodologyVersion: "EFF-1.0", trackingStartedAt: "2026-09-07T06:00:00Z",
      historyCompleteness: "partial", smallSample: false,
      history: [
        { period: "2026-08", percentage: null, onTimeCount: 0, eligibleCount: 0, historyCompleteness: "unavailable" },
        { period: "2026-09", percentage: 80, onTimeCount: 8, eligibleCount: 10, historyCompleteness: "partial" },
      ],
    },
    {
      userId: "u-2", name: "Бахтиёр Самугов", jobTitle: "Руководитель", period: "2026-09",
      timezone: "Asia/Tashkent", percentage: null, onTimeCount: 0, eligibleCount: 0,
      overdueCount: 0, awaitingReviewCount: 0, noDueDateCount: 1,
      returnedForRevisionCount: 0, excludedCount: 0, sampleSize: 0,
      methodologyVersion: "EFF-1.0", trackingStartedAt: "2026-09-07T06:00:00Z",
      historyCompleteness: "partial", smallSample: false,
      history: [],
    },
  ],
};

function renderView(onPeriodChange = vi.fn()) {
  return render(<FluentProvider theme={workspaceTheme}><EfficiencyView overview={overview} loading={false} onPeriodChange={onPeriodChange} /></FluentProvider>);
}

describe("EfficiencyView", () => {
  it("shows a transparent formula, sample size and no-data state", () => {
    renderView();

    expect(screen.getByLabelText(/Выполнение задач в срок: 80%/)).toHaveTextContent("8 из 10 задач");
    expect(screen.getByLabelText(/Данные доступны для 1 из 2 сотрудников/)).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: /Нет данных/ })).toBeInTheDocument();
    expect(screen.getByText(/Это не рейтинг\./)).toBeInTheDocument();
  });

  it("opens the full methodology in a dialog instead of a tooltip", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "?" }));

    expect(screen.getByRole("dialog", { name: "Как считается показатель" })).toBeInTheDocument();
    expect(screen.getByText(/не должен автоматически использоваться для штрафов/)).toBeInTheDocument();
    expect(screen.getByText(/Начало достоверного учёта в системе/)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a colleague aggregate without exposing task details", () => {
    renderView();
    fireEvent.click(screen.getByRole("row", { name: "Открыть сводку: Бахтиёр Самугов" }));

    expect(screen.getByRole("article", { name: "Сводка сотрудника: Бахтиёр Самугов" })).toBeInTheDocument();
    expect(screen.queryByText(/task-/i)).not.toBeInTheDocument();
  });

  it("exposes real chart data as both an accessible graphic and text", () => {
    const history = [
      { period: "2026-08", percentage: 75, onTimeCount: 3, eligibleCount: 4, historyCompleteness: "complete" as const },
      { period: "2026-09", percentage: 80, onTimeCount: 8, eligibleCount: 10, historyCompleteness: "partial" as const },
    ];
    render(<FluentProvider theme={workspaceTheme}><EfficiencyView overview={{ ...overview, employees: [{ ...overview.employees[0]!, history }, overview.employees[1]!] }} loading={false} onPeriodChange={vi.fn()} /></FluentProvider>);

    expect(screen.getByRole("img", { name: /Динамика выполнения в срок/ })).toBeInTheDocument();
    expect(screen.getByText("75% · 3 из 4")).toBeInTheDocument();
    expect(screen.queryByText("0% · 0 из 0")).not.toBeInTheDocument();
  });

  it("keeps the page and narrow table independently scrollable with focus and reduced-motion states", () => {
    const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");

    expect(css).toMatch(/\.efficiency-view\s*\{[^}]*overflow-y:\s*auto/s);
    expect(css).toMatch(/\.eff-table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.eff-chart-line\s*\{[^}]*filter:\s*url\(#eff-line-glow\)/s);
    expect(css).toMatch(/\.eff-table-scroll:focus-visible/);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  });
});
