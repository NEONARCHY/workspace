import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReactionEmoji } from "./ReactionEmoji";
import { isEmojiPlaying, subscribeEmoji } from "./emoji-playback";

describe("native animated reactions", () => {
  let observed: Set<Element>;
  let intersection: IntersectionObserverCallback;
  let preferenceChanged: () => void;
  let reduced: boolean;
  const disconnect = vi.fn();
  const visible = (nodes: Element[], shown = true) => act(() => intersection(nodes.map(target => ({
    target, isIntersecting: shown, intersectionRatio: shown ? 1 : 0,
  } as IntersectionObserverEntry)), {} as IntersectionObserver));

  beforeEach(() => {
    observed = new Set(); reduced = false; disconnect.mockClear();
    vi.stubGlobal("IntersectionObserver", class {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe(node: Element) { observed.add(node); }
      unobserve(node: Element) { observed.delete(node); }
      disconnect = disconnect;
    });
    vi.stubGlobal("matchMedia", () => ({
      get matches() { return reduced; },
      addEventListener: (_: string, callback: () => void) => { preferenceChanged = callback; },
      removeEventListener: vi.fn(),
    }));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("plays visible images, stops offscreen/hidden/reduced-motion and tears down the shared observer", () => {
    const view = render(<><ReactionEmoji emoji="👍" /><ReactionEmoji emoji="❤️" /></>);
    const images = [...view.container.querySelectorAll("img")];
    expect(observed.size).toBe(2);
    expect(images[0]).toHaveAttribute("src", "/emoji/noto/1f44d-still.webp");
    visible(images);
    expect(images[0]).toHaveAttribute("src", "/emoji/noto/1f44d.webp?v=native-2");
    visible([images[0]!], false);
    expect(images[0]).not.toHaveAttribute("data-animated");
    expect(images[1]).toHaveAttribute("data-animated", "true");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(images[1]).not.toHaveAttribute("data-animated");
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(images[1]).toHaveAttribute("data-animated", "true");
    reduced = true; act(() => preferenceChanged());
    expect(images[1]).not.toHaveAttribute("data-animated");
    view.unmount();
    expect(observed.size).toBe(0); expect(disconnect).toHaveBeenCalledOnce();
  });

  it("falls back without retry loops and keeps unsupported artwork static", () => {
    const view = render(<><ReactionEmoji emoji="👍" /><ReactionEmoji emoji="📎" /></>);
    const [image, fallback] = [...view.container.querySelectorAll("img")];
    expect(fallback).toHaveAttribute("src", "/emoji/twemoji/1f4ce.svg");
    expect(observed.size).toBe(1);
    visible([image!]);
    fireEvent.error(image!);
    expect(image).toHaveAttribute("src", "/emoji/noto/1f44d-still.webp");
    fireEvent.error(image!);
    expect(image).toHaveAttribute("src", "/emoji/twemoji/1f44d.svg");
    visible([image!], false); visible([image!]);
    expect(image).toHaveAttribute("src", "/emoji/twemoji/1f44d.svg");
    fireEvent.error(image!);
    expect(view.container).toHaveTextContent("👍");
    expect(observed.size).toBe(0);
  });

  it("limits concurrent decoders and gives the picker priority over background chips", () => {
    const chips = Array.from({ length: 70 }, () => document.createElement("img"));
    const panel = document.createElement("div"); panel.className = "reaction-picker-popover";
    const picker = document.createElement("img"); panel.append(picker);
    const unsubscribes = chips.map(node => subscribeEmoji(node, vi.fn()));
    unsubscribes.push(subscribeEmoji(picker, vi.fn()));
    try {
      visible([...chips, picker]);
      expect(chips.filter(isEmojiPlaying)).toHaveLength(63);
      expect(isEmojiPlaying(picker)).toBe(true);
      expect(disconnect).not.toHaveBeenCalled();
    } finally { unsubscribes.forEach(stop => stop()); }
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("uses static images when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const view = render(<ReactionEmoji emoji="👍" />);
    expect(view.container.querySelector("img")).toHaveAttribute("src", "/emoji/noto/1f44d-still.webp");
  });
});
