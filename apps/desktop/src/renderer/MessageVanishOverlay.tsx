import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export interface MessageVanishRequest {
  readonly id: number;
  readonly text: string;
  readonly direction: "vanish" | "restore";
}

interface Particle {
  readonly x: number;
  readonly y: number;
  readonly color: readonly [number, number, number];
  delay: number;
  readonly driftX: number;
  readonly driftY: number;
  readonly size: number;
  readonly noise: number;
}

interface MessageVanishOverlayProps {
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly request?: MessageVanishRequest;
  readonly onComplete: (id: number) => void;
}

export interface MessageRevealRequest {
  readonly id: number;
  readonly text: string;
}

interface MessageRevealOverlayProps {
  readonly request?: MessageRevealRequest;
  readonly onComplete: (id: number) => void;
}

const SWEEP_MS = 120;
const DISSOLVE_MS = 200;

function decorativeMotionDisabled() {
  return (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false)
    || (window.matchMedia?.("(forced-colors: active)").matches ?? false);
}

function animateParticles({
  canvas,
  context,
  source,
  pixelRatio,
  width,
  height,
  requestId,
  direction,
  restoreRevealLead = 0,
  onComplete,
}: {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly source: HTMLCanvasElement;
  readonly pixelRatio: number;
  readonly width: number;
  readonly height: number;
  readonly requestId: number;
  readonly direction: "vanish" | "restore";
  readonly restoreRevealLead?: number;
  readonly onComplete: (id: number) => void;
}) {
  const sourceContext = source.getContext("2d", { alpha: true });
  if (!sourceContext) {
    onComplete(requestId);
    return;
  }

  let pixels: ImageData;
  try {
    pixels = sourceContext.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    onComplete(requestId);
    return;
  }

  const particles: Particle[] = [];
  const stride = Math.max(2, Math.round(pixelRatio * 2));
  for (let y = 0; y < canvas.height; y += stride) {
    for (let x = 0; x < canvas.width; x += stride) {
      const index = (y * canvas.width + x) * 4;
      if ((pixels.data[index + 3] ?? 0) < 90) continue;
      const cssX = x / pixelRatio;
      const distanceFromRight = Math.max(0, width - cssX) / width;
      const seed = (x * 17 + y * 31 + requestId * 13) % 101;
      const particle: Particle = {
        x: cssX,
        y: y / pixelRatio,
        color: [pixels.data[index] ?? 0, pixels.data[index + 1] ?? 0, pixels.data[index + 2] ?? 0],
        delay: distanceFromRight * SWEEP_MS,
        driftX: ((seed % 9) - 4) * 0.18,
        driftY: ((seed % 13) - 7) * 0.52,
        size: 0.48 + (seed % 6) * 0.12,
        noise: seed * 0.19,
      };
      particles.push(particle);
      if (seed % 5 === 0) {
        particles.push({
          ...particle,
          x: particle.x + 0.46,
          y: particle.y - 0.32,
          size: particle.size * 0.72,
          noise: particle.noise + 1.7,
        });
      }
    }
  }

  if (!particles.length) {
    onComplete(requestId);
    return;
  }

  const minX = particles.reduce((value, particle) => Math.min(value, particle.x), width);
  const maxX = particles.reduce((value, particle) => Math.max(value, particle.x), 0);
  const textWidth = Math.max(1, maxX - minX);
  for (const particle of particles) {
    particle.delay = ((maxX - particle.x) / textWidth) * SWEEP_MS;
  }

  context.clearRect(0, 0, width, height);
  let animationFrame = 0;
  const startedAt = performance.now();
  const render = (now: number) => {
    const elapsed = now - startedAt;
    const timeline = direction === "vanish"
      ? elapsed
      : Math.max(0, SWEEP_MS + DISSOLVE_MS - elapsed);
    context.clearRect(0, 0, width, height);
    const sweepProgress = Math.min(1, timeline / SWEEP_MS);
    const intactUntil = maxX - sweepProgress * textWidth;
    const leadingGlyphReady = direction !== "restore"
      || intactUntil >= minX + restoreRevealLead;
    if (intactUntil > minX && leadingGlyphReady) {
      context.save();
      context.beginPath();
      context.rect(0, 0, intactUntil + 1, height);
      context.clip();
      context.drawImage(source, 0, 0, width, height);
      context.restore();
    }
    for (const particle of particles) {
      if (
        direction === "restore"
        && !leadingGlyphReady
        && particle.x <= minX + restoreRevealLead
      ) continue;
      const age = timeline - particle.delay;
      if (age < 0) continue;
      const progress = Math.min(1, age / DISSOLVE_MS);
      const eased = 1 - (1 - progress) ** 3;
      const alpha = (1 - progress) ** 1.7;
      if (alpha <= 0.01) continue;
      context.fillStyle = `rgb(${particle.color.join(" ")} / ${alpha})`;
      const turbulence = Math.sin(particle.noise + progress * 8) * progress * 2.88;
      const dustX = particle.x + (18 + particle.driftX * 12) * eased + turbulence;
      const dustY = particle.y + particle.driftY * eased * 1.2 + turbulence * 0.54;
      const radius = particle.size * (1 - progress * 0.62);
      context.beginPath();
      context.arc(dustX, dustY, radius, 0, Math.PI * 2);
      context.fill();
    }
    if (elapsed < SWEEP_MS + DISSOLVE_MS) {
      animationFrame = requestAnimationFrame(render);
    } else {
      context.clearRect(0, 0, width, height);
      onComplete(requestId);
    }
  };
  render(startedAt);
  return () => cancelAnimationFrame(animationFrame);
}

