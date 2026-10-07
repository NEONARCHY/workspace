import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orbPose, orbReveal, orbTransform, useAssistantOrbJourney } from "./assistant-orb-journey";

function Harness({ open = false, empty = true, reduced = false, geometry = "desktop", ready = true, blocked = false }) {
  const launcher = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const header = useRef<HTMLSpanElement>(null), welcome = useRef<HTMLSpanElement>(null), visual = useRef<HTMLSpanElement>(null);
  const phase = useAssistantOrbJourney({ open, ready, empty, blocked, reducedMotion: reduced,
    zoom: 1, geometryKey: geometry, launcher, panel, header, welcome, visual });
  return <><button ref={launcher} data-slot="launcher">Открыть</button>
    <section ref={panel} data-slot="panel"><span ref={header} data-slot="header" /><span ref={welcome} data-slot="welcome" /></section>
    <span ref={visual} data-slot="visual" /><output>{phase}</output></>;
}

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
});

function motionFixture() {
  const pending: { target: Element; frames: Keyframe[]; finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const slot = this.getAttribute("data-slot");
    const [x, y, size] = slot === "header" ? [905, 255, 46] : slot === "welcome" ? [1080, 440, 76] : [1250, 30, 48];
    return new DOMRect(x, y, slot === "panel" ? 460 : size, slot === "panel" ? 670 : size);
  });
  const animate = vi.fn(function (this: Element, frames: Keyframe[]) {
    let finish = () => {}, reject = () => {};
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new Error("Cancelled")); });
    const cancel = vi.fn(reject);
    pending.push({ target: this, frames, finish, cancel });
    return { finished, finish, cancel };
  });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  return pending;
}

describe("assistant orb choreography", () => {
  it("converts measured CSS-zoom bounds without shifting the orb centre", () => {
    const pose = orbPose(new DOMRect(100, 200, 48, 48), 2);
    expect(pose).toEqual({ x: 62, y: 112, size: 24 });
    expect(orbTransform(pose)).toBe("translate(14px, 64px) scale(0.25)");
    const [start, end] = orbReveal({ x: 120, y: 220, size: 24 }, new DOMRect(100, 200, 80, 60), 1);
    expect(start).toBe("circle(0px at 20px 20px)");
    expect(end).toBe(`circle(${Math.hypot(60, 40)}px at 20px 20px)`);
  });
  it("lands in the welcome slot before revealing the window, then docks without revealing twice", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    const orb = document.querySelector("[data-slot='visual']");
    rerender(<Harness open />);
    await screen.findByText("travelling");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.target).toBe(orb);
    act(() => pending[0]!.finish());
    await screen.findByText("revealing");
    expect(pending[1]!.target).toBe(document.querySelector("[data-slot='panel']"));
    expect(pending[1]!.frames[0]!.clipPath).toMatch(/^circle\(0px/);
    act(() => pending[1]!.finish());
    await screen.findByText("ready");
    rerender(<Harness open empty={false} />);
    await screen.findByText("docking");
    expect(pending).toHaveLength(3);
    expect(pending[2]!.target).toBe(orb);
    act(() => pending[2]!.finish());
    await screen.findByText("ready");
    expect(document.querySelector("[data-slot='visual']")).toBe(orb);
  });
  it("cancels interrupted travel and snaps to the current destination on resize/reduced motion", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    rerender(<Harness open />);
    await screen.findByText("travelling");
    rerender(<Harness open reduced geometry="compact" />);
    await screen.findByText("ready");
    expect(pending[0]!.cancel).toHaveBeenCalledOnce();
    expect(pending).toHaveLength(1);
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.transform).toBe("translate(1070px, 430px) scale(0.7916666666666666)");
    rerender(<Harness reduced geometry="compact" />);
    await waitFor(() => expect(screen.getByText("closed")).toBeInTheDocument());
  });
  it("waits for history before travelling and does not reveal a window while blocked", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    rerender(<Harness open ready={false} />);
    await screen.findByText("waiting");
    expect(pending).toHaveLength(0);
    rerender(<Harness open blocked />);
    await act(async () => {});
    expect(pending).toHaveLength(0);
    rerender(<Harness open />);
    await screen.findByText("travelling");
    expect(pending).toHaveLength(1);
    act(() => pending[0]!.finish());
    await screen.findByText("revealing");
    act(() => pending[1]!.finish());
    await screen.findByText("ready");
  });
  it("cancels a flight when closed and returns to the launcher without revealing", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    rerender(<Harness open />);
    await screen.findByText("travelling");
    rerender(<Harness />);
    await screen.findByText("closed");
    expect(pending[0]!.cancel).toHaveBeenCalledOnce();
    expect(pending.every(({ target }) => target.getAttribute("data-slot") === "visual")).toBe(true);
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.transform).toBe("translate(1226px, 6px) scale(0.5)");
  });
});
