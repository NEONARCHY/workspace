import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode, RefObject } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import type { ShaderMaterial } from "three";
import { orbFragmentShader } from "./orb-shader";
import { advanceOrbMotion } from "./orb-motion";

export interface GradientOrbConfig {
  readonly hue?: number;
  readonly rotationSpeed?: number;
  readonly noiseScale?: number;
  readonly innerRadius?: number;
  readonly hoverIntensity?: number;
  readonly rotateOnHover?: boolean;
  readonly forceHoverState?: boolean;
}

const staticQuery = "(prefers-reduced-motion: reduce), (forced-colors: active)";
function subscribeStatic(onChange: () => void) {
  const media = window.matchMedia?.(staticQuery);
  media?.addEventListener("change", onChange);
  return () => media?.removeEventListener("change", onChange);
}
const staticSnapshot = () => window.matchMedia?.(staticQuery).matches ?? false;

class OrbBoundary extends Component<{ readonly children: ReactNode; readonly fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

function OrbScene({ config, targetHover }: {
  readonly config: GradientOrbConfig;
  readonly targetHover: RefObject<number>;
}) {
  const { hue = 0, rotationSpeed = .3, noiseScale = .65, innerRadius = .6,
    hoverIntensity = .5, rotateOnHover = true, forceHoverState = false } = config;
  const motion = useRef({ hover: 0, rotation: 0 });
  const material = useRef<ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    iTime: { value: 0 }, iResolution: { value: new Vector3(1, 1, 1) },
    hue: { value: hue }, hover: { value: 0 }, rot: { value: 0 },
    hoverIntensity: { value: hoverIntensity }, noiseScale: { value: noiseScale },
    innerRadius: { value: innerRadius }, backgroundColor: { value: new Vector3(0, 0, 0) },
  }), [hue, hoverIntensity, noiseScale, innerRadius]);
  useFrame((state, seconds) => {
    const frameUniforms = material.current?.uniforms;
    if (!frameUniforms) return;
    motion.current = advanceOrbMotion(motion.current, forceHoverState ? 1 : targetHover.current,
      seconds, rotateOnHover, rotationSpeed);
    frameUniforms.iTime!.value += Math.min(seconds, .05);
    frameUniforms.hover!.value = motion.current.hover;
    frameUniforms.rot!.value = motion.current.rotation;
    const { width, height } = state.gl.domElement;
    frameUniforms.iResolution!.value.set(width, height, width / Math.max(1, height));
  });
  return <mesh>
    <planeGeometry args={[2, 2]} />
    <shaderMaterial ref={material} vertexShader={vertexShader} fragmentShader={orbFragmentShader}
      uniforms={uniforms} transparent premultipliedAlpha depthWrite={false} toneMapped={false} />
  </mesh>;
}

export function GradientOrb({ config = {}, className = "" }: {
  readonly config?: GradientOrbConfig;
  readonly className?: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const targetHover = useRef(0);
  const staticOrb = useSyncExternalStore(subscribeStatic, staticSnapshot, () => true);
  const [active, setActive] = useState(true);
  const fallback = <span className={`gradient-orb-fallback ${className}`} aria-hidden="true" />;
  const supportsWebGl = typeof WebGLRenderingContext !== "undefined";
  useEffect(() => {
    const element = container.current;
    if (!element || staticOrb || !supportsWebGl) return;
    // The launcher responds across its hit target, including keyboard focus.
    const surface = element.closest("button") ?? element;
    let intersecting = true;
    const updateActive = () => setActive(intersecting && document.visibilityState !== "hidden");
    const move = (event: Event) => {
      if (!(event instanceof PointerEvent) || event.pointerType === "touch") return;
      const rect = element.getBoundingClientRect();
      const size = Math.min(rect.width, rect.height);
      const x = (event.clientX - rect.left - rect.width / 2) * 2 / Math.max(1, size);
      const y = (event.clientY - rect.top - rect.height / 2) * 2 / Math.max(1, size);
      targetHover.current = Math.hypot(x, y) < .8 ? 1 : 0;
    };
    const focus = () => { targetHover.current = 1; };
    const leave = () => { targetHover.current = surface.matches(":focus-visible") ? 1 : 0; };
    const blur = () => { targetHover.current = 0; };
    surface.addEventListener("pointermove", move, { passive: true });
    surface.addEventListener("pointerleave", leave);
    surface.addEventListener("focus", focus);
    surface.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", updateActive);
    const observer = typeof IntersectionObserver === "undefined" ? undefined : new IntersectionObserver(([entry]) => {
      intersecting = entry?.isIntersecting ?? false;
      updateActive();
    });
    observer?.observe(element);
    updateActive();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateActive);
      surface.removeEventListener("pointermove", move);
      surface.removeEventListener("pointerleave", leave);
      surface.removeEventListener("focus", focus);
      surface.removeEventListener("blur", blur);
      targetHover.current = 0;
    };
  }, [staticOrb, supportsWebGl]);
  if (staticOrb || !supportsWebGl) return fallback;
  return <OrbBoundary fallback={fallback}><span ref={container} className={`gradient-orb ${className}`} aria-hidden="true">
    <Canvas orthographic camera={{ position: [0, 0, 1], zoom: 1 }}
      gl={{ alpha: true, antialias: true, premultipliedAlpha: true }}
      dpr={[1, 1.5]} frameloop={active ? "always" : "never"} fallback={fallback}>
      <OrbScene config={config} targetHover={targetHover} />
    </Canvas>
  </span></OrbBoundary>;
}
