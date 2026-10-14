import { useRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ChatMessage } from "@yuksalish/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendedMessageIds, useMessageArrivalMotion } from "./useMessageArrivalMotion";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const message = (id: string, authorId = "other"): ChatMessage => ({ id, authorId, chatId: "chat", body: id, time: "12:00" });

function Harness({ messages, following = true, scope = "chat" }: { messages: ChatMessage[]; following?: boolean; scope?: string }) {
  const paneRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(following);
  const { arrivingIds } = useMessageArrivalMotion({ paneRef, messages, scope, followLatest, currentUserId: "me" });
  return <div ref={paneRef} data-testid="pane">{messages.map(item => <div key={item.id} data-message-row-id={item.id} data-testid={item.id} data-arriving={arrivingIds.has(item.id)}>{item.body}</div>)}</div>;
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
  const animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null } as unknown as Animation));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  return { animate, descriptor };
}

describe("Message arrival motion", () => {
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
    const view = render(<Harness messages={[message("a"), message("b")]} following={false} />);
    view.rerender(<Harness messages={[message("a"), message("b"), message("c")]} following={false} />);
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
