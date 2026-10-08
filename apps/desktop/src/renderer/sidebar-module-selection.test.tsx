import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NavigationKey } from "@yuksalish/contracts";
import { AdaptiveNavigation } from "./AdaptiveNavigation";
import { AiModulesNavigation, groupAiNavigation } from "./AiModulesNavigation";

const items = groupAiNavigation([
  { key: "tasks" as const, label: "Задачи", icon: null },
  { key: "ai_referent" as const, label: "AI Referent", icon: null },
  { key: "ai_hisobot" as const, label: "AI Hisobot", icon: null },
  { key: "calendar" as const, label: "Календарь", icon: null },
]);
let measure: (() => void) | undefined;
let calendarTop = 150;
let renders = 0;
let observed: Element[] = [];

function Sidebar() {
  renders++;
  const [active, setActive] = useState<NavigationKey>("tasks");
  const [open, setOpen] = useState(false);
  return <AdaptiveNavigation items={items} expandedItem={open ? { key: "ai_modules", height: 101 } : undefined}
    renderItem={(item) => <div className="rail-slot" key={item.key}>{item.key === "ai_modules"
      ? <AiModulesNavigation modules={item.modules} activeKey={active} inline open={open} onOpenChange={setOpen} onSelect={setActive} />
      : <button className={`rail-action${active === item.key ? " active" : ""}`} onClick={() => setActive(item.key)}>{item.label}</button>}
    </div>} />;
}

beforeEach(() => {
  calendarTop = 150; renders = 0; observed = []; measure = undefined;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(43);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(190);
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    return this.textContent === "AI Referent" ? 100 : this.textContent === "AI Hisobot" ? 146
      : this.textContent === "Календарь" ? calendarTop : 0;
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(readonly callback: () => void) {}
    observe(element: Element) {
      observed.push(element);
      if (element.matches(".rail-slot:has(.rail-ai-trigger)")) measure = this.callback;
    }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("sidebar module selection", () => {
  it("travels directly to the chosen module, never its disclosure trigger, and preserves mounted links", () => {
    const view = render(<Sidebar />);
    const indicator = view.container.querySelector<HTMLElement>(".sliding-segmented-indicator")!;
    const trigger = screen.getByRole("button", { name: "ИИ-модули" });
    fireEvent.click(trigger);
    expect(indicator.style.transform).toBe("translate(0px, 0px)");
    const referent = screen.getByRole("button", { name: "AI Referent" });
    fireEvent.click(referent);
    expect(trigger).not.toHaveClass("active");
    expect(trigger).toHaveClass("has-active-module");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(referent).toHaveAttribute("aria-current", "page");
    expect(indicator.style.transform).toBe("translate(0px, 100px)");
    expect(indicator.style.transition).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "AI Hisobot" }));
    expect(indicator.style.transform).toBe("translate(0px, 146px)");
    fireEvent.click(referent);
    expect(indicator.style.transform).toBe("translate(0px, 100px)");
    fireEvent.click(trigger);
    expect(indicator.style.opacity).toBe("0");
    fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "AI Referent" })).toBe(referent);
    expect(indicator).toHaveStyle({ transform: "translate(0px, 100px)", opacity: "1", transition: "none" });
  });

  it("follows rows displaced by disclosure without an extra selection tween or React render per frame", () => {
    const view = render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Календарь" }));
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    expect(observed).toContain(view.container.querySelector(".rail-slot:has(.rail-ai-trigger)"));
    const previousRenders = renders;
    const indicator = view.container.querySelector<HTMLElement>(".sliding-segmented-indicator")!;
    for (const top of [165, 190, 220, 251, 230, 180, 150]) {
      calendarTop = top;
      act(() => measure?.());
      expect(indicator).toHaveStyle({ transform: `translate(0px, ${top}px)`, transition: "none" });
    }
    expect(renders).toBe(previousRenders);
  });
});
