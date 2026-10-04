export interface OrbMotion {
  readonly hover: number;
  readonly rotation: number;
}

/** Refresh-rate-independent easing, including a gentle hover release. */
export function advanceOrbMotion(previous: OrbMotion, target: number, seconds: number, rotate: boolean, speed: number): OrbMotion {
  const delta = Math.min(.05, Math.max(0, seconds));
  const blend = 1 - Math.pow(.9, delta * 60);
  const hover = previous.hover + (target - previous.hover) * blend;
  return { hover, rotation: previous.rotation + (rotate ? delta * speed * hover : 0) };
}
