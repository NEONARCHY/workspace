import { useEffect, useLayoutEffect, useRef } from "react";
import type { RefObject } from "react";

export interface MessageVanishRequest {
  readonly id: number;
  readonly text: string;
  readonly direction: "vanish" | "restore";
  readonly scrollLeft?: number;
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

const MIN_SWEEP_MS = 120;
const MAX_SWEEP_MS = 1_100;
const DISSOLVE_MS = 200;

export function getMessageParticleTiming(text: string) {
  const characterCount = Array.from(text.trim()).length;
  const sweepMs = Math.min(
    MAX_SWEEP_MS,
    MIN_SWEEP_MS + Math.max(0, characterCount - 18) * 4,
  );
  return {
    dissolveMs: DISSOLVE_MS,
    sweepMs,
    totalMs: sweepMs + DISSOLVE_MS,
  } as const;
}

export function wrapMessageParticleText(
  text: string,
  maxWidth: number,
  measureWidth: (value: string) => number,
) {
  if (maxWidth <= 0) return text.split("\n");
  const wrapped: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph) {
      wrapped.push("");
      continue;
    }
    let remaining = Array.from(paragraph);
    while (remaining.length > 0) {
      if (measureWidth(remaining.join("")) <= maxWidth) {
        wrapped.push(remaining.join(""));
        break;
      }
      let low = 1;
      let high = remaining.length;
      let fittingLength = 1;
      while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (measureWidth(remaining.slice(0, middle).join("")) <= maxWidth) {
          fittingLength = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      const fitting = remaining.slice(0, fittingLength);
      let lastWhitespace = -1;
      for (let index = fitting.length - 1; index >= 0; index -= 1) {
        if (/\s/u.test(fitting[index] ?? "")) {
          lastWhitespace = index;
          break;
        }
      }
      const breakAt = lastWhitespace > 0 ? lastWhitespace + 1 : fittingLength;
      wrapped.push(remaining.slice(0, breakAt).join("").trimEnd());
      remaining = remaining.slice(breakAt);
    }
  }
  return wrapped;
}

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
  sweepMs,
  dissolveMs,
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
  readonly sweepMs: number;
  readonly dissolveMs: number;
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
      const seed = (x * 17 + y * 31 + requestId * 13) % 101;
      const particle: Particle = {
        x: cssX,
        y: y / pixelRatio,
        color: [pixels.data[index] ?? 0, pixels.data[index + 1] ?? 0, pixels.data[index + 2] ?? 0],
        delay: 0,
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
    particle.delay = ((maxX - particle.x) / textWidth) * sweepMs;
  }

  context.clearRect(0, 0, width, height);
  let animationFrame = 0;
  const startedAt = performance.now();
  const render = (now: number) => {
    const elapsed = now - startedAt;
    const totalMs = sweepMs + dissolveMs;
    const timeline = direction === "vanish"
      ? elapsed
      : Math.max(0, totalMs - elapsed);
    context.clearRect(0, 0, width, height);
    const sweepProgress = Math.min(1, timeline / sweepMs);
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
      const progress = Math.min(1, age / dissolveMs);
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
    if (elapsed < totalMs) {
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
    if (request.direction === "restore" && request.scrollLeft !== undefined) {
      input.scrollLeft = request.scrollLeft;
    }
    const inputBounds = input.getBoundingClientRect();
    const offsetX = inputBounds.left - bounds.left + paddingLeft
      - (request.scrollLeft ?? input.scrollLeft);
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

    const timing = getMessageParticleTiming(request.text);

    return animateParticles({
      canvas,
      context,
      source,
      pixelRatio,
      width,
      height,
      requestId: request.id,
      direction: request.direction,
      sweepMs: timing.sweepMs,
      dissolveMs: timing.dissolveMs,
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

    const lines = wrapMessageParticleText(
      request.text,
      textBounds.width,
      (value) => sourceContext.measureText(value).width,
    );
    let y = startY + baselineOffset;
    for (const line of lines) {
      if (line) sourceContext.fillText(line, startX, y);
      y += lineHeight;
    }

    const timing = getMessageParticleTiming(request.text);

    return animateParticles({
      canvas,
      context,
      source,
      pixelRatio,
      width,
      height,
      requestId: request.id,
      direction: "restore",
      sweepMs: timing.sweepMs,
      dissolveMs: timing.dissolveMs,
      restoreRevealLead,
      onComplete: (id) => completeRef.current(id),
    });
  }, [request]);

  return <canvas ref={canvasRef} className="message-reveal-canvas" aria-hidden="true" />;
}
