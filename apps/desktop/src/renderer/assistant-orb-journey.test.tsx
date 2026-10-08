import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orbPose, orbReveal, orbStreamClip, orbTransform, useAssistantOrbJourney } from "./assistant-orb-journey";

function Harness({ open = false, empty = true, reduced = false, geometry = "desktop", ready = true, blocked = false,
  returnWithoutFlight = false, welcomeWithoutFlight = false }) {
  const launcher = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null);
  const header = useRef<HTMLSpanElement>(null), welcome = useRef<HTMLSpanElement>(null), visual = useRef<HTMLSpanElement>(null);
  const phase = useAssistantOrbJourney({ open, ready, empty, blocked, returnWithoutFlight, welcomeWithoutFlight, reducedMotion: reduced,
    zoom: 1, geometryKey: geometry, launcher, panel, header, welcome, visual });
  return <><header data-slot="topbar"><div data-slot="context">
    <div data-slot="launcher-root" style={{ display: "contents" }}><button ref={launcher} data-slot="launcher">Открыть</button></div>
    </div></header>
    <section ref={panel} data-slot="panel"><span ref={header} data-slot="header" /><span ref={welcome} data-slot="welcome" /></section>
    <span ref={visual} data-slot="visual" /><output>{phase}</output></>;
}

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
});

function motionFixture({ followVisual = false } = {}) {
  const pending: { target: Element; frames: Keyframe[]; options: KeyframeAnimationOptions;
    finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = [];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const slot = this.getAttribute("data-slot");
    if (slot === "visual" && followVisual) {
      const match = (this as HTMLElement).style.transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)/);
      if (match) {
        const scale = Number(match[3]);
        return new DOMRect(Number(match[1]) + 48 - 48 * scale, Number(match[2]) + 48 - 48 * scale,
          96 * scale, 96 * scale);
      }
    }
    const [x, y, size] = slot === "panel" ? [860, 220, 460]
      : slot === "header" ? [905, 255, 46] : slot === "welcome" ? [1080, 440, 76] : [1250, 30, 48];
    return new DOMRect(x, y, slot === "panel" ? 460 : size, slot === "panel" ? 670 : size);
  });
  const animate = vi.fn(function (this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let finish = () => {}, reject = () => {};
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = () => fail(new Error("Cancelled")); });
    const cancel = vi.fn(reject);
    pending.push({ target: this, frames, options, finish, cancel });
    return { finished, finish, cancel };
  });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  return pending;
}

