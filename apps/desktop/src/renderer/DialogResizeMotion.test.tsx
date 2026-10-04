import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeDialogResizeMotion } from "./DialogResizeMotion";

const observers: { node?: Node; callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
const frames = new Map<number, FrameRequestCallback>();
const preferences = new Set<() => void>();
const animate = vi.fn();
let reduced = false, frameId = 0, stop = () => {};
const flush = () => { const next = [...frames.values()]; frames.clear(); next.forEach(callback => callback(0)); };
const notify = (node: HTMLElement) => observers.filter(observer => observer.node === node).forEach(observer => observer.callback());
const dialog = (height = 200, className = "fui-DialogSurface") => {
  const node = document.createElement("section"); node.className = className; node.dataset.height = String(height); node.dataset.width = "400";
  document.body.append(node); return node;
};
beforeEach(() => {
  observers.length = 0; frames.clear(); preferences.clear(); reduced = false; frameId = 0; animate.mockReset();
  animate.mockImplementation(() => ({ playState: "running", cancel: vi.fn(), onfinish: null }));
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("matchMedia", () => ({ get matches() { return reduced; }, addEventListener: (_: string, callback: () => void) => preferences.add(callback), removeEventListener: (_: string, callback: () => void) => preferences.delete(callback) }));
  vi.stubGlobal("MutationObserver", class {
    node?: Node; disconnect = vi.fn(); constructor(readonly callback: () => void) { observers.push(this); }
    observe(node: Node) { this.node = node; }
  });
  vi.stubGlobal("ResizeObserver", class {
    node?: Node; disconnect = vi.fn(); constructor(readonly callback: () => void) { observers.push(this); }
    observe(node: Node) { this.node = node; }
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return Number(this.dataset.width ?? 0); });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return Number(this.dataset.height ?? 0); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = Number(this.dataset.visibleHeight ?? this.dataset.height ?? 0), width = Number(this.dataset.width ?? 0);
    return { height, width, x: 0, y: 20, top: 20, left: 0, right: width, bottom: height + 20, toJSON: () => ({}) };
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => { stop(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });

it("leaves first render and unchanged input alone, then interpolates only changed dimensions", () => {
  const node = dialog(); stop = observeDialogResizeMotion(document.body); notify(node); flush(); expect(animate).not.toHaveBeenCalled();
  node.dataset.height = "320"; notify(node); flush();
  expect(animate.mock.calls[0]?.[0]).toEqual([{ height: "200px" }, { height: "320px" }]);
  expect(animate.mock.calls[0]?.[1]).toMatchObject({ duration: 220 });
  expect(animate.mock.calls[0]?.[1]).not.toHaveProperty("fill");
  expect(node.style.height).toBe("");
});
it("interrupts from the visible geometry and suppresses its own observer feedback", () => {
  const node = dialog(); stop = observeDialogResizeMotion(document.body);
  node.dataset.height = "320"; notify(node); flush(); const first = animate.mock.results[0]!.value;
  // Only the local MutationObserver should interrupt; a resize from our own frame must not.
  observers.find(observer => observer.node === node)?.callback(); flush(); expect(animate).toHaveBeenCalledTimes(1);
  observers.filter(observer => observer.node === node).at(-1)!.callback(); flush();
  expect(animate).toHaveBeenCalledTimes(1); expect(first.cancel).not.toHaveBeenCalled();
  node.dataset.visibleHeight = "260"; node.dataset.height = "160";
  observers.filter(observer => observer.node === node).at(-1)!.callback(); flush();
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(animate.mock.calls[1]?.[0]).toEqual([{ height: "260px" }, { height: "160px" }]);
});
it("discovers newly opened custom modals and releases removed windows", () => {
  stop = observeDialogResizeMotion(document.body);
  const node = dialog(200, "custom-dialog"); node.setAttribute("role", "dialog"); node.setAttribute("aria-modal", "true");
  const global = observers.find(observer => observer.node === document.body)!;
  Reflect.apply(global.callback, undefined, [[{ addedNodes: [node] }]]);
  node.dataset.height = "300"; notify(node); flush(); expect(animate).toHaveBeenCalledOnce();
  const animation = animate.mock.results[0]!.value; node.remove();
  Reflect.apply(global.callback, undefined, [[{ addedNodes: [] }]]); flush();
  expect(animation.cancel).toHaveBeenCalledOnce(); expect(frames.size).toBe(0);
});
it("keeps the browser's native textarea resize immediate", () => {
  const node = dialog(); const textarea = document.createElement("textarea"); node.append(textarea);
  textarea.dataset.height = "100"; textarea.dataset.width = "100";
  stop = observeDialogResizeMotion(document.body);
  textarea.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 95, clientY: 115 }));
  node.dataset.height = "300"; notify(node); flush(); expect(animate).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pointerup")); node.dataset.height = "400"; notify(node); flush(); expect(animate).toHaveBeenCalledOnce();
});
it("returns to natural size after finish and supports genuine width changes", () => {
  const node = dialog(); stop = observeDialogResizeMotion(document.body);
  node.dataset.height = "320"; node.dataset.width = "500"; notify(node); flush();
  expect(animate.mock.calls[0]?.[0]).toEqual([{ width: "400px", height: "200px" }, { width: "500px", height: "320px" }]);
  const animation = animate.mock.results[0]!.value; animation.playState = "finished"; animation.onfinish(); flush();
  expect(animate).toHaveBeenCalledTimes(1); expect(node.style.cssText).toBe("");
  node.dataset.height = "180"; notify(node); flush(); expect(animate.mock.calls[1]?.[0]).toEqual([{ height: "320px" }, { height: "180px" }]);
});
it("resizes the Fluent body in step with the frame and releases both effects", () => {
  const node = dialog(); node.style.padding = "20px"; const body = document.createElement("div"); body.className = "fui-DialogBody"; node.append(body);
  stop = observeDialogResizeMotion(document.body); node.dataset.height = "320";
  observers.filter(observer => observer.node === node).at(-1)!.callback(); flush();
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[1]?.[0]).toEqual([{ height: "160px" }, { height: "280px" }]);
  const frame = animate.mock.results[0]!.value, inner = animate.mock.results[1]!.value;
  frame.playState = "finished"; frame.onfinish(); flush();
  expect(inner.cancel).toHaveBeenCalledOnce(); expect(body.style.height).toBe(""); expect(animate).toHaveBeenCalledTimes(2);
});
it("ignores page cards and allows specialized dialogs to opt out", () => {
  const card = dialog(200, "team-card"), node = dialog(); node.dataset.dialogResizeMotion = "off";
  stop = observeDialogResizeMotion(document.body); card.dataset.height = "400"; node.dataset.height = "400"; notify(card); notify(node); flush();
  expect(animate).not.toHaveBeenCalled();
});
it("excludes focus-trapping popovers even though they carry modal dialog semantics", () => {
  const popover = dialog(170, "fui-PopoverSurface person-picker-surface");
  popover.setAttribute("role", "dialog"); popover.setAttribute("aria-modal", "true");
  const modal = dialog(200, "custom-dialog");
  modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true");
  stop = observeDialogResizeMotion(document.body);
  popover.dataset.height = "340"; modal.dataset.height = "320";
  notify(popover); notify(modal); flush();
  expect(observers.some(observer => observer.node === popover)).toBe(false);
  expect(animate).toHaveBeenCalledOnce();
  expect(animate.mock.calls[0]?.[0]).toEqual([{ height: "200px" }, { height: "320px" }]);
});
it("honours reduced/forced preferences and cancels immediately when settings change", () => {
  const node = dialog(); stop = observeDialogResizeMotion(document.body); reduced = true;
  node.dataset.height = "300"; notify(node); flush(); expect(animate).not.toHaveBeenCalled();
  reduced = false; node.dataset.height = "400"; notify(node); flush();
  const animation = animate.mock.results[0]!.value; reduced = true; preferences.forEach(callback => callback());
  expect(animation.cancel).toHaveBeenCalledOnce();
});
it("cancels on viewport resize, visibility and cleanup, releasing all observers", () => {
  const node = dialog(); stop = observeDialogResizeMotion(document.body); node.dataset.height = "400"; notify(node); flush();
  const first = animate.mock.results[0]!.value; window.dispatchEvent(new Event("resize")); flush(); expect(first.cancel).toHaveBeenCalledOnce();
  node.dataset.height = "300"; notify(node); flush();
  const second = animate.mock.results[1]!.value; document.dispatchEvent(new Event("visibilitychange")); expect(second.cancel).toHaveBeenCalledOnce();
  stop(); expect(preferences.size).toBe(0); expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true); expect(frames.size).toBe(0);
});
