import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAssistantLauncherLayout } from "./useAssistantLauncherLayout";

function Header({ vacated = false, disabled = false, paired = false, compact = false }) {
  const launcher = useRef<HTMLButtonElement>(null);
  useAssistantLauncherLayout(launcher, vacated, disabled, 1, "desktop");
  return <div className="global-bar"><div className="workspace-top-context" style={{ columnGap: 12 }}>
    <div className="workspace-workday-status"><div className="topbar-insights">Курсы и погода</div></div>
    <div className="notification-bell-wrap"><button className="notification-bell"><span className="notification-bell-icon" /></button></div>
    <div className="color-theme-toggle-wrap"><button className="color-theme-toggle"><svg /></button></div>
    <span className="assistant-launcher-space" data-vacated={vacated || undefined}><button ref={launcher} /></span>
    {paired ? <div className="workspace-workday-person" style={compact ? { display: "contents" } : undefined}><button className="workday-control">Начать работу</button>
      <div className="workspace-identity" style={compact ? { display: "contents" } : undefined}><button className="workspace-identity-menu"><span className="fui-Avatar" /></button></div>
    </div> : <div className="workspace-identity"><button className="workspace-identity-menu"><span className="fui-Avatar" /></button></div>}
  </div></div>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const vacated = Boolean(document.querySelector("[data-vacated]"));
    const x = this.matches(".fui-Avatar") && document.querySelector(".workspace-workday-person") ? 400
      : this.matches(".notification-bell-wrap") ? (vacated ? 100 : 40)
      : this.matches(".workspace-workday-status") ? (vacated ? 20 : -40)
      : this.matches(".workspace-identity-menu, .workday-control") ? (vacated ? 152 : 212)
      : this.matches("svg") ? (vacated ? 172 : 112)
      : this.matches(".color-theme-toggle-wrap, .color-theme-toggle") ? (vacated ? 160 : 100)
      : this.matches(".assistant-launcher-space") ? (vacated ? 212 : 152) : 212;
    return new DOMRect(x, this.matches("svg") ? 12 : 0, this.matches("svg") ? 16 : this.matches(".assistant-launcher-space") ? 48 : 40,
      this.matches("svg") ? 16 : 40);
  });
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, finished: new Promise<void>(() => {}) } as unknown as Animation));
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  return { animate, cancel };
}
describe("assistant header layout", () => {
  it("animates real compact controls instead of display:contents wrappers without doubling desktop motion", () => {
    const { animate } = fixture();
    const view = render(<Header paired compact />);
    view.rerender(<Header paired compact vacated />);
    let moving = animate.mock.instances as Element[];
    expect(moving.some(node => node.matches(".workday-control"))).toBe(true);
    expect(moving.some(node => node.matches(".workspace-identity-menu"))).toBe(true);
    expect(moving.some(node => node.matches(".workspace-workday-person, .workspace-identity"))).toBe(false);
    view.unmount();
    animate.mockClear();
    const desktop = render(<Header paired />);
    desktop.rerender(<Header paired vacated />);
    moving = animate.mock.instances as Element[];
    expect(moving.some(node => node.matches(".workday-control, .workspace-identity-menu"))).toBe(false);
  });
  it("stays in its gap before the workday/profile pair, not over the workday button", () => {
    fixture();
    const view = render(<Header paired />);
    expect(view.container.querySelector(".assistant-launcher-space button")).toHaveStyle("--assistant-launcher-offset: 0px");
  });
  it("aligns the real button with the orb and translates neighbours without scaling", () => {
    const { animate } = fixture();
    const view = render(<Header />);
    expect(view.container.querySelector(".assistant-launcher-space button")).toHaveStyle("--assistant-launcher-offset: 0px");
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Header vacated />);
    expect(animate).toHaveBeenCalledWith([{ transform: "translate(-60px, 0px)" }, { transform: "translate(0, 0)" }],
      { duration: 320, easing: "cubic-bezier(.2, 0, 0, 1)" });
    const moving = animate.mock.instances as Element[];
    expect(moving.some(node => node.matches(".notification-bell-wrap"))).toBe(true);
    expect(moving.some(node => node.matches(".workspace-workday-status"))).toBe(true);
    expect(moving.some(node => node.matches(".notification-bell-icon"))).toBe(false);
  });
  it("cancels an interrupted movement and returns the neighbours on close", () => {
    const { animate, cancel } = fixture();
    const view = render(<Header />);
    view.rerender(<Header vacated />);
    view.rerender(<Header />);
    expect(cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenLastCalledWith([{ transform: "translate(60px, 0px)" }, { transform: "translate(0, 0)" }], expect.anything());
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(6);
  });
  it("reflows instantly with reduced motion and when the preference changes during motion", () => {
    const { animate, cancel } = fixture();
    const view = render(<Header disabled />);
    view.rerender(<Header vacated disabled />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Header />);
    view.rerender(<Header disabled />);
    expect(cancel).toHaveBeenCalled();
  });
});
