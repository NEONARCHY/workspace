export interface TripMapViewport {
  readonly zoom: number;
  readonly centerX: number;
  readonly centerY: number;
}

export interface TripMapPoint { readonly x: number; readonly y: number }

export const mapWidth = 1000;
export const mapHeight = 500;
export const minMapZoom = 1;
export const maxMapZoom = 8;
export const worldViewport: TripMapViewport = { zoom: 1, centerX: 500, centerY: 250 };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

export function clampTripMapViewport(value: TripMapViewport): TripMapViewport {
  const zoom = clamp(value.zoom, minMapZoom, maxMapZoom);
  const halfWidth = mapWidth / zoom / 2;
  const halfHeight = mapHeight / zoom / 2;
  return {
    zoom,
    centerX: clamp(value.centerX, halfWidth, mapWidth - halfWidth),
    centerY: clamp(value.centerY, halfHeight, mapHeight - halfHeight),
  };
}

export function tripMapViewBox(viewport: TripMapViewport) {
  const width = mapWidth / viewport.zoom;
  const height = mapHeight / viewport.zoom;
  return {
    left: viewport.centerX - width / 2,
    top: viewport.centerY - height / 2,
    width,
    height,
  };
}

/** Keep the map coordinate below the pointer at the same screen position. */
export function zoomTripMapAt(
  viewport: TripMapViewport, zoom: number, horizontal: number, vertical: number,
): TripMapViewport {
  const current = tripMapViewBox(viewport);
  const fractionX = clamp(horizontal, 0, 1);
  const fractionY = clamp(vertical, 0, 1);
  const targetZoom = clamp(zoom, minMapZoom, maxMapZoom);
  const targetWidth = mapWidth / targetZoom;
  const targetHeight = mapHeight / targetZoom;
  return clampTripMapViewport({
    zoom: targetZoom,
    centerX: current.left + fractionX * current.width + (0.5 - fractionX) * targetWidth,
    centerY: current.top + fractionY * current.height + (0.5 - fractionY) * targetHeight,
  });
}

export function fitTripMapPoints(points: readonly TripMapPoint[]): TripMapViewport {
  if (!points.length) return worldViewport;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const zoom = Math.min(4.8, mapWidth / (maxX - minX + 120), mapHeight / (maxY - minY + 68));
  return clampTripMapViewport({ zoom, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 });
}

export function interpolateTripMapViewport(
  from: TripMapViewport, to: TripMapViewport, progress: number,
): TripMapViewport {
  const ease = 1 - (1 - clamp(progress, 0, 1)) ** 3;
  return clampTripMapViewport({
    zoom: from.zoom + (to.zoom - from.zoom) * ease,
    centerX: from.centerX + (to.centerX - from.centerX) * ease,
    centerY: from.centerY + (to.centerY - from.centerY) * ease,
  });
}
