import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { browserNavigationQuery, observeBrowserViewport, useBrowserCompactLayout } from "./browser-layout";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("updates compact web on the media boundary without changing Electron", () => {
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = false;
  const match = vi.fn(() => media as unknown as MediaQueryList);
  vi.stubGlobal("matchMedia", match);
  const hook = renderHook(({ web }) => useBrowserCompactLayout(web), { initialProps: { web: true } });
  expect(hook.result.current).toBe(false);
  act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
  expect(hook.result.current).toBe(true);
  expect(match).toHaveBeenCalledWith(browserNavigationQuery);
  hook.rerender({ web: false });
  expect(hook.result.current).toBe(false);
});

it("tracks keyboard/viewport height and offset but never reflows pinch zoom", () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  const raf = vi.spyOn(window, "requestAnimationFrame");
  let callback: FrameRequestCallback | undefined;
  raf.mockImplementation((cb) => { callback = cb; return 1; });
  const stop = observeBrowserViewport();
  const root = document.documentElement;
  expect(root.style.getPropertyValue("--ws-browser-height")).toBe("800px");
  viewport.height = 400; viewport.offsetTop = 25;
  viewport.dispatchEvent(new Event("resize")); viewport.dispatchEvent(new Event("scroll"));
  expect(raf).toHaveBeenCalledTimes(1);
  callback!(0);
  expect(root.style.getPropertyValue("--ws-browser-height")).toBe("400px");
  expect(root.style.getPropertyValue("--ws-browser-top")).toBe("25px");
  viewport.height = 200; viewport.scale = 2;
  viewport.dispatchEvent(new Event("resize")); callback!(0);
  expect(root.style.getPropertyValue("--ws-browser-height")).toBe("400px");
  stop();
  expect(root.style.getPropertyValue("--ws-browser-height")).toBe("");
  raf.mockClear(); viewport.dispatchEvent(new Event("resize"));
  expect(raf).not.toHaveBeenCalled();
});

it("falls back to the normal browser window without VisualViewport", () => {
  vi.stubGlobal("visualViewport", undefined);
  const stop = observeBrowserViewport();
  expect(document.documentElement.style.getPropertyValue("--ws-browser-height")).toBe(`${window.innerHeight}px`);
  stop();
});
