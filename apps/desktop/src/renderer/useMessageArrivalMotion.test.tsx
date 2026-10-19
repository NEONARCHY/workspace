import { useRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendedMessageIds, firstUnreadMessageId, useMessageArrivalMotion } from "./useMessageArrivalMotion";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const message = (id: string, authorId = "other"): ChatMessage => ({ id, authorId, chatId: "chat", body: id, time: "12:00" });

function Harness({ messages, following = true, scope = "chat", active = true, ready = true, opened = true, unread = 0 }: { messages: ChatMessage[]; following?: boolean; scope?: string; active?: boolean; ready?: boolean; opened?: boolean; unread?: number }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(following);
  const { arrivingIds } = useMessageArrivalMotion({ paneRef, messages, scope, followLatest, currentUserId: "me", active, ready, opened, unread });
  return <div ref={paneRef} data-testid="pane" onScroll={() => { const pane = paneRef.current!; followLatest.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 80; }}>{messages.map(item => <div key={item.id} data-message-row-id={item.id} data-testid={item.id} data-arriving={arrivingIds.has(item.id)}>{item.body}</div>)}</div>;
}

function geometry() {
  let scrollTop = 0;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const isPane = this.dataset.testid === "pane";
    const index = isPane ? 0 : [...this.parentElement!.children].indexOf(this);
    const top = isPane ? 0 : index * 80 - scrollTop;
    return { x: 0, y: top, top, bottom: top + (isPane ? 160 : 80), left: 0, right: 300, width: 300, height: isPane ? 160 : 80, toJSON: () => undefined };
  });
  const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop")!;
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(() => scrollTop);
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (this: HTMLElement, value) { scrollTop = Math.min(value, Math.max(0, this.children.length * 80 - 160)); });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) { return this.children.length * 80; });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(160);
  const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null } as unknown as Animation));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  return { animate, descriptor };
}

describe("Message arrival motion", () => {
  it("finds the unread incoming suffix without counting own or deleted messages", () => {
    const messages = [message("read"), message("first-unread"), message("own", "me"), { ...message("deleted"), deletedAt: "now" }, message("last-unread")];
    expect(firstUnreadMessageId(messages, 2, "me")).toBe("first-unread");
    expect(firstUnreadMessageId(messages, 0, "me")).toBeUndefined();
    expect(firstUnreadMessageId(messages, 99, "me")).toBe("read");
  });
  it("positions a previously hidden mini conversation only when opened, at latest if read", () => {
    geometry();
    const messages = Array.from({ length: 10 }, (_, i) => message(String(i)));
    const view = render(<Harness messages={messages} active={false} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(0);
    view.rerender(<Harness messages={messages} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(640);
  });
  it("opens at first unread and keeps that anchor after mark-read and history refresh", () => {
    geometry();
    const messages = Array.from({ length: 10 }, (_, i) => message(String(i)));
    const view = render(<Harness messages={messages} unread={5} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
    view.rerender(<Harness messages={[...messages]} unread={0} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
    view.rerender(<Harness messages={[...messages, message("incoming")]} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
    view.rerender(<Harness messages={[...messages, message("incoming"), message("sent", "me")]} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(800);
  });
  it("captures unread before an early read response while waiting for history", () => {
    geometry();
    const view = render(<Harness messages={[]} unread={5} />);
    view.rerender(<Harness messages={Array.from({ length: 10 }, (_, i) => message(String(i)))} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
  });
  it("waits for full-page portal bounds before consuming the unread anchor", () => {
    geometry();
    const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(0);
    let resized: ResizeObserverCallback | undefined;
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resized = callback; }
      observe() {} disconnect() {}
    });
    const messages = Array.from({ length: 10 }, (_, i) => message(String(i)));
    const view = render(<Harness messages={messages} unread={5} />);
    view.rerender(<Harness messages={messages} unread={0} />);
    height.mockReturnValue(160);
    act(() => resized?.([], {} as ResizeObserver));
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
  });
  it("does not use the temporary full-page host geometry, or reset a handoff", () => {
    geometry();
    const messages = Array.from({ length: 10 }, (_, i) => message(String(i)));
    const view = render(<Harness messages={messages} unread={5} ready={false} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(0);
    view.rerender(<Harness messages={messages} ready />);
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
    view.rerender(<Harness messages={messages} active={false} />);
    view.rerender(<Harness messages={messages} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(400);
    view.rerender(<Harness messages={messages} opened={false} />);
    view.rerender(<Harness messages={messages} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(640);
  });
  it("recognises tail additions but not edits, history prepends or removals", () => {
    expect(appendedMessageIds(["a", "b"], ["history", "a", "b", "c", "d"])).toEqual(["c", "d"]);
    expect(appendedMessageIds(["a", "b"], ["a", "b"])).toEqual([]);
    expect(appendedMessageIds(["a", "b"], ["b"])).toEqual([]);
  });
  it("does not animate initial history, then glides existing rows upward and fades the new row", () => {
    const { animate } = geometry();
    const view = render(<Harness messages={[message("a"), message("b")]} />);
    expect(animate).not.toHaveBeenCalled();
    view.rerender(<Harness messages={[message("a"), message("b"), message("c")]} />);
    expect(screen.getByTestId("c")).toHaveAttribute("data-arriving", "true");
    expect(animate).toHaveBeenCalledWith([{ transform: "translateY(80px)" }, { transform: "translateY(0)" }], expect.objectContaining({ duration: 320 }));
    expect(animate).toHaveBeenCalledWith([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }], expect.anything());
    const count = animate.mock.calls.length;
    view.rerender(<Harness messages={[message("a"), message("b"), message("c")]} />);
    expect(animate).toHaveBeenCalledTimes(count);
    view.unmount();
    expect(animate.mock.results.at(-1)!.value.cancel).toHaveBeenCalled();
  });
  it("does not pull a history reader to the bottom for incoming messages", () => {
    geometry();
    const view = render(<Harness messages={[message("a"), message("b"), message("c")]} />);
    screen.getByTestId("pane").scrollTop = 0;
    fireEvent.scroll(screen.getByTestId("pane"));
    view.rerender(<Harness messages={[message("a"), message("b"), message("c"), message("d")]} />);
    expect(screen.getByTestId("pane").scrollTop).toBe(0);
  });
  it("skips decoration for reduced motion and a chat switch", () => {
    const { animate } = geometry();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    const view = render(<Harness messages={[message("a")]} />);
    view.rerender(<Harness messages={[message("a"), message("b")]} />);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByTestId("b")).toHaveAttribute("data-arriving", "false");
    act(() => view.rerender(<Harness scope="another-chat" messages={[message("x")]} />));
    expect(animate).not.toHaveBeenCalled();
  });
});
