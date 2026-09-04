export interface WindowBounds { x: number; y: number; width: number; height: number }

export function fitWindowBounds(bounds: Partial<WindowBounds>, area: WindowBounds): WindowBounds {
  const width = Math.min(area.width, Math.max(Math.min(640, area.width), Number.isFinite(bounds.width) ? bounds.width! : 1240));
  const height = Math.min(area.height, Math.max(Math.min(480, area.height), Number.isFinite(bounds.height) ? bounds.height! : 780));
  const x = Number.isFinite(bounds.x) ? bounds.x! : area.x + (area.width - width) / 2;
  const y = Number.isFinite(bounds.y) ? bounds.y! : area.y + (area.height - height) / 2;
  return {
    width: Math.round(width), height: Math.round(height),
    x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))),
  };
}
