export interface MessengerPosition { readonly x: number; readonly y: number }
export interface MessengerViewport { readonly width: number; readonly height: number; readonly top: number; readonly left: number; readonly zoom: number }
export const MESSENGER_LAUNCHER_SIZE = 48;
const EDGE = 16;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));

export function readMessengerViewport(): MessengerViewport {
  const style = getComputedStyle(document.documentElement);
  const zoom = Number.parseFloat(style.zoom) || 1;
  const viewport = window.visualViewport;
  return {
    width: (viewport?.width ?? window.innerWidth) / zoom,
    height: (viewport?.height ?? window.innerHeight) / zoom,
    top: (viewport?.offsetTop ?? 0) / zoom,
    left: (viewport?.offsetLeft ?? 0) / zoom,
    zoom,
  };
}

export function launcherCoordinates(position: MessengerPosition, viewport: MessengerViewport) {
  return {
    x: viewport.left + EDGE + position.x * Math.max(0, viewport.width - EDGE * 2 - MESSENGER_LAUNCHER_SIZE),
    y: viewport.top + EDGE + position.y * Math.max(0, viewport.height - EDGE * 2 - MESSENGER_LAUNCHER_SIZE),
  };
}

export function normalizedPosition(x: number, y: number, viewport: MessengerViewport): MessengerPosition {
  return {
    x: clamp((x - viewport.left - EDGE) / Math.max(1, viewport.width - EDGE * 2 - MESSENGER_LAUNCHER_SIZE), 0, 1),
    y: clamp((y - viewport.top - EDGE) / Math.max(1, viewport.height - EDGE * 2 - MESSENGER_LAUNCHER_SIZE), 0, 1),
  };
}

export function miniMessengerBounds(position: MessengerPosition, viewport: MessengerViewport) {
  const anchor = launcherCoordinates(position, viewport);
  const width = Math.min(520, Math.max(0, viewport.width - EDGE * 2));
  const height = Math.min(680, Math.max(0, viewport.height - EDGE * 2 - MESSENGER_LAUNCHER_SIZE - 12));
  const above = anchor.y - height - 12;
  return {
    width, height,
    left: clamp(anchor.x + MESSENGER_LAUNCHER_SIZE - width, viewport.left + EDGE, viewport.left + viewport.width - width - EDGE),
    top: clamp(above >= viewport.top + EDGE ? above : anchor.y + MESSENGER_LAUNCHER_SIZE + 12,
      viewport.top + EDGE, viewport.top + viewport.height - height - EDGE),
  };
}

export function readMessengerPosition(key: string): MessengerPosition {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value && typeof value === "object" && "x" in value && "y" in value
      && typeof value.x === "number" && typeof value.y === "number"
      && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return { x: clamp(value.x, 0, 1), y: clamp(value.y, 0, 1) };
    }
  } catch { /* A blocked or corrupt local preference must not block messaging. */ }
  return { x: 1, y: 1 };
}