describe("assistant orb choreography", () => {
  it("tracks a fixed-size launcher moved by its layout ancestors, then disconnects", async () => {
    let notify = () => {};
    const observe = vi.fn(), disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: () => void) { notify = callback; }
      observe = observe;
      disconnect = disconnect;
    });
    let bounds = new DOMRect(1250, 30, 48, 48);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => bounds);
    const { unmount } = render(<Harness />);
    await act(async () => {});
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    expect(orb.style.transform).toBe("translate(1226px, 6px) scale(0.5)");
    for (const name of ["launcher", "launcher-root", "context", "topbar"]) {
      expect(observe).toHaveBeenCalledWith(document.querySelector(`[data-slot='${name}']`));
    }
    bounds = new DOMRect(1100, 54, 48, 48);
    act(notify);
    expect(orb.style.transform).toBe("translate(1076px, 30px) scale(0.5)");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    bounds = new DOMRect(50, 50, 48, 48);
    act(notify);
    expect(orb.style.transform).toBe("translate(1076px, 30px) scale(0.5)");
  });

  it.each(["resize", "scroll", "visibilitychange"])("updates idle position on %s without re-rendering", async (event) => {
    let bounds = new DOMRect(1250, 30, 48, 48);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => bounds);
    const { unmount } = render(<Harness />);
    await act(async () => {});
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    bounds = new DOMRect(750, 45, 48, 48);
    const target = event === "resize" ? window : document;
    act(() => target.dispatchEvent(new Event(event)));
    expect(orb.style.transform).toBe("translate(726px, 21px) scale(0.5)");
    unmount();
    bounds = new DOMRect(50, 50, 48, 48);
    act(() => target.dispatchEvent(new Event(event)));
    expect(orb.style.transform).toBe("translate(726px, 21px) scale(0.5)");
  });

  it("tracks font loading and ignores its late resolution after cleanup", async () => {
    let finishFonts = () => {};
    const fonts = new EventTarget();
    Object.defineProperty(fonts, "ready", { value: new Promise<void>(resolve => { finishFonts = resolve; }) });
    Object.defineProperty(document, "fonts", { configurable: true, value: fonts });
    let bounds = new DOMRect(1250, 30, 48, 48);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(() => bounds);
    const { unmount } = render(<Harness />);
    await act(async () => {});
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    bounds = new DOMRect(900, 30, 48, 48);
    act(() => fonts.dispatchEvent(new Event("loadingdone")));
    expect(orb.style.transform).toBe("translate(876px, 6px) scale(0.5)");
    unmount();
    bounds = new DOMRect(50, 50, 48, 48);
    await act(async () => { finishFonts(); fonts.dispatchEvent(new Event("loadingdone")); });
    expect(orb.style.transform).toBe("translate(876px, 6px) scale(0.5)");
  });

  it("converts measured CSS-zoom bounds without shifting the orb centre", () => {
    const pose = orbPose(new DOMRect(100, 200, 48, 48), 2);
    expect(pose).toEqual({ x: 62, y: 112, size: 24 });
    expect(orbTransform(pose)).toBe("translate(14px, 64px) scale(0.25)");
    const [start, end] = orbReveal({ x: 120, y: 220, size: 24 }, new DOMRect(100, 200, 80, 60), 1);
    expect(start).toBe("circle(12px at 20px 20px)");
    expect(end).toBe(`circle(${Math.hypot(60, 40)}px at 20px 20px)`);
  });
  it("lands in the welcome slot before revealing the window, then docks without revealing twice", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']");
    rerender(<Harness open />);
    await screen.findByText("travelling");
    expect(pending).toHaveLength(2);
    expect(pending[0]!.target).toBe(orb);
    expect(pending[0]!.frames.map(({ filter }) => filter)).toEqual(["blur(0px)", "blur(2.40px)", "blur(0px)"]);
    expect(pending[0]!.options.duration).toBe(300);
    expect(pending[0]!.options.easing).toBe("cubic-bezier(.4, 0, .8, 1)");
    expect(pending[1]!.target).toBe(document.querySelector("[data-slot='panel']"));
    expect(pending[1]!.options.delay).toBe(pending[0]!.options.duration);
    expect(pending[1]!.frames.every(({ visibility }) => visibility === "visible")).toBe(true);
    await act(async () => pending[0]!.finish());
    // The browser already has the reveal scheduled; landing only updates its accessible phase.
    expect(screen.getByText("revealing")).toBeInTheDocument();
    expect(pending).toHaveLength(2);
    expect(pending[1]!.target).toBe(document.querySelector("[data-slot='panel']"));
    expect(pending[1]!.frames[0]!.clipPath).toBe("circle(38px at 258px 258px)");
    expect(pending[1]!.options.duration).toBe(220);
    expect(pending[1]!.frames.every(({ opacity }) => opacity === undefined || opacity === 1)).toBe(true);
    expect(pending[1]!.frames.every(({ filter }) => filter === undefined)).toBe(true);
    expect(orb?.style.filter).toBe("none");
    act(() => pending[1]!.finish());
    await screen.findByText("ready");
    rerender(<Harness open empty={false} />);
    await screen.findByText("docking");
    expect(pending).toHaveLength(3);
    expect(pending[2]!.target).toBe(orb);
    expect(pending[2]!.options.duration).toBe(420);
    act(() => pending[2]!.finish());
    await screen.findByText("ready");
    expect(document.querySelector("[data-slot='visual']")).toBe(orb);
    expect(orb?.style.filter).toBe("none");
  });
  it.each([
    ["welcome", 230, 238, 76, 1],
    ["header", 46, 40, 46, 1],
    ["zoomed welcome", 230, 238, 76, 2],
    ["zoomed header", 46, 40, 46, 1.5],
  ] as const)("expands from the %s orb centre far enough to uncover every corner", (_name, x, y, size, zoom) => {
    const panel = new DOMRect(100 * zoom, 200 * zoom, 460 * zoom, 670 * zoom);
    const pose = { x: 100 + x, y: 200 + y, size };
    const radius = Math.hypot(Math.max(x, 460 - x), Math.max(y, 670 - y));
    expect(orbReveal(pose, panel, zoom)).toEqual([
      `circle(${size / 2}px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`,
    ]);
    for (const [cornerX, cornerY] of [[0, 0], [460, 0], [0, 670], [460, 670]]) {
      expect(radius).toBeGreaterThanOrEqual(Math.hypot(cornerX! - x, cornerY! - y));
    }
  });
  it("cancels a radial reveal on close and allows a clean reopening", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    rerender(<Harness open />);
    await screen.findByText("travelling");
    await act(async () => pending[0]!.finish());
    expect(screen.getByText("revealing")).toBeInTheDocument();
    rerender(<Harness />);
    await screen.findByText("closed");
    expect(pending[1]!.cancel).toHaveBeenCalledOnce();
    rerender(<Harness open />);
    await screen.findByText("travelling");
    await act(async () => pending[2]!.finish());
    expect(screen.getByText("revealing")).toBeInTheDocument();
    expect(pending[3]!.frames[0]!.clipPath).toBe("circle(38px at 258px 258px)");
    await act(async () => pending[3]!.finish());
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
  it("reveals immediately when no flight can be animated", async () => {
    const pending = motionFixture();
    const { rerender } = render(<Harness />);
    await act(async () => {});
    Object.defineProperty(document.querySelector("[data-slot='visual']"), "animate", { value: undefined });
    rerender(<Harness open />);
    await screen.findByText("revealing");
    expect(pending).toHaveLength(1);
    expect(pending[0]!.target).toBe(document.querySelector("[data-slot='panel']"));
    expect(pending[0]!.options.delay).toBe(0);
    await act(async () => pending[0]!.finish());
    expect(screen.getByText("ready")).toBeInTheDocument();
  });
  it.each([true, false])("fades into the launcher without flying when closing an expanded chat (empty=%s)", async (empty) => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={empty} returnWithoutFlight />);
    await act(async () => {});
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    rerender(<Harness open empty={empty} returnWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    rerender(<Harness empty={empty} returnWithoutFlight />);
    await screen.findByText("returning");
    expect(pending).toHaveLength(3);
    expect(pending[2]!.target).toBe(orb);
    expect(pending[2]!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(pending[2]!.options.duration).toBe(180);
    expect(orb.style.transform).toBe("translate(1226px, 6px) scale(0.5)");
    expect(orb.style.filter).toBe("none");
    expect(orb.style.clipPath).toBe("none");
    await act(async () => pending[2]!.finish());
    await screen.findByText("closed");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Открыть" }));
    expect(document.querySelector("[data-slot='visual']")).toBe(orb);
  });
  it("keeps the mini-window's return flight", async () => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness />);
    await act(async () => {});
    rerender(<Harness open />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    rerender(<Harness />);
    await screen.findByText("returning");
    expect(pending).toHaveLength(3);
    expect(pending[2]!.options.duration).toBe(420);
    expect(pending[2]!.frames.every(({ transform }) => Boolean(transform))).toBe(true);
    await act(async () => pending[2]!.finish());
    await screen.findByText("closed");
  });
  it("restores the expanded launcher instantly with reduced motion", async () => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness reduced returnWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open reduced returnWithoutFlight />);
    await screen.findByText("ready");
    rerender(<Harness reduced returnWithoutFlight />);
    await screen.findByText("closed");
    expect(pending).toHaveLength(0);
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.opacity).toBe("1");
  });
  it("cancels the launcher's fade on a rapid reopening without an opacity jump", async () => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness returnWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open returnWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    rerender(<Harness returnWithoutFlight />);
    await screen.findByText("returning");
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    // Simulate the browser's computed opacity while its WAAPI fade is in progress.
    orb.style.opacity = "0.35";
    rerender(<Harness open returnWithoutFlight />);
    await screen.findByText("travelling");
    expect(pending[2]!.cancel).toHaveBeenCalledOnce();
    expect(pending[3]!.frames[0]!.opacity).toBe("0.35");
    await act(async () => { pending[3]!.finish(); pending[4]!.finish(); });
    await screen.findByText("ready");
    expect(orb.style.opacity).toBe("1");
    expect(orb.style.filter).toBe("none");
  });
  it("fades out in the header before appearing in an expanded empty chat without a flight or reveal", async () => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={false} welcomeWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open empty={false} welcomeWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    const headerPose = orb.style.transform;
    rerender(<Harness open welcomeWithoutFlight />);
    await screen.findByText("docking");
    expect(pending).toHaveLength(3);
    expect(pending[2]!.frames).toEqual([{ opacity: "1" }, { opacity: 0 }]);
    expect(pending[2]!.options.duration).toBe(100);
    expect(orb.style.transform).toBe(headerPose);
    await act(async () => pending[2]!.finish());
    expect(pending).toHaveLength(4);
    expect(orb.style.transform).toBe("translate(1070px, 430px) scale(0.7916666666666666)");
    expect(pending[3]!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    expect(pending[3]!.options.duration).toBe(140);
    expect(pending.slice(2).every(({ target }) => target === orb)).toBe(true);
    expect(orb.style.filter).toBe("none");
    await act(async () => pending[3]!.finish());
    await screen.findByText("ready");
    expect(orb.style.opacity).toBe("1");
    expect(document.querySelectorAll("[data-slot='visual']")).toHaveLength(1);
  });
  it.each(["reduced", "resize", "no animation API"])("places the expanded welcome orb instantly with %s", async (mode) => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={false} welcomeWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open empty={false} welcomeWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    if (mode === "no animation API") Object.defineProperty(orb, "animate", { value: undefined });
    rerender(<Harness open welcomeWithoutFlight reduced={mode === "reduced"} geometry={mode === "resize" ? "compact" : "desktop"} />);
    await screen.findByText("ready");
    expect(pending).toHaveLength(2);
    expect(orb.style.transform).toBe("translate(1070px, 430px) scale(0.7916666666666666)");
    expect(orb.style.opacity).toBe("1");
  });
  it.each([
    { name: "mini-window welcome", empty: false, nextEmpty: true, welcomeWithoutFlight: false },
    { name: "expanded first-message docking", empty: true, nextEmpty: false, welcomeWithoutFlight: true },
  ])("keeps the flight for $name", async ({ empty, nextEmpty, welcomeWithoutFlight }) => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={empty} welcomeWithoutFlight={welcomeWithoutFlight} />);
    await act(async () => {});
    rerender(<Harness open empty={empty} welcomeWithoutFlight={welcomeWithoutFlight} />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    rerender(<Harness open empty={nextEmpty} welcomeWithoutFlight={welcomeWithoutFlight} />);
    await screen.findByText("docking");
    expect(pending).toHaveLength(3);
    expect(pending[2]!.options.duration).toBe(420);
    expect(pending[2]!.frames.every(({ transform }) => Boolean(transform))).toBe(true);
    await act(async () => pending[2]!.finish());
    await screen.findByText("ready");
  });
  it.each([false, true])("cancels either welcome fade when closing the expanded window (appearing=%s)", async (appearing) => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={false} welcomeWithoutFlight returnWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open empty={false} welcomeWithoutFlight returnWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    rerender(<Harness open welcomeWithoutFlight returnWithoutFlight />);
    await screen.findByText("docking");
    if (appearing) await act(async () => pending[2]!.finish());
    const interrupted = pending.at(-1)!;
    const count = pending.length;
    rerender(<Harness welcomeWithoutFlight returnWithoutFlight />);
    await screen.findByText("returning");
    expect(interrupted.cancel).toHaveBeenCalledOnce();
    expect(pending).toHaveLength(count + 1);
    expect(pending.at(-1)!.frames).toEqual([{ opacity: 0 }, { opacity: 1 }]);
    await act(async () => pending.at(-1)!.finish());
    await screen.findByText("closed");
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.transform).toBe("translate(1226px, 6px) scale(0.5)");
  });
  it("restores opacity in place when switching back to history during the header fade", async () => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={false} welcomeWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open empty={false} welcomeWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    const orb = document.querySelector<HTMLElement>("[data-slot='visual']")!;
    const headerPose = orb.style.transform;
    rerender(<Harness open welcomeWithoutFlight />);
    await screen.findByText("docking");
    orb.style.opacity = "0.35";
    rerender(<Harness open empty={false} welcomeWithoutFlight />);
    await act(async () => {});
    expect(pending[2]!.cancel).toHaveBeenCalledOnce();
    expect(pending).toHaveLength(4);
    expect(pending[3]!.frames).toEqual([{ opacity: "0.35" }, { opacity: 1 }]);
    expect(orb.style.transform).toBe(headerPose);
    await act(async () => pending[3]!.finish());
    await screen.findByText("ready");
    expect(orb.style.opacity).toBe("1");
  });
  it("settles both welcome fade stages when the tab becomes hidden", async () => {
    const pending = motionFixture({ followVisual: true });
    const { rerender } = render(<Harness empty={false} welcomeWithoutFlight />);
    await act(async () => {});
    rerender(<Harness open empty={false} welcomeWithoutFlight />);
    await screen.findByText("travelling");
    await act(async () => { pending[0]!.finish(); pending[1]!.finish(); });
    await screen.findByText("ready");
    rerender(<Harness open welcomeWithoutFlight />);
    await screen.findByText("docking");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await screen.findByText("ready");
    expect(pending).toHaveLength(3);
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.opacity).toBe("1");
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.transform).toBe("translate(1070px, 430px) scale(0.7916666666666666)");
  });
  it("leaves room for the shadow and clips it at the stream rather than the orb's square", () => {
    const bounds = new DOMRect(100, 200, 96, 96);
    expect(orbStreamClip(bounds, new DOMRect(0, 0, 600, 600))).toBe("inset(-50% -50% -50% -50%)");
    expect(orbStreamClip(bounds, new DOMRect(0, 224, 600, 600))).toBe("inset(25% -50% -50% -50%)");
    expect(orbStreamClip(bounds, new DOMRect(0, 0, 148, 248))).toBe("inset(-50% 50% 50% -50%)");
    expect(orbStreamClip(new DOMRect(200, 400, 192, 192), new DOMRect(0, 448, 1200, 1200)))
      .toBe("inset(25% -50% -50% -50%)");
    expect(orbStreamClip(new DOMRect(), new DOMRect())).toBe("none");
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
    expect(pending[1]!.cancel).toHaveBeenCalledOnce();
    expect(pending).toHaveLength(2);
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.filter).toBe("none");
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
    expect(pending).toHaveLength(2);
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
    expect(pending[1]!.cancel).toHaveBeenCalledOnce();
    expect(pending).toHaveLength(2);
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.filter).toBe("none");
    expect(document.querySelector<HTMLElement>("[data-slot='visual']")?.style.transform).toBe("translate(1226px, 6px) scale(0.5)");
  });
});
