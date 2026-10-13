import { act, cleanup, renderHook } from "@testing-library/react";
import type { Node, NodeChange } from "@xyflow/react";
import { afterEach, expect, it, vi } from "vitest";
import { useFrameNodeChanges } from "./useFrameNodeChanges";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const dimension: NodeChange<Node> = { type: "dimensions", id: "node", dimensions: { width: 202, height: 92 } };
const move: NodeChange<Node> = { type: "position", id: "node", position: { x: 200, y: 300 }, dragging: true };

it("applies user moves immediately and batches only measured dimensions in a frame", () => {
  let frame: FrameRequestCallback | undefined;
  const schedule = vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; });
  vi.stubGlobal("requestAnimationFrame", schedule); vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const apply = vi.fn(); const hook = renderHook(() => useFrameNodeChanges(apply));
  act(() => { hook.result.current([dimension, move]); hook.result.current([dimension]); });
  expect(apply).toHaveBeenCalledExactlyOnceWith([move]); expect(schedule).toHaveBeenCalledOnce();
  act(() => frame?.(0)); expect(apply).toHaveBeenLastCalledWith([dimension, dimension]);
});
it("cancels stale measurements on unmount without cancelling or reordering edits", () => {
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 7));
  const cancel = vi.fn(); vi.stubGlobal("cancelAnimationFrame", cancel);
  const apply = vi.fn(); const hook = renderHook(() => useFrameNodeChanges(apply));
  act(() => { hook.result.current([dimension]); hook.result.current([{ type: "remove", id: "node" }]); });
  expect(apply).toHaveBeenCalledExactlyOnceWith([{ type: "remove", id: "node" }]);
  hook.unmount(); expect(cancel).toHaveBeenCalledExactlyOnceWith(7);
});
it("retains direct updates when frame scheduling is unavailable", () => {
  vi.stubGlobal("requestAnimationFrame", undefined);
  const apply = vi.fn(); const hook = renderHook(() => useFrameNodeChanges(apply));
  act(() => hook.result.current([dimension, move]));
  expect(apply).toHaveBeenCalledExactlyOnceWith([dimension, move]);
});
