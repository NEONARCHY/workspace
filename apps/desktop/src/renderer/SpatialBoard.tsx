import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter, type DropAnimation } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ReOrderDotsVertical20Regular } from "@fluentui/react-icons";

interface CardRecord { node: HTMLElement; content: ReactNode; className: string; label: string; lane: string }
interface DropTransaction {
  readonly id: string;
  readonly lane: string;
  outcome: "pending" | "confirmed" | "rejected";
}
interface BoardContext {
  cards: Map<string, CardRecord>;
  positions: Map<string, DOMRect>;
  active: string | null;
  over: string | null;
  pending: boolean;
  pendingId: string | null;
  landingLane: string | null;
  interactionMode: "standard" | "payment";
  canDrop: (id: string, lane: string) => boolean;
}
const Context = createContext<BoardContext | null>(null);
const useBoard = () => { const board = useContext(Context); if (!board) throw new Error("SpatialCard requires SpatialBoard"); return board; };
const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const directions = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
  if (!directions.includes(event.code)) return;
  event.preventDefault();
  const rect = context.collisionRect;
  if (!rect) return;
  const candidates = context.droppableContainers.getEnabled().map(container => context.droppableRects.get(container.id)).filter(candidate => {
    if (!candidate) return false;
    if (event.code === "ArrowRight") return candidate.left > rect.left + rect.width / 2;
    if (event.code === "ArrowLeft") return candidate.right < rect.right - rect.width / 2;
    if (event.code === "ArrowDown") return candidate.top > rect.top + rect.height / 2;
    return candidate.bottom < rect.bottom - rect.height / 2;
  }).sort((a, b) => Math.hypot(a!.left - rect.left, a!.top - rect.top) - Math.hypot(b!.left - rect.left, b!.top - rect.top));
  const target = candidates[0];
  if (target) return { x: currentCoordinates.x + target.left - rect.left + 12, y: currentCoordinates.y + target.top - rect.top + 72 };
};

