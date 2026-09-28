/** A quiet, CSS-rendered assistant identity: no WebGL surface or hard halo. */
export interface GradientOrbConfig {
  readonly hue?: number;
  readonly rotationSpeed?: number;
  readonly noiseScale?: number;
  readonly innerRadius?: number;
}

export function GradientOrb({ className = "" }: {
  readonly config?: GradientOrbConfig;
  readonly className?: string;
}) {
  return <span className={`gradient-orb ${className}`} aria-hidden="true">
    <span className="gradient-orb-core" />
    <span className="gradient-orb-light" />
  </span>;
}
