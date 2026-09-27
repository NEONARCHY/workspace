import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type * as THREE from "three";

export interface GradientOrbConfig {
  readonly hue?: number;
  readonly rotationSpeed?: number;
  readonly noiseScale?: number;
  readonly innerRadius?: number;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// Adapted from the supplied shader: a transparent orb, with brand teal and blue
// instead of the original dark canvas and purple/orange palette.
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float iTime;
  uniform float rotationSpeed;
  uniform float noiseScale;
  uniform float innerRadius;
  uniform float hue;

  vec3 hueShift(vec3 color, float angle) {
    vec3 axis = normalize(vec3(1.0));
    float c = cos(angle), s = sin(angle);
    return color * c + cross(axis, color) * s + axis * dot(axis, color) * (1.0 - c);
  }
  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float t = iTime * rotationSpeed;
    float angle = atan(uv.y, uv.x);
    float radius = length(uv);
    float wave = sin(angle * 3.0 + t * 2.0) * 0.055 +
                 sin(angle * 5.0 - t * 1.35 + radius * noiseScale * 4.0) * 0.035;
    float edge = 0.79 + wave;
    float alpha = 1.0 - smoothstep(edge - 0.08, edge + 0.07, radius);
    float highlight = exp(-20.0 * length(uv - vec2(-0.24, 0.3)));
    float glow = exp(-6.0 * abs(radius - innerRadius));
    vec3 deep = vec3(0.035, 0.38, 0.49);
    vec3 teal = vec3(0.02, 0.68, 0.69);
    vec3 sky = vec3(0.55, 0.91, 0.88);
    float mixValue = 0.5 + 0.5 * sin(angle * 2.0 + t + radius * 4.0);
    vec3 color = mix(deep, teal, mixValue);
    color = mix(color, sky, clamp(highlight * 0.85 + glow * 0.15, 0.0, 1.0));
    color = clamp(hueShift(color, radians(hue)), 0.0, 1.0);
    gl_FragColor = vec4(color, alpha);
  }
`;

function OrbScene({ config }: { readonly config: GradientOrbConfig }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    iTime: { value: 0 },
    rotationSpeed: { value: config.rotationSpeed ?? 0.3 },
    noiseScale: { value: config.noiseScale ?? 0.65 },
    innerRadius: { value: config.innerRadius ?? 0.25 },
    hue: { value: config.hue ?? 0 },
  }), [config.rotationSpeed, config.noiseScale, config.innerRadius, config.hue]);
  useFrame((state) => {
    if (material.current) material.current.uniforms.iTime!.value = state.clock.elapsedTime;
  });
  return <mesh>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial ref={material} vertexShader={vertexShader} fragmentShader={fragmentShader}
      uniforms={uniforms} transparent depthWrite={false} />
  </mesh>;
}

export function GradientOrb({ config = {}, className = "" }: {
  readonly config?: GradientOrbConfig;
  readonly className?: string;
}) {
  const supportsWebGl = typeof WebGLRenderingContext !== "undefined";
  const reducedMotion = typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!supportsWebGl || reducedMotion) {
    return <span className={`gradient-orb-fallback ${className}`} aria-hidden="true" />;
  }
  return <span className={`gradient-orb ${className}`} aria-hidden="true">
    <Canvas orthographic camera={{ position: [0, 0, 1], zoom: 1 }}
      gl={{ alpha: true, antialias: true }} dpr={[1, 1.5]}>
      <OrbScene config={config} />
    </Canvas>
  </span>;
}
