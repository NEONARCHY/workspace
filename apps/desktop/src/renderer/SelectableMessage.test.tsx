import { act, fireEvent, render, screen } from "@testing-library/react";
import { useMemo, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageSelectionContext, SelectableMessage, useMessageSelectionVisibility } from "./SelectableMessage";

describe("message selection shell", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses one viewport observer, brings marks into view and disconnects on unmount", () => {
    const instances: Observer[] = [];
    class Observer implements IntersectionObserver {
      root = null; rootMargin = "80px 0px"; scrollMargin = "0px"; thresholds = [0];
      observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); takeRecords = () => [];
      constructor(readonly callback: IntersectionObserverCallback) { instances.push(this); }
    }
    vi.stubGlobal("IntersectionObserver", Observer);
    const messages = [{ id: "first" }, { id: "second" }];
    function Fixture() {
      const pane = useRef<HTMLDivElement>(null);
      const visibleIds = useMessageSelectionVisibility(pane, messages);
      return <div ref={pane}><MessageSelectionContext.Provider value={{ active: true, ids: new Set(["first"]), visibleIds, toggle: () => undefined, cancel: () => undefined }}>
        {messages.map(message => <SelectableMessage key={message.id} className="message" data-message-id={message.id}
          messageId={message.id} label={message.id}>Текст</SelectableMessage>)}
      </MessageSelectionContext.Provider></div>;
    }
    const { container, unmount } = render(<Fixture />);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.observe).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const targets = container.querySelectorAll<HTMLElement>(".message");
    const deliver = (index: number, isIntersecting: boolean) => act(() => instances[0]!.callback([{
      target: targets[index]!, isIntersecting, time: 0, rootBounds: null, intersectionRatio: Number(isIntersecting),
      boundingClientRect: new DOMRect(), intersectionRect: new DOMRect(),
    }], instances[0]!));
    deliver(0, true);
    expect(screen.getByRole("checkbox", { name: "first" })).toBeChecked();
    deliver(0, false); deliver(1, true);
    expect(screen.queryByRole("checkbox", { name: "first" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "second" })).not.toBeChecked();
    deliver(0, true);
    expect(screen.getByRole("checkbox", { name: "first" })).toBeChecked();
    unmount(); expect(instances[0]!.disconnect).toHaveBeenCalledOnce();
  });
  it("does not rebuild rich children when entering, toggling, focusing or cancelling selection", () => {
    const richRender = vi.fn();
    const reactionFocus = vi.fn();
    const openAttachment = vi.fn();
    function RichContent() { richRender(); return <button onClick={openAttachment}>Фото</button>; }
    function Fixture() {
      const [active, setActive] = useState(false);
      const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
      const rows = useMemo(() => Array.from({ length: 200 }, (_, index) =>
        <SelectableMessage key={index} messageId={String(index)} label={`Сообщение ${index}`} tabIndex={0}
          className="message" onFocus={reactionFocus}><RichContent /></SelectableMessage>), []);
      return <>
        <button onClick={() => { setActive(true); setIds(new Set(["0"])); }}>Выделить</button>
        <MessageSelectionContext.Provider value={{ active, ids,
          toggle: id => setIds(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }),
          cancel: () => { setActive(false); setIds(new Set()); } }}>{rows}</MessageSelectionContext.Provider>
      </>;
    }
    render(<Fixture />);
    expect(richRender).toHaveBeenCalledTimes(200);
    fireEvent.click(screen.getByText("Выделить"));
    const first = screen.getByRole("checkbox", { name: "Сообщение 0" });
    expect(first).toBeChecked();
    fireEvent.focus(first);
    expect(reactionFocus).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Сообщение 1" }));
    fireEvent.click(screen.getAllByText("Фото")[2]!);
    expect(openAttachment).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Сообщение 2" })).toBeChecked();
    const row = first.previousElementSibling!;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(first).not.toBeChecked();
    fireEvent.keyDown(first, { key: "Escape" });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(richRender).toHaveBeenCalledTimes(200);
    fireEvent.click(screen.getAllByText("Фото")[0]!);
    expect(openAttachment).toHaveBeenCalledOnce();
  });
});
