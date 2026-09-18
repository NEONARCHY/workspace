import { useEffect, useRef } from "react";

interface WaveLayer {
  readonly amplitude: number;
  readonly baseline: number;
  readonly color: readonly [number, number, number];
  readonly offset: number;
  readonly opacity: number;
  readonly speed: number;
  readonly wavelength: number;
}

const maxPixelRatio = 1.5;
const frameInterval = 1000 / 45;
const motionSpeed = 1.1;
const layers: readonly WaveLayer[] = [
  {
    amplitude: 42,
    baseline: 0.2,
    color: [0, 145, 168],
    offset: 0.2,
    opacity: 0.1,
    speed: 0.00012,
    wavelength: 440,
  },
  {
    amplitude: 52,
    baseline: 0.77,
    color: [61, 113, 180],
    offset: 1.8,
    opacity: 0.075,
    speed: -0.00009,
    wavelength: 520,
  },
  {
    amplitude: 25,
    baseline: 0.51,
    color: [0, 145, 168],
    offset: 3.4,
    opacity: 0.05,
    speed: 0.00007,
    wavelength: 360,
  },
];

function drawLayer(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  layer: WaveLayer,
) {
  const [red, green, blue] = layer.color;
  const baseline = height * layer.baseline;
  const gradient = context.createLinearGradient(0, baseline - layer.amplitude * 2, width, baseline + layer.amplitude * 2);
  gradient.addColorStop(0, `rgb(${red} ${green} ${blue} / 0)`);
  gradient.addColorStop(0.3, `rgb(${red} ${green} ${blue} / ${layer.opacity})`);
  gradient.addColorStop(0.7, `rgb(${red} ${green} ${blue} / ${layer.opacity * 0.72})`);
  gradient.addColorStop(1, `rgb(${red} ${green} ${blue} / 0)`);

  const phase = time * layer.speed + layer.offset;
  const yAt = (x: number) => baseline
    + Math.sin(x / layer.wavelength + phase) * layer.amplitude
    + Math.sin(x / (layer.wavelength * 0.48) + phase * 1.5) * layer.amplitude * 0.16;

  context.beginPath();
  context.moveTo(-24, yAt(-24));
  for (let x = -8; x <= width + 24; x += 16) context.lineTo(x, yAt(x));
  context.lineTo(width + 24, height + 28);
  context.lineTo(-24, height + 28);
  context.closePath();
  context.fillStyle = gradient;
  context.fill();

  context.beginPath();
  context.moveTo(-24, yAt(-24));
  for (let x = -8; x <= width + 24; x += 16) context.lineTo(x, yAt(x));
  context.strokeStyle = `rgb(${red} ${green} ${blue} / ${layer.opacity * 1.15})`;
  context.lineWidth = 1;
  context.stroke();
}

/**
 * A deliberately small canvas loop for the entry screen only. It is capped,
 * pauses in hidden tabs and becomes a static composition for reduced motion.
 */
export function AuthWaves() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    // JSDOM deliberately reports a canvas error instead of returning a usable
    // context. The visual browser check covers drawing; component tests only
    // need the semantic, inert canvas element.
    if (!canvas || navigator.userAgent.includes("jsdom")) return;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastFrame = 0;
    let isVisible = document.visibilityState !== "hidden";
    let isReduced = motion.matches;

    const paint = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      layers.forEach((layer) => drawLayer(
        context,
        width,
        height,
        isReduced ? 0 : time * motionSpeed,
        layer,
      ));
      canvas.dataset.motion = isReduced ? "reduced" : "active";
    };

    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const tick = (time: number) => {
      if (!isVisible || isReduced) return;
      if (time - lastFrame >= frameInterval) {
        paint(time);
        lastFrame = time;
      }
      frame = requestAnimationFrame(tick);
    };
    const start = () => {
      stop();
      paint(0);
      if (!isVisible || isReduced) return;
      lastFrame = 0;
      frame = requestAnimationFrame(tick);
    };
    const visibilityChange = () => {
      isVisible = document.visibilityState !== "hidden";
      if (isVisible) start(); else stop();
    };
    const motionChange = () => {
      isReduced = motion.matches;
      start();
    };
    const resize = () => paint(0);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(resize);

    observer?.observe(canvas);
    motion.addEventListener?.("change", motionChange);
    document.addEventListener("visibilitychange", visibilityChange);
    window.addEventListener("resize", resize);
    start();
    return () => {
      stop();
      observer?.disconnect();
      motion.removeEventListener?.("change", motionChange);
      document.removeEventListener("visibilitychange", visibilityChange);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="auth-wave-canvas" data-auth-waves aria-hidden="true" />;
}
