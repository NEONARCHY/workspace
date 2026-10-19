import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Portal } from "@fluentui/react-components";
import { ArrowUpRight, MessageCircle, Minus, RotateCcw } from "lucide-react";
import { MessengerView, type MessengerViewProps } from "./MessengerView";
import { hasBlockingDialog, useBlockingDialog } from "./components/ui/use-blocking-dialog";
import { launcherCoordinates, miniMessengerBounds, normalizedPosition, readMessengerPosition, readMessengerViewport, type MessengerPosition } from "./floating-messenger-layout";

/** One mounted messenger moves between its full-page slot and a modeless window.
 * Keeping the same tree preserves files, reply, selection and the current draft. */
export function FloatingMessenger({ messenger, fullPage, pageSlot, onOpenFullPage, onMinimizeFullPage }: {
  readonly messenger: MessengerViewProps;
  readonly fullPage: boolean;
  readonly pageSlot: HTMLElement | null;
  readonly onOpenFullPage: (chatId?: string) => void;
  readonly onMinimizeFullPage?: () => void;
}) {
  const storageKey = `ws:mini-messenger-position:${messenger.currentUserId}`;
  const [position, setPosition] = useState(() => readMessengerPosition(storageKey));
  const [viewport, setViewport] = useState(readMessengerViewport);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== "hidden");
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(fullPage);
  const [activeChatId, setActiveChatId] = useState<string>();
  const [notice, setNotice] = useState("");
  const [pageBounds, setPageBounds] = useState<CSSProperties>({});
  const launcher = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; start: MessengerPosition; next: MessengerPosition; moved: boolean } | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const morph = useRef<Animation | undefined>(undefined);
  const restoreFocus = useRef(false);
  const blocking = useBlockingDialog();
  const panelId = useId();
  const helpId = useId();
  const miniOpen = open && !fullPage;
  const visible = fullPage ? Boolean(pageSlot) : miniOpen;
  const unread = messenger.chats.reduce((total, chat) => total + Math.max(0, chat.unread), 0);
  if (fullPage && !visited) setVisited(true);

  useLayoutEffect(() => {
    if (miniOpen || fullPage || !restoreFocus.current) return;
    restoreFocus.current = false;
    const frame = requestAnimationFrame(() => launcher.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [miniOpen, fullPage]);

  useLayoutEffect(() => {
    const element = panel.current;
    if (!miniOpen || !element) return;
    const preference = matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)");
    if (element.animate && !preference.matches) {
      const origin = element.style.getPropertyValue("--messenger-origin-clip");
      morph.current = element.animate([{ clipPath: origin }, { clipPath: "inset(0 round 22px)" }],
        { duration: 320, easing: "cubic-bezier(.22, 1, .36, 1)" });
    }
    const finish = () => morph.current?.finish();
    const onVisibility = () => { if (document.visibilityState === "hidden") finish(); };
    window.addEventListener("resize", finish);
    window.visualViewport?.addEventListener("resize", finish);
    document.addEventListener("visibilitychange", onVisibility);
    preference.addEventListener("change", finish);
    return () => {
      morph.current?.cancel(); morph.current = undefined;
      window.removeEventListener("resize", finish);
      window.visualViewport?.removeEventListener("resize", finish);
      document.removeEventListener("visibilitychange", onVisibility);
      preference.removeEventListener("change", finish);
    };
  }, [miniOpen]);

  useLayoutEffect(() => {
    // A pending microphone permission request must not start recording invisibly
    // after the full page has been left. Keep the same recorder visible in mini.
    if (!visible && !fullPage && panel.current?.querySelector(".has-voice-draft")) { setOpen(true); return; }
    if (!visible || fullPage) return;
    const target = panel.current?.querySelector<HTMLElement>(".conversation-open .composer-input [contenteditable]")
      ?? panel.current?.querySelector<HTMLElement>(".pane-search input");
    target?.focus({ preventScroll: true });
  }, [visible, fullPage]);

  useEffect(() => {
    const update = () => setViewport(readMessengerViewport());
    const visibility = () => setDocumentVisible(document.visibilityState !== "hidden");
    window.addEventListener("resize", update);
    document.addEventListener("visibilitychange", visibility);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("visibilitychange", visibility);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
  }, []);
  useLayoutEffect(() => {
    if (!fullPage || !pageSlot) return;
    const update = () => {
      const rect = pageSlot.getBoundingClientRect();
      const zoom = readMessengerViewport().zoom;
      const next = { left: rect.left / zoom, top: rect.top / zoom, width: rect.width / zoom, height: rect.height / zoom };
      setPageBounds(current => current.left === next.left && current.top === next.top
        && current.width === next.width && current.height === next.height ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(pageSlot);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [fullPage, pageSlot, viewport]);

  const savePosition = (next: MessengerPosition) => {
    setPosition(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Device preference is optional. */ }
  };
  const close = () => {
    if (panel.current?.querySelector(".has-voice-draft")) {
      setNotice("Перед сворачиванием отправьте или отмените голосовое сообщение.");
      return;
    }
    const complete = () => {
      restoreFocus.current = true;
      setOpen(false); setNotice("");
    };
    const element = panel.current;
    if (!element?.animate || matchMedia("(prefers-reduced-motion: reduce), (forced-colors: active)").matches) { complete(); return; }
    const currentClip = getComputedStyle(element).clipPath;
    morph.current?.cancel();
    const animation = element.animate([{ clipPath: currentClip === "none" ? "inset(0 round 22px)" : currentClip }, { clipPath: element.style.getPropertyValue("--messenger-origin-clip") }],
      { duration: 260, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    morph.current = animation;
    animation.onfinish = complete;
  };
  const finishDrag = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = undefined;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = undefined;
    suppressClick.current = current.moved;
    const next = cancelled ? current.start : current.next;
    const coordinates = launcherCoordinates(next, viewport);
    event.currentTarget.style.transform = `translate3d(${coordinates.x}px, ${coordinates.y}px, 0)`;
    if (miniOpen && panel.current) {
      const nextBounds = miniMessengerBounds(next, viewport);
      panel.current.style.left = `${nextBounds.left}px`; panel.current.style.top = `${nextBounds.top}px`;
    }
    savePosition(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.removeAttribute("data-dragging");
  };
  const point = launcherCoordinates(position, viewport);
  const bounds = miniMessengerBounds(position, viewport);
  return <Portal>
    <div className="floating-messenger-root">
      <span className="sr-only" id={helpId}>Перетащите кнопку мышью или удерживайте Alt и нажимайте стрелки. Alt+Home вернёт её в правый нижний угол.</span>
        {/* Native title cannot retain a Tooltip's Escape/focus handlers after the trigger disappears. */}
        <button ref={launcher} type="button" className="floating-messenger-launcher"
          title={unread ? `Мессенджер: непрочитанных ${unread}` : "Мессенджер"}
          style={{ transform: `translate3d(${point.x}px, ${point.y}px, 0)` }} hidden={miniOpen}
          aria-label="Открыть мини-мессенджер" aria-description={unread ? `Непрочитанных сообщений: ${unread}` : "Нет непрочитанных сообщений"}
          aria-describedby={helpId} aria-expanded={visible} aria-controls={panelId} disabled={blocking}
          data-unread={unread > 0 ? "true" : undefined}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            suppressClick.current = false;
            drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: position, next: position, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            const current = drag.current;
            if (!current || current.id !== event.pointerId) return;
            const dx = (event.clientX - current.x) / viewport.zoom;
            const dy = (event.clientY - current.y) / viewport.zoom;
            if (!current.moved && Math.hypot(dx, dy) < 6) return;
            current.moved = true;
            current.next = normalizedPosition(point.x + dx, point.y + dy, viewport);
            event.currentTarget.setAttribute("data-dragging", "true");
            if (frame.current !== undefined) return;
            frame.current = requestAnimationFrame(() => {
              frame.current = undefined;
              const next = launcherCoordinates(current.next, viewport);
              if (launcher.current) launcher.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
              if (miniOpen && panel.current) {
                const nextBounds = miniMessengerBounds(current.next, viewport);
                panel.current.style.left = `${nextBounds.left}px`; panel.current.style.top = `${nextBounds.top}px`;
              }
            });
          }}
          onPointerUp={event => finishDrag(event)}
          onPointerCancel={event => finishDrag(event, true)}
          onLostPointerCapture={event => { if (drag.current) finishDrag(event, true); }}
          onKeyDown={event => {
            if (!event.altKey) return;
            const directions: Record<string, readonly [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
            const direction = directions[event.key];
            if (event.key === "Home") { event.preventDefault(); savePosition({ x: 1, y: 1 }); }
            else if (direction) { event.preventDefault(); const [x, y] = direction; savePosition(normalizedPosition(point.x + x, point.y + y, viewport)); }
          }}
          onClick={event => {
            if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
            if (fullPage) {
              if (onMinimizeFullPage) { setOpen(true); onMinimizeFullPage(); }
              else panel.current?.querySelector<HTMLElement>(".pane-search input, .composer-input [contenteditable]")?.focus();
              return;
            }
            if (miniOpen) close(); else { setVisited(true); setOpen(true); setNotice(""); }
          }}>
          <span className="floating-messenger-icon" aria-hidden="true"><MessageCircle size={23} strokeWidth={1.8} /></span>
          {unread > 0 ? <span className="floating-messenger-badge" aria-hidden="true">{unread > 99 ? "99+" : unread}</span> : null}
        </button>
      {visited ? <section ref={panel} id={panelId} className={`floating-messenger-panel${fullPage ? " is-full-page" : ""}`}
        style={fullPage ? pageBounds : { ...bounds,
          "--messenger-origin-clip": `inset(${point.y - bounds.top}px ${bounds.left + bounds.width - point.x - 48}px ${bounds.top + bounds.height - point.y - 48}px ${point.x - bounds.left}px round 16px)`,
        } as CSSProperties} hidden={!visible} inert={!visible}
        role={fullPage ? "region" : "dialog"} aria-modal={fullPage ? undefined : false} aria-label={fullPage ? "Раздел мессенджера" : "Мини-мессенджер"}
        onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented && !fullPage && !hasBlockingDialog()) { event.stopPropagation(); close(); } }}>
        <header className="floating-messenger-toolbar" hidden={fullPage}>
          <span><MessageCircle size={18} aria-hidden="true" /><strong>Мессенджер</strong></span>
          <div>
            <button type="button" title="Вернуть кнопку в правый нижний угол" aria-label="Вернуть кнопку в правый нижний угол" onClick={() => savePosition({ x: 1, y: 1 })}><RotateCcw size={17} /></button>
            <button type="button" title="Открыть полный мессенджер" aria-label="Открыть полный мессенджер" onClick={() => { setOpen(false); onOpenFullPage(activeChatId); }}><ArrowUpRight size={19} /></button>
            <button type="button" title="Свернуть мини-мессенджер" aria-label="Свернуть мини-мессенджер" onClick={close}><Minus size={19} /></button>
          </div>
        </header>
        {notice ? <p className="floating-messenger-notice" role="status">{notice}</p> : null}
        <MessengerView {...messenger} compact={!fullPage} visible={visible && !blocking && documentVisible} onActiveChatChange={setActiveChatId} />
      </section> : null}
    </div>
  </Portal>;
}