/** A board is only a spatial view. The existing mutation remains the authority for a move. */
export function SpatialBoard({ children, canDrop, onMove, onPick, interactionMode = "standard" }: {
  children: ReactNode;
  canDrop: (id: string, lane: string) => boolean;
  onMove: (id: string, lane: string) => Promise<unknown> | void;
  onPick?: (id: string) => void;
  interactionMode?: "standard" | "payment";
}) {
  const [cards] = useState(() => new Map<string, CardRecord>());
  const [positions] = useState(() => new Map<string, DOMRect>());
  const [active, setActive] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [landingLane, setLandingLane] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const transition = useRef<Promise<unknown>>(Promise.resolve());
  const drop = useRef<DropTransaction | null>(null);
  const previewNode = useRef<HTMLElement | null>(null);
  const previousDelta = useRef({ x: 0, y: 0 });
  const motionFrame = useRef(0);
  const motionReleaseTimer = useRef(0);
  const releaseTimer = useRef(0);
  const landingStartTimer = useRef(0);
  const landingReleaseTimer = useRef(0);
  const [preview, setPreview] = useState<CardRecord | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 7 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }));
  const reset = () => { setActive(null); setOver(null); };
  const release = (transaction: DropTransaction) => {
    if (drop.current !== transaction) return;
    window.clearTimeout(releaseTimer.current);
    window.clearTimeout(landingStartTimer.current);
    window.clearTimeout(landingReleaseTimer.current);
    lock.current = false;
    setPending(false);
    setPendingId(null);
    drop.current = null;
  };
  useEffect(() => () => {
    window.clearTimeout(releaseTimer.current);
    window.clearTimeout(motionReleaseTimer.current);
    window.cancelAnimationFrame(motionFrame.current);
  }, []);
  const resetPreviewMotion = () => {
    previousDelta.current = { x: 0, y: 0 };
    previewNode.current?.style.setProperty("--spatial-tilt", "0deg");
    previewNode.current?.style.setProperty("--spatial-drift-x", "0px");
    previewNode.current?.style.setProperty("--spatial-shift", "0px");
    previewNode.current?.style.setProperty("--spatial-stretch-x", "1");
    previewNode.current?.style.setProperty("--spatial-stretch-y", "1");
  };
  const finish = ({ active: picked, over: target }: DragEndEvent) => {
    const id = String(picked.id), lane = target ? String(target.id) : null;
    if (lock.current || !lane || !canDrop(id, lane)) {
      drop.current = { id, lane: "", outcome: "rejected" };
      reset();
      return;
    }
    const transaction: DropTransaction = { id, lane, outcome: "pending" };
    // Assign the promise before DnD removes the active overlay. This avoids a
    // frame where the source reappears while the protected mutation is pending.
    drop.current = transaction;
    lock.current = true;
    setPending(true);
    setPendingId(id);
    setNotice("Сохраняем переход…");
    transition.current = Promise.resolve().then(() => onMove(id, lane)).then(
      () => {
        transaction.outcome = "confirmed";
        setNotice("Данные доски обновлены. Текущий этап указан на карточке.");
        window.clearTimeout(landingStartTimer.current);
        window.clearTimeout(landingReleaseTimer.current);
        setLandingLane(null);
        landingStartTimer.current = window.setTimeout(() => {
          setLandingLane(lane);
          landingReleaseTimer.current = window.setTimeout(() => setLandingLane(null), 720);
        }, 20);
      },
      () => {
        transaction.outcome = "rejected";
        setNotice("Переход не подтверждён. Проверьте состояние карточки перед повтором.");
      },
    );
    // Browsers settle through DragOverlay. This only releases state if a
    // browser cannot mount that overlay (for example JSDOM or a recovering
    // renderer), after the normal landing window has elapsed.
    void transition.current.then(() => {
      releaseTimer.current = window.setTimeout(() => release(transaction), 380);
    });
    reset();
  };
  const settle: DropAnimation = async ({ active: picked, dragOverlay, transform }) => {
    const transaction = drop.current;
    const settleAtSource = async () => {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !dragOverlay.node.animate) return;
      dragOverlay.node.classList.add("is-settling");
      const animation = dragOverlay.node.animate([
        { transform: CSS.Transform.toString(transform) },
        { transform: CSS.Transform.toString({ ...transform, x: 0, y: 0, scaleX: 1, scaleY: 1 }) },
      ], { duration: 210, easing: "cubic-bezier(.22,.8,.22,1)", fill: "forwards" });
      await animation.finished.catch(() => undefined);
    };
    try {
      if (!transaction || transaction.id !== String(picked.id)) return;
      await transition.current;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (transaction.outcome !== "confirmed") {
        await settleAtSource();
        return;
      }
      const destinationNode = cards.get(String(picked.id))?.node;
      const destination = destinationNode?.getBoundingClientRect();
      const destinationLane = destinationNode?.closest<HTMLElement>("[data-spatial-lane]")?.dataset.spatialLane;
      if (destination && destinationLane === transaction.lane && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && dragOverlay.node.animate) {
        dragOverlay.node.classList.add("is-settling");
        const animation = dragOverlay.node.animate([
          { transform: CSS.Transform.toString(transform) },
          { transform: CSS.Transform.toString({ ...transform, x: transform.x + destination.left - dragOverlay.rect.left, y: transform.y + destination.top - dragOverlay.rect.top, scaleX: 1, scaleY: 1 }) },
        ], { duration: 260, easing: "cubic-bezier(.22,.8,.22,1)", fill: "forwards" });
        await animation.finished.catch(() => undefined);
      } else {
        await settleAtSource();
      }
    } finally {
      dragOverlay.node.classList.remove("is-settling");
      if (transaction) release(transaction);
    }
  };
  return <Context.Provider value={{ cards, positions, active, over, pending, pendingId, landingLane, interactionMode, canDrop }}>
    <DndContext sensors={sensors} collisionDetection={args => args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args)}
      autoScroll={{ threshold: { x: 0.12, y: 0.1 }, acceleration: 8, interval: 10 }}
      onDragStart={({ active: picked }) => { if (lock.current) return; const id = String(picked.id); drop.current = null; transition.current = Promise.resolve(); resetPreviewMotion(); setPreview(cards.get(id) ?? null); setActive(id); setNotice(""); onPick?.(id); }}
      onDragMove={({ delta }) => {
        const velocityX = delta.x - previousDelta.current.x;
        const velocityY = delta.y - previousDelta.current.y;
        previousDelta.current = delta;
        window.cancelAnimationFrame(motionFrame.current);
        motionFrame.current = window.requestAnimationFrame(() => {
          const speed = Math.min(18, Math.hypot(velocityX, velocityY));
          previewNode.current?.style.setProperty("--spatial-tilt", `${Math.max(-4.8, Math.min(4.8, velocityX * 0.58))}deg`);
          previewNode.current?.style.setProperty("--spatial-drift-x", `${Math.max(-3.5, Math.min(3.5, velocityX * 0.24))}px`);
          previewNode.current?.style.setProperty("--spatial-shift", `${Math.max(-4, Math.min(4, velocityY * 0.28))}px`);
          previewNode.current?.style.setProperty("--spatial-stretch-x", `${1 + speed * 0.0017}`);
          previewNode.current?.style.setProperty("--spatial-stretch-y", `${1 - speed * 0.0009}`);
        });
        window.clearTimeout(motionReleaseTimer.current);
        motionReleaseTimer.current = window.setTimeout(resetPreviewMotion, 115);
      }}
      onDragOver={({ over: target }) => setOver(target ? String(target.id) : null)} onDragCancel={reset} onDragEnd={event => { void finish(event); }}
      accessibility={{ screenReaderInstructions: { draggable: "Нажмите пробел, чтобы поднять карточку. Стрелками выберите этап. Пробел — перенести, Escape — отменить." }, announcements: {
        onDragStart: ({ active: picked }) => `Поднята карточка: ${cards.get(String(picked.id))?.label ?? ""}`,
        onDragOver: ({ active: picked, over: target }) => target
          ? (canDrop(String(picked.id), String(target.id))
            ? "Доступный этап выбран. Нажмите пробел для переноса."
            : "Этот этап недоступен для переноса.")
          : "Выберите доступный этап.",
        onDragEnd: () => "Перетаскивание завершено. Переход проверяется сервером.", onDragCancel: () => "Перенос отменён.",
      } }}>
      {children}
      {notice ? <span className="sr-only" role="status">{notice}</span> : null}
      {createPortal(<DragOverlay adjustScale={false} dropAnimation={settle}>
        {active && preview ? <article ref={previewNode} style={{ width: preview.node.getBoundingClientRect().width, height: preview.node.getBoundingClientRect().height }} className={`${preview.className} spatial-card spatial-drag-preview ${interactionMode === "payment" ? "is-payment-motion" : ""}`} aria-hidden="true" inert>{preview.content}</article> : null}
      </DragOverlay>, preview?.node.closest(".workspace-view") ?? document.querySelector(".app-provider") ?? document.body)}
    </DndContext>
  </Context.Provider>;
}