export function MessageVanishOverlay({
  inputRef,
  request,
  onComplete,
}: MessageVanishOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const input = inputRef.current;
    if (!request || !canvas || !input || decorativeMotionDisabled()) {
      if (request) completeRef.current(request.id);
      return;
    }
    if (/jsdom/i.test(navigator.userAgent)) {
      completeRef.current(request.id);
      return;
    }

    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      completeRef.current(request.id);
      return;
    }
    if (!context) {
      completeRef.current(request.id);
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const style = getComputedStyle(input);
    const fieldStyle = getComputedStyle(input.parentElement ?? input);
    const fontSize = Number.parseFloat(style.fontSize) || 14;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const inputBounds = input.getBoundingClientRect();
    const offsetX = inputBounds.left - bounds.left + paddingLeft - input.scrollLeft;
    const offsetY = inputBounds.top - bounds.top;
    const source = document.createElement("canvas");
    source.width = canvas.width;
    source.height = canvas.height;
    const sourceContext = source.getContext("2d", { alpha: true });
    if (!sourceContext) {
      completeRef.current(request.id);
      return;
    }
    sourceContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    sourceContext.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    sourceContext.textBaseline = "middle";
    sourceContext.fillStyle = fieldStyle.color || "#293a55";
    sourceContext.fillText(request.text, offsetX, offsetY + inputBounds.height / 2);

    return animateParticles({
      canvas,
      context,
      source,
      pixelRatio,
      width,
      height,
      requestId: request.id,
      direction: request.direction,
      onComplete: (id) => completeRef.current(id),
    });
  }, [inputRef, request]);

  return <canvas ref={canvasRef} className="message-vanish-canvas" aria-hidden="true" />;
}

export function MessageRevealOverlay({ request, onComplete }: MessageRevealOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const completeRef = useRef(onComplete);

  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const body = canvas?.parentElement;
    const text = body?.querySelector<HTMLElement>(".message-text");
    if (!request || !canvas || !body || !text || decorativeMotionDisabled()) {
      if (request) completeRef.current(request.id);
      return;
    }
    if (/jsdom/i.test(navigator.userAgent)) {
      completeRef.current(request.id);
      return;
    }

    let context: CanvasRenderingContext2D | null;
    try {
      context = canvas.getContext("2d", { alpha: true });
    } catch {
      completeRef.current(request.id);
      return;
    }
    if (!context) {
      completeRef.current(request.id);
      return;
    }

    const bounds = canvas.getBoundingClientRect();
    const textBounds = text.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const source = document.createElement("canvas");
    source.width = canvas.width;
    source.height = canvas.height;
    const sourceContext = source.getContext("2d", { alpha: true });
    if (!sourceContext) {
      completeRef.current(request.id);
      return;
    }
    const style = getComputedStyle(text);
    const fontSize = Number.parseFloat(style.fontSize) || 14;
    const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.48;
    const startX = textBounds.left - bounds.left;
    const startY = textBounds.top - bounds.top;
    sourceContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    sourceContext.font = `${style.fontStyle} ${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    sourceContext.textBaseline = "alphabetic";
    sourceContext.fillStyle = style.color || "#293a55";

    const lineMetrics = sourceContext.measureText("Mg");
    const ascent = lineMetrics.actualBoundingBoxAscent || fontSize * 0.78;
    const descent = lineMetrics.actualBoundingBoxDescent || fontSize * 0.22;
    const baselineOffset = Math.max(0, (lineHeight - ascent - descent) / 2) + ascent;
    const firstGlyph = Array.from(request.text.trimStart())[0] ?? "";
    const restoreRevealLead = firstGlyph
      ? Math.max(1, sourceContext.measureText(firstGlyph).width)
      : 0;

    const lines = request.text.split("\n");
    let y = startY + baselineOffset;
    for (const paragraph of lines) {
      const words = paragraph.split(/\s+/u);
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (line && sourceContext.measureText(candidate).width > textBounds.width) {
          sourceContext.fillText(line, startX, y);
          y += lineHeight;
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) sourceContext.fillText(line, startX, y);
      y += lineHeight;
    }

    return animateParticles({
      canvas,
      context,
      source,
      pixelRatio,
      width,
      height,
      requestId: request.id,
      direction: "restore",
      restoreRevealLead,
      onComplete: (id) => completeRef.current(id),
    });
  }, [request]);

  return <canvas ref={canvasRef} className="message-reveal-canvas" aria-hidden="true" />;
}
