import { afterEach, expect, it, vi } from "vitest";
import { createTimeWheelMotion } from "./time-wheel-motion";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
function fixture() {
  let id = 0, time = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  const cancel = vi.fn((key: number) => frames.delete(key)); vi.stubGlobal("cancelAnimationFrame", cancel);
  const wheel = document.createElement("div");
  for (let i = 0; i < 60; i += 1) {
    const digit = document.createElement("span"); digit.className = "ws-time-digit"; digit.textContent = String(i); wheel.append(digit);
  }
  document.body.append(wheel);
  const advance = (count: number) => {
    for (let i = 0; i < count; i += 1) {
      time += 1000 / 60;
      const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(time));
    }
  };
  return { wheel, advance, frames, cancel };
}
it("retargets one continuous movement, advances without jumping and settles exactly", () => {
  const { wheel, advance, frames } = fixture();
  const motion = createTimeWheelMotion(wheel);
  motion.moveTo(340, true); motion.moveTo(374);
  advance(5); const midway = wheel.scrollTop;
  expect(midway).toBeGreaterThan(340); expect(midway).toBeLessThan(374);
  motion.moveTo(408); expect(frames.size).toBe(1); expect(wheel.scrollTop).toBe(midway);
  advance(1); expect(wheel.scrollTop - midway).toBeLessThan(15);
  advance(100); expect(wheel.scrollTop).toBe(408); expect(frames.size).toBe(0);
  motion.dispose();
});
it("keeps the centre sharp and increases blur symmetrically towards both edges", () => {
  const { wheel } = fixture(); const motion = createTimeWheelMotion(wheel);
  motion.moveTo(340, true);
  const digits = wheel.children;
  expect((digits[10] as HTMLElement).style.getPropertyValue("--ws-time-blur")).toBe("0.00px");
  expect((digits[8] as HTMLElement).style.getPropertyValue("--ws-time-blur")).toBe("1.16px");
  expect((digits[12] as HTMLElement).style.getPropertyValue("--ws-time-blur")).toBe("1.16px");
  motion.dispose();
});
it("stops for dragging, reduced effects and disposal without leaving frames or filters", () => {
  const { wheel, frames, cancel } = fixture(); const motion = createTimeWheelMotion(wheel);
  motion.moveTo(340); motion.stop(); expect(frames.size).toBe(0); expect(cancel).toHaveBeenCalled();
  motion.moveTo(374); motion.setStatic(true);
  expect(wheel.scrollTop).toBe(374); expect(frames.size).toBe(0);
  expect((wheel.children[11] as HTMLElement).style.getPropertyValue("--ws-time-blur")).toBe("0.00px");
  motion.moveTo(408); expect(wheel.scrollTop).toBe(408); expect(frames.size).toBe(0);
  motion.dispose(); expect((wheel.children[12] as HTMLElement).style.getPropertyValue("--ws-time-blur")).toBe("");
});
