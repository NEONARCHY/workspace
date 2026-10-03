import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GradientOrb } from "./gradient-orb";
import { advanceOrbMotion } from "./orb-motion";
import { orbFragmentShader } from "./orb-shader";

const canvasState = vi.hoisted(() => ({ fail: false }));
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ frameloop }: { frameloop: string }) => {
    if (canvasState.fail) throw new Error("No GPU context");
    return <canvas data-frameloop={frameloop} />;
  },
  useFrame: vi.fn(),
}));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); canvasState.fail = false; });

describe("React Bits assistant orb", () => {
  it("applies hover to ring rotation and waves, not just colour or launcher scale", () => {
    const image = orbFragmentShader.slice(orbFragmentShader.indexOf("vec4 mainImage"), orbFragmentShader.indexOf("void main()"));
    expect(image).toContain("float s = sin(rot)");
    expect(image).toContain("float c = cos(rot)");
    expect(image).toContain("uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y)");
    expect(image).toContain("uv.x += hover * hoverIntensity * 0.1 * sin(uv.y * 10.0 + iTime)");
    expect(image).toContain("uv.y += hover * hoverIntensity * 0.1 * sin(uv.x * 10.0 + iTime)");
    expect(image).not.toMatch(/uv\s*\*=/);
  });
  it("keeps a static ring without WebGL", () => {
    vi.stubGlobal("WebGLRenderingContext", undefined);
    const { container } = render(<GradientOrb className="assistant-header-icon" />);
    expect(container.querySelector(".gradient-orb-fallback.assistant-header-icon")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("renders the animated canvas when WebGL is available", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    const { container } = render(<GradientOrb />);
    expect(container.querySelector(".gradient-orb canvas")).toHaveAttribute("data-frameloop", "always");
  });
  it("freezes the existing canvas while paused and resumes without remounting it", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    const { container, rerender } = render(<GradientOrb />);
    const canvas = container.querySelector("canvas");
    rerender(<GradientOrb paused />);
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(canvas).toHaveAttribute("data-frameloop", "demand");
    rerender(<GradientOrb />);
    expect(container.querySelector("canvas")).toBe(canvas);
    expect(canvas).toHaveAttribute("data-frameloop", "always");
  });
  it.each(["prefers-reduced-motion", "forced-colors"])("respects %s", (preference) => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes(preference), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const { container } = render(<GradientOrb />);
    expect(container.querySelector(".gradient-orb-fallback")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
  });
  it("pauses rendering when the document is hidden", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    const { container } = render(<GradientOrb />);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector("canvas")).toHaveAttribute("data-frameloop", "demand");
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(container.querySelector("canvas")).toHaveAttribute("data-frameloop", "always");
  });
  it("does not crash the workspace if graphics initialization fails", () => {
    vi.stubGlobal("WebGLRenderingContext", function WebGL() {});
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    canvasState.fail = true;
    const { container } = render(<GradientOrb />);
    expect(container.querySelector(".gradient-orb-fallback")).not.toBeNull();
  });
  it("eases into hover and releases gradually with the same timing at 60/120Hz", () => {
    const simulate = (fps: number) => {
      let state = { hover: 0, rotation: 0 };
      for (let frame = 0; frame < fps; frame++) state = advanceOrbMotion(state, 1, 1 / fps, true, .3);
      return state;
    };
    expect(simulate(60).hover).toBeCloseTo(simulate(120).hover, 5);
    const release = advanceOrbMotion(simulate(60), 0, 1 / 60, true, .3);
    expect(release.hover).toBeGreaterThan(.8);
    expect(release.hover).toBeLessThan(1);
    expect(release.rotation).toBeGreaterThan(0);
    expect(advanceOrbMotion({ hover: 1, rotation: 2 }, 1, 1 / 60, false, .3).rotation).toBe(2);
  });
});
