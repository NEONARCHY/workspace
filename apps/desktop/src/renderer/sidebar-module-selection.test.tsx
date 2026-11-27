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
let renders = 0;
let observed: Element[] = [];
function Sidebar() {
  renders++;
  const [active, setActive] = useState<NavigationKey>("tasks");
  const [open, setOpen] = useState(false);
  return <AdaptiveNavigation items={items} expandedItem={open ? { key: "ai_modules", height: 101 } : undefined}
    renderItem={item => <div className="rail-slot" key={item.key}>{item.key === "ai_modules"
      ? <AiModulesNavigation modules={item.modules} activeKey={active} inline open={open} onOpenChange={setOpen} onSelect={setActive} />
      : <button className={`rail-action${active === item.key ? " active" : ""}`} onClick={() => setActive(item.key)}>{item.label}</button>}
    </div>} />;
}
beforeEach(() => {
  renders = 0; observed = []; measure = undefined;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(44);
  vi.stubGlobal("ResizeObserver", class {
    constructor(readonly callback: () => void) {}
    observe(element: Element) { observed.push(element); if (element.matches(".adaptive-rail-nav")) measure = this.callback; }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("sidebar module selection", () => {
  it("selects the module locally without a travelling surface and preserves mounted links", () => {
    const view = render(<Sidebar />), trigger = screen.getByRole("button", { name: "ИИ-модули" });
    fireEvent.click(trigger);
    const referent = screen.getByRole("button", { name: "AI Referent" });
    for (const label of ["AI Referent", "AI Hisobot", "AI Referent"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(trigger).not.toHaveClass("active"); expect(trigger).toHaveClass("has-active-module");
      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
      expect(view.container.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(view.container.querySelector(".sliding-segmented-indicator")).toBeNull();
    }
    fireEvent.click(trigger); fireEvent.click(trigger);
    expect(screen.getByRole("button", { name: "AI Referent" })).toBe(referent);
  });
  it("does not measure or observe selection coordinates during disclosure layout changes", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Календарь" }));
    fireEvent.click(screen.getByRole("button", { name: "ИИ-модули" }));
    const previousRenders = renders, observations = observed.length;
    const coordinateReads = vi.spyOn(HTMLElement.prototype, "offsetTop", "get");
    for (let frame = 0; frame < 7; frame++) act(() => measure?.());
    expect(screen.getByRole("button", { name: "Календарь" })).toHaveClass("active");
    expect(observed.every(element => element.matches(".adaptive-rail-nav"))).toBe(true);
    expect(observed).toHaveLength(observations); expect(coordinateReads).not.toHaveBeenCalled();
    expect(renders).toBe(previousRenders);
  });
  it("keeps the capacity observer across counter updates and marks an active overflow section", () => {
    const renderItems = (label = "Задачи") => <AdaptiveNavigation items={items.map(item => item.key === "tasks" ? { ...item, label } : { ...item })}
      activeKey="calendar" renderItem={item => <button key={item.key} className="rail-action">{item.label}</button>} />;
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
    const view = render(renderItems()), observations = observed.length;
    view.rerender(renderItems("Задачи 18"));
    expect(observed).toHaveLength(observations);
    const more = screen.getByRole("button", { name: /Ещё,/ });
    expect(more).toHaveClass("has-active-section"); expect(more).toHaveAttribute("aria-description", "Текущий раздел: Календарь");
  });
});