export function SpatialLane({ id, children, className = "", ...props }: HTMLAttributes<HTMLElement> & { id: string }) {
  const board = useBoard();
  const allowed = !!board.active && board.canDrop(board.active, id);
  const showUnavailable = board.interactionMode === "payment";
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !board.active || board.pending || (!showUnavailable && !allowed) });
  const unavailable = showUnavailable && !!board.active && isOver && !allowed;
  return <section {...props} ref={setNodeRef}
    className={`${className} spatial-lane ${showUnavailable ? "is-payment-motion" : ""} ${allowed ? "is-receptive" : ""} ${isOver && allowed ? "is-target" : ""} ${unavailable ? "is-unavailable" : ""} ${board.landingLane === id ? "is-landing" : ""}`}
    data-spatial-lane={id} data-drop-state={unavailable ? "unavailable" : isOver && allowed ? "target" : allowed ? "available" : undefined}>
    {children}
    <div className="spatial-drop-marker" aria-hidden="true">{unavailable ? "Недоступно для переноса" : "Переместить сюда"}</div>
  </section>;
}

export function SpatialCard({ id, lane, label, disabled, children, className = "", style, ...props }: HTMLAttributes<HTMLElement> & { id: string; lane: string; label: string; disabled?: boolean; style?: CSSProperties }) {
  const board = useBoard();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id, disabled: disabled || board.pending });
  const node = useRef<HTMLElement | null>(null);
  const movement = useRef<Animation | undefined>(undefined);
  useLayoutEffect(() => {
    const element = node.current;
    if (!element) return;
    movement.current?.cancel();
    const next = element.getBoundingClientRect(), previous = board.positions.get(id);
    board.positions.set(id, next);
    if (!previous || !next.width || board.pendingId === id || board.active === id || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const x = previous.left - next.left, y = previous.top - next.top;
    if ((Math.abs(x) > 1 || Math.abs(y) > 1) && element.animate) movement.current = element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "translate(0, 0)" }], { duration: 240, easing: "cubic-bezier(.2,.8,.2,1)" });
  }, [board.active, board.over, board.pendingId, board.positions, children, id, lane]);
  useLayoutEffect(() => {
    if (node.current) board.cards.set(id, { node: node.current, content: children, className, label, lane });
    return () => { board.cards.delete(id); };
  }, [board.cards, id, children, className, label, lane]);
  return <article {...props} ref={element => { node.current = element; setNodeRef(element); }} style={style}
    className={`${className} spatial-card ${disabled ? "" : "is-draggable"} ${board.interactionMode === "payment" ? "is-payment-motion" : ""} ${isDragging ? "is-lifted" : ""} ${board.pendingId === id ? "is-committing" : ""}`} data-spatial-card={id}
    onPointerDown={event => listeners?.onPointerDown?.(event)}>
    {children}
    {!disabled ? <button ref={setActivatorNodeRef} {...attributes} {...listeners} type="button" className="spatial-grip" aria-label={`Перенести: ${label}`} onClick={event => event.stopPropagation()}><ReOrderDotsVertical20Regular /></button> : null}
  </article>;
}
