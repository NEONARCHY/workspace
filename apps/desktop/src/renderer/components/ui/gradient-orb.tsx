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

// The supplied noise-driven orb, adapted to a transparent canvas and the
// Yuksalish palette. Keep its light, noise and radial motion in one shader.
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float iTime;
  uniform float rotationSpeed;
  uniform float noiseScale;
  uniform float innerRadius;
  uniform float hue;

  vec3 rgb2yiq(vec3 color) {
    return vec3(dot(color, vec3(.299, .587, .114)),
      dot(color, vec3(.596, -.274, -.322)),
      dot(color, vec3(.211, -.523, .312)));
  }
  vec3 yiq2rgb(vec3 color) {
    return vec3(color.x + .956 * color.y + .621 * color.z,
      color.x - .272 * color.y - .647 * color.z,
      color.x - 1.106 * color.y + 1.703 * color.z);
  }
  vec3 adjustHue(vec3 color, float hueDegrees) {
    float angle = radians(hueDegrees);
    vec3 yiq = rgb2yiq(color);
    float c = cos(angle), s = sin(angle);
    yiq.yz = vec2(yiq.y * c - yiq.z * s, yiq.y * s + yiq.z * c);
    return yiq2rgb(yiq);
  }
  vec3 hash33(vec3 p) {
    p = fract(p * vec3(.1031, .11369, .13787));
    p += dot(p, p.yxz + 19.19);
    return -1.0 + 2.0 * fract(vec3(p.x + p.y, p.x + p.z, p.y + p.z) * p.zyx);
  }
  float snoise3(vec3 p) {
    const float K1 = .333333333;
    const float K2 = .166666667;
    vec3 i = floor(p + (p.x + p.y + p.z) * K1);
    vec3 d0 = p - (i - (i.x + i.y + i.z) * K2);
    vec3 e = step(vec3(0.0), d0 - d0.yzx);
    vec3 i1 = e * (1.0 - e.zxy);
    vec3 i2 = 1.0 - e.zxy * (1.0 - e);
    vec3 d1 = d0 - (i1 - K2);
    vec3 d2 = d0 - (i2 - K1);
    vec3 d3 = d0 - .5;
    vec4 h = max(.6 - vec4(dot(d0, d0), dot(d1, d1), dot(d2, d2), dot(d3, d3)), 0.0);
    vec4 n = h * h * h * h * vec4(dot(d0, hash33(i)), dot(d1, hash33(i + i1)),
      dot(d2, hash33(i + i2)), dot(d3, hash33(i + 1.0)));
    return dot(vec4(31.316), n);
  }
  float light1(float intensity, float attenuation, float distanceFromLight) {
    return intensity / (1.0 + distanceFromLight * attenuation);
  }
  float light2(float intensity, float attenuation, float distanceFromLight) {
    return intensity / (1.0 + distanceFromLight * distanceFromLight * attenuation);
  }
  void main() {
    vec2 uv = vUv * 2.0 - 1.0;
    float angle = iTime * rotationSpeed;
    uv = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * uv;
    float radius = length(uv);
    float invRadius = radius > 0.0 ? 1.0 / radius : 0.0;
    float pulse = sin(iTime * 2.25) * .02;
    float noise = snoise3(vec3(uv * noiseScale, iTime * .75)) * .5 + .5;
    float r0 = mix(mix(innerRadius + pulse, 1.0, .4),
      mix(innerRadius + pulse, 1.0, .6), noise);
    float radialDistance = distance(uv, (r0 * invRadius) * uv);
    float light = light1(1.0, 10.0, radialDistance);
    light *= 1.0 - smoothstep(r0, r0 * 1.05, radius);
    float colorMotion = cos(atan(uv.y, uv.x) + iTime * 2.8) * .5 + .5;
    float lightAngle = iTime * -1.5;
    vec2 lightPosition = vec2(cos(lightAngle), sin(lightAngle)) * r0;
    float lightDistance = distance(uv, lightPosition);
    float movingLight = light2(1.5, 5.0, lightDistance);
    movingLight *= light1(1.0, 50.0, radialDistance);
    float outer = 1.0 - smoothstep(mix(innerRadius, 1.0, noise * .5), 1.0, radius);
    float inner = smoothstep(innerRadius, mix(innerRadius, 1.0, .5), radius);

    vec3 deep = adjustHue(vec3(.035, .34, .43), hue);
    vec3 teal = adjustHue(vec3(.03, .67, .68), hue);
    vec3 ice = adjustHue(vec3(.64, .96, .91), hue);
    vec3 shadow = vec3(.015, .10, .15);
    vec3 color = mix(deep, ice, colorMotion);
    color = mix(color, teal, noise);
    color = mix(shadow, color, light);
    color = clamp((color + movingLight * vec3(.52, .98, .94)) * outer * inner, 0.0, 1.0);
    // The original shader sat on an opaque dark canvas. A feathered alpha
    // retains its fluid silhouette without exposing a square or hard rim.
    float feather = 1.0 - smoothstep(.72, .97, radius);
    float alpha = clamp(max(max(color.r, color.g), color.b) * 1.35, 0.0, 1.0) * feather;
    gl_FragColor = vec4(color, alpha);
  }
`;

function OrbScene({ config }: { readonly config: GradientOrbConfig }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({
    iTime: { value: 0 },
    rotationSpeed: { value: config.rotationSpeed ?? 0.75 },
    noiseScale: { value: config.noiseScale ?? 0.65 },
    innerRadius: { value: config.innerRadius ?? 0.1 },
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
