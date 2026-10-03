import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationKey } from "@yuksalish/contracts";

import { AiModulesNavigation, groupAiNavigation } from "./AiModulesNavigation";

const items = [
  { key: "tasks" as NavigationKey, label: "Задачи", icon: <span>T</span> },
  { key: "ai_referent" as NavigationKey, label: "AI Referent", icon: <span>R</span> },
  { key: "feed" as NavigationKey, label: "Лента", icon: <span>F</span> },
  { key: "ai_hisobot" as NavigationKey, label: "AI Hisobot", icon: <span>H</span> },
];

describe("AI module sidebar group", () => {
  afterEach(cleanup);

  it("puts permitted AI modules in one slot at their first original position", () => {
    const grouped = groupAiNavigation(items);
    expect(grouped.map((item) => item.key)).toEqual(["tasks", "ai_modules", "feed"]);
    const group = grouped[1];
    expect(group?.key === "ai_modules" && group.modules.map((item) => item.key)).toEqual(["ai_referent", "ai_hisobot"]);
    expect(groupAiNavigation(items.filter((item) => item.key !== "ai_hisobot")).map((item) => item.key)).toEqual(["tasks", "ai_modules", "feed"]);
    expect(groupAiNavigation(items.filter((item) => !item.key.startsWith("ai_")))).toEqual([items[0], items[2]]);
  });

  it("opens with keyboard-friendly controls and navigates to the chosen module", async () => {
    const onSelect = vi.fn();
    const onCloseOverflow = vi.fn();
    render(<FluentProvider theme={webLightTheme}><AiModulesNavigation
      modules={[items[1]!, items[3]!]} activeKey="ai_hisobot"
      onSelect={onSelect} onCloseOverflow={onCloseOverflow}
    /></FluentProvider>);
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    expect(trigger).toHaveClass("active");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const nav = await screen.findByRole("navigation", { name: "Выбор ИИ-модуля" }, { timeout: 2000 });
    expect(within(nav).getByRole("button", { name: "AI Hisobot" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(nav).getByRole("button", { name: "AI Referent" }));
    expect(onSelect).toHaveBeenCalledWith("ai_referent");
    expect(onCloseOverflow).toHaveBeenCalledOnce();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("closes with Escape and returns focus to the group button", () => {
    render(<FluentProvider theme={webLightTheme}><AiModulesNavigation
      modules={[items[1]!, items[3]!]} activeKey="tasks"
      onSelect={vi.fn()} onCloseOverflow={vi.fn()}
    /></FluentProvider>);
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    fireEvent.click(trigger);
    expect(screen.getByRole("navigation", { name: "Выбор ИИ-модуля" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Выбор ИИ-модуля" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("expands inside the More drawer without closing it", () => {
    const onSelect = vi.fn();
    const onCloseOverflow = vi.fn();
    render(<FluentProvider theme={webLightTheme}><AiModulesNavigation
      modules={[items[1]!, items[3]!]} activeKey="tasks" inOverflow
      onSelect={onSelect} onCloseOverflow={onCloseOverflow}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    expect(onCloseOverflow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI Hisobot" }));
    expect(onSelect).toHaveBeenCalledWith("ai_hisobot");
    expect(onCloseOverflow).toHaveBeenCalledOnce();
  });
});
