import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GradientOrb } from "./gradient-orb";

const canvasState = vi.hoisted(() => ({ fail: false }));
vi.mock("@react-three/fiber", () => ({
  Canvas: () => {
    if (canvasState.fail) throw new Error("No GPU context");
    return <canvas data-testid="orb-canvas" />;
  },
  useFrame: vi.fn(),
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); canvasState.fail = false; });

describe("assistant orb", () => {
  it("keeps a static identity without WebGL", () => {
    vi.stubGlobal("WebGLRenderingContext", undefined);
    const { container } = render(<GradientOrb className="assistant-header-icon" />);
    expect(container.querySelector(".gradient-orb-fallback.assistant-header-icon")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("restores a canvas when WebGL is available", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    const { container } = render(<GradientOrb />);
    expect(container.querySelector(".gradient-orb canvas")).not.toBeNull();
  });
  it("respects reduced motion and high contrast", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion") && query.includes("forced-colors"),
      media: query, onchange: null, addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    const { container } = render(<GradientOrb />);
    expect(container.querySelector(".gradient-orb-fallback")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("does not crash the workspace if the graphics context fails", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    canvasState.fail = true;
    const { container } = render(<GradientOrb />);
    expect(container.querySelector(".gradient-orb-fallback")).not.toBeNull();
  });
});
