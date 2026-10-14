import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAssistantLauncherLayout } from "./useAssistantLauncherLayout";

function Header({ vacated = false, disabled = false }) {
  const launcher = useRef<HTMLButtonElement>(null);
  useAssistantLauncherLayout(launcher, vacated, disabled, 1, "desktop");
  return <div className="global-bar"><div className="workspace-top-context" style={{ columnGap: 12 }}>
    <div className="color-theme-toggle-wrap"><button className="color-theme-toggle"><svg /></button></div>
    <span className="assistant-launcher-space" data-vacated={vacated || undefined}><button ref={launcher} /></span>
    <div className="workspace-identity"><button className="workspace-identity-menu"><span className="fui-Avatar" /></button></div>
  </div></div>;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function fixture() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const vacated = Boolean(document.querySelector("[data-vacated]"));
    const x = this.matches("svg") ? (vacated ? 172 : 112)
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
  it("aligns the real button with the orb and translates neighbours without scaling", () => {
    const { animate } = fixture();
    const view = render(<Header />);
    expect(view.container.querySelector(".assistant-launcher-space button")).toHaveStyle("--assistant-launcher-offset: 0px");
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Header vacated />);
    expect(animate).toHaveBeenCalledWith([{ transform: "translate(-60px, 0px)" }, { transform: "translate(0, 0)" }],
      { duration: 320, easing: "cubic-bezier(.2, 0, 0, 1)" });
  });
  it("cancels an interrupted movement and returns the neighbours on close", () => {
    const { animate, cancel } = fixture();
    const view = render(<Header />);
    view.rerender(<Header vacated />);
    view.rerender(<Header />);
    expect(cancel).toHaveBeenCalled();
    expect(animate).toHaveBeenLastCalledWith([{ transform: "translate(60px, 0px)" }, { transform: "translate(0, 0)" }], expect.anything());
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
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
