import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@yuksalish/contracts";
import { useMessageScrollNavigation } from "./useMessageScrollNavigation";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const message = (id: string, authorId = "other"): ChatMessage => ({ id, authorId, chatId: "chat", body: id, time: "12:00" });
const history = Array.from({ length: 10 }, (_, i) => message(String(i)));
function Harness({ messages = history, boundary, active = true, opened = true }: { messages?: ChatMessage[]; boundary?: string; active?: boolean; opened?: boolean }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const nav = useMessageScrollNavigation({ paneRef, messages, initialUnreadMessageId: boundary, currentUserId: "me", active, opened });
  return <><div ref={paneRef} data-testid="pane" tabIndex={-1} onScroll={nav.onScroll}>
    {messages.map(item => <div key={item.id} data-message-row-id={item.id} data-testid={item.id}>{item.body}</div>)}
  </div><button hidden={!nav.visible} onClick={() => nav.jumpToLatest(false)}>Latest</button><output data-testid="unread">{nav.unread}</output></>;
}
function geometry() {
  let scrollTop = 0;
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(160);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.children.length * 80; });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(() => scrollTop);
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value) { scrollTop = Math.max(0, Math.min(value, this.scrollHeight - 160)); });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const pane = this.dataset.testid === "pane";
    const top = pane ? 0 : [...this.parentElement!.children].indexOf(this) * 80 - scrollTop;
    const height = pane ? 160 : 80;
    return { top, bottom: top + height, height, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => undefined };
  });
  const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0; });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  const flush = () => act(() => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); });
  const scroll = (top: number) => { const pane = screen.getByTestId("pane"); pane.scrollTop = top; fireEvent.scroll(pane); flush(); };
  return { scroll, scrollTo, flush, height };
}
describe("message scroll navigation", () => {
  it("shows only above the end, counts the opening unread suffix and clears as it is viewed", () => {
    const { scroll, flush } = geometry();
    render(<Harness boundary="5" />);
    flush();
    expect(screen.getByRole("button", { name: "Latest" })).toBeVisible();
    expect(screen.getByTestId("unread")).toHaveTextContent("5");
    scroll(400);
    expect(screen.getByTestId("unread")).toHaveTextContent("3");
    scroll(480);
    expect(screen.getByTestId("unread")).toHaveTextContent("2");
    scroll(640);
    expect(screen.queryByRole("button", { name: "Latest" })).not.toBeInTheDocument();
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
    scroll(0);
    expect(screen.getByRole("button", { name: "Latest" })).toBeVisible();
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });
  it("adds only new incoming IDs, not own sends/edits, and jumps with focus and an exact reset", () => {
    const { scrollTo, flush } = geometry();
    const view = render(<Harness />);
    view.rerender(<Harness messages={[...history, message("incoming"), message("own", "me")]} />);
    flush();
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
    view.rerender(<Harness messages={[...history, { ...message("incoming"), body: "edited" }, message("own", "me")]} />);
    flush();
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Latest" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 960, behavior: "instant" });
    expect(screen.getByTestId("pane")).toHaveFocus();
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: "Latest" })).not.toBeInTheDocument();
  });
  it("retains unviewed incoming messages while temporarily hidden and drops deleted IDs", () => {
    const { flush } = geometry();
    const view = render(<Harness active={false} />);
    view.rerender(<Harness active={false} messages={[...history, message("incoming")]} />);
    expect(screen.queryByRole("button", { name: "Latest" })).not.toBeInTheDocument();
    view.rerender(<Harness messages={[...history, message("incoming")]} />);
    flush();
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
    view.rerender(<Harness messages={history} />);
    flush();
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });
  it("does not seed a previously-read boundary on chat list reentry", () => {
    const { scroll } = geometry();
    const view = render(<Harness boundary="5" />);
    scroll(640);
    view.rerender(<Harness opened={false} />);
    view.rerender(<Harness />);
    scroll(0);
    expect(screen.getByTestId("unread")).toHaveTextContent("0");
  });
  it("hides in a collapsed viewport without consuming unseen incoming messages", () => {
    const { scroll, flush, height } = geometry();
    const view = render(<Harness />);
    view.rerender(<Harness messages={[...history, message("incoming")]} />); flush();
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
    height.mockReturnValue(0); scroll(0);
    expect(screen.queryByRole("button", { name: "Latest" })).not.toBeInTheDocument();
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
    height.mockReturnValue(160); scroll(0);
    expect(screen.getByRole("button", { name: "Latest" })).toBeVisible();
    expect(screen.getByTestId("unread")).toHaveTextContent("1");
  });
});
