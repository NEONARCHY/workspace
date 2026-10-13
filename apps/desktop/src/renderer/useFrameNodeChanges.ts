import { useCallback, useEffect, useRef } from "react";
import type { Node, NodeChange } from "@xyflow/react";

/** Size metadata must not feed React layout back into ResizeObserver's current
 * delivery cycle (a WebKit feedback loop). User edits/moves remain immediate. */
export function useFrameNodeChanges<T extends Node>(onChange: (changes: NodeChange<T>[]) => void) {
  const queue = useRef<NodeChange<T>[]>([]);
  const frame = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current);
    frame.current = undefined; queue.current = [];
  }, [onChange]);
  return useCallback((changes: NodeChange<T>[]) => {
    if (typeof window.requestAnimationFrame !== "function") { onChange(changes); return; }
    const direct = changes.filter(change => change.type !== "dimensions");
    if (direct.length) onChange(direct);
    queue.current.push(...changes.filter(change => change.type === "dimensions"));
    if (!queue.current.length || frame.current !== undefined) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined;
      const dimensions = queue.current; queue.current = [];
      onChange(dimensions);
    });
  }, [onChange]);
}
