import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NavigationKey } from "@yuksalish/contracts";

import { AiModulesNavigation, groupAiNavigation, moveAiNavigationGroup } from "./AiModulesNavigation";

const items = [
  { key: "tasks" as NavigationKey, label: "Задачи", icon: <span>T</span> },
  { key: "ai_referent" as NavigationKey, label: "AI Referent", icon: <span>R</span> },
  { key: "feed" as NavigationKey, label: "Лента", icon: <span>F</span> },
  { key: "ai_hisobot" as NavigationKey, label: "AI Hisobot", icon: <span>H</span> },
];

function ControlledAiNavigation({ inline = false, inOverflow = false }: { inline?: boolean; inOverflow?: boolean }) {
  const [activeKey, setActiveKey] = useState<NavigationKey>("tasks");
  const [open, setOpen] = useState(false);
  return <AiModulesNavigation modules={[items[1]!, items[3]!]} activeKey={activeKey}
    inline={inline} inOverflow={inOverflow} open={open} onOpenChange={setOpen}
    onSelect={setActiveKey} />;
}

describe("AI module sidebar group", () => {
  afterEach(cleanup);

  it("retains an inert clipped inline list for reversible opening and closing", () => {
    const view = render(<AiModulesNavigation modules={[items[1]!, items[3]!]} activeKey="tasks" inline onSelect={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    const panel = view.container.querySelector(".rail-ai-disclosure")!;
    expect(panel).toHaveAttribute("inert");
    expect(screen.queryByRole("button", { name: "AI Referent" })).toBeNull();
    fireEvent.click(trigger);
    expect(panel).toHaveClass("is-open"); expect(panel).not.toHaveAttribute("inert");
    const link = screen.getByRole("button", { name: "AI Referent" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(panel).not.toHaveClass("is-open"); expect(panel).toHaveAttribute("inert");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("button", { name: "AI Referent" })).toBeNull();
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "AI Referent" })).toBe(link);
  });

  it("moves both AI modules as one block without losing other identities", () => {
    expect(moveAiNavigationGroup(["tasks", "ai_referent", "feed", "ai_hisobot"], "ai_modules", "tasks"))
      .toEqual(["ai_referent", "ai_hisobot", "tasks", "feed"]);
    expect(moveAiNavigationGroup(["ai_hisobot", "tasks", "ai_referent", "feed"], "ai_modules", "feed"))
      .toEqual(["tasks", "feed", "ai_hisobot", "ai_referent"]);
  });

  it("expands inline in the regular sidebar rather than creating a floating panel", () => {
    const view = render(<AiModulesNavigation modules={[items[1]!, items[3]!]} activeKey="tasks" inline onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    expect(view.container.querySelector(".rail-ai-inline .rail-ai-links")).not.toBeNull();
    expect(document.querySelector(".rail-ai-popover")).toBeNull();
  });

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
    render(<FluentProvider theme={webLightTheme}><AiModulesNavigation
      modules={[items[1]!, items[3]!]} activeKey="ai_hisobot"
      onSelect={onSelect}
    /></FluentProvider>);
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    expect(trigger).toHaveClass("has-active-module");
    expect(trigger).not.toHaveClass("active");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const nav = await screen.findByRole("navigation", { name: "Выбор ИИ-модуля" }, { timeout: 2000 });
    expect(within(nav).getByRole("button", { name: "AI Hisobot" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(within(nav).getByRole("button", { name: "AI Referent" }));
    expect(onSelect).toHaveBeenCalledWith("ai_referent");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("closes with Escape and returns focus to the group button", () => {
    render(<FluentProvider theme={webLightTheme}><AiModulesNavigation
      modules={[items[1]!, items[3]!]} activeKey="tasks"
      onSelect={vi.fn()}
    /></FluentProvider>);
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    fireEvent.click(trigger);
    expect(screen.getByRole("navigation", { name: "Выбор ИИ-модуля" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "Выбор ИИ-модуля" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("updates a collapsed-sidebar popover to the chosen palette", () => {
    const props = { modules: [items[1]!, items[3]!], activeKey: "tasks" as const, onSelect: vi.fn() };
    const view = render(<AiModulesNavigation {...props} sidebarTheme="navy" />);
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    const popover = screen.getByRole("dialog", { name: "ИИ-модули" });
    expect(popover).toHaveAttribute("data-sidebar-theme", "navy");
    view.rerender(<AiModulesNavigation {...props} sidebarTheme="light" />);
    expect(popover).toHaveAttribute("data-sidebar-theme", "light");
  });

  it("expands inside the More drawer without closing it", () => {
    const onSelect = vi.fn();
    render(<FluentProvider theme={webLightTheme}><AiModulesNavigation
      modules={[items[1]!, items[3]!]} activeKey="tasks" inOverflow
      onSelect={onSelect}
    /></FluentProvider>);
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    fireEvent.click(screen.getByRole("button", { name: "AI Hisobot" }));
    expect(onSelect).toHaveBeenCalledWith("ai_hisobot");
    expect(screen.getByRole("button", { name: "ИИ-модули" })).toHaveAttribute("aria-expanded", "true");
  });

  it.each([
    { name: "expanded sidebar", inline: true, inOverflow: false },
    { name: "collapsed sidebar popover", inline: false, inOverflow: false },
    { name: "More drawer", inline: false, inOverflow: true },
  ])("keeps the controlled group open when switching both modules in $name", ({ inline, inOverflow }) => {
    render(<ControlledAiNavigation inline={inline} inOverflow={inOverflow} />);
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    fireEvent.click(trigger);
    const referent = screen.getByRole("button", { name: "AI Referent" });
    const hisobot = screen.getByRole("button", { name: "AI Hisobot" });
    fireEvent.click(referent);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(referent).toHaveAttribute("aria-current", "page");
    expect(hisobot).not.toHaveAttribute("aria-current");
    fireEvent.click(hisobot);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(hisobot).toHaveAttribute("aria-current", "page");
    expect(referent).not.toHaveAttribute("aria-current");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "AI Hisobot" })).not.toBeInTheDocument();
  });
});
