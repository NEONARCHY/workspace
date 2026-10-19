import { useLayoutEffect, useRef, useState, type ReactNode, type PointerEventHandler } from "react";
import { Portal, PortalMountNodeProvider } from "@fluentui/react-components";

const portalKeys = new WeakMap<HTMLElement, number>();
let nextPortalKey = 0;
function portalKey(container: HTMLElement) {
  if (!portalKeys.has(container)) portalKeys.set(container, ++nextPortalKey);
  return portalKeys.get(container)!;
}

export function menuPortalContainerFor(target: Element): HTMLElement {
  // Menus in an embedded chat must stay above the containing Fluent dialog.
  return target.closest<HTMLElement>(".fui-DialogSurface")?.parentElement ?? document.body;
}

export function MessageContextMenu({ x, y, children, onPointerDown, portalContainer, label, autoFocus = false, accessory, open = true }: {
  readonly open?: boolean;
  readonly x: number;
  readonly y: number;
  readonly children: ReactNode;
  readonly onPointerDown: PointerEventHandler<HTMLDivElement>;
  readonly portalContainer: HTMLElement;
  readonly label?: string;
  readonly autoFocus?: boolean;
  readonly accessory?: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const update = () => {
      const rect = menu.getBoundingClientRect();
      const scale = menu.offsetWidth && rect.width ? rect.width / menu.offsetWidth : 1;
      const margin = 8;
      menu.style.maxHeight = `${Math.max(48, window.innerHeight / scale - margin * 2)}px`;
      menu.style.maxWidth = `${Math.max(48, window.innerWidth / scale - margin * 2)}px`;
      setPosition({
        x: Math.max(margin, Math.min(x / scale, window.innerWidth / scale - menu.offsetWidth - margin)),
        y: Math.max(margin, Math.min(y / scale, window.innerHeight / scale - menu.offsetHeight - margin)),
      });
    };
    update();
    if (label) menu.focus();
    else if (autoFocus) menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const observer = new ResizeObserver(update);
    observer.observe(menu);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [x, y, label, autoFocus, open, portalContainer]);

  // Keep only the empty themed portal alive between openings. Creating a new
  // Fluent provider beside a long history invalidates styles throughout it.
  return <PortalMountNodeProvider value={portalContainer}><Portal key={portalKey(portalContainer)}>{open ? <div ref={menuRef} className={accessory ? "message-context-stack" : "message-context-menu"}
    role={accessory ? undefined : label ? "dialog" : "menu"} aria-label={label} tabIndex={label ? -1 : undefined}
    style={{ left: position.x, top: position.y }} onPointerDown={onPointerDown}>
    {accessory}
    {accessory ? <div className="message-context-menu" role="menu">{children}</div> : children}
  </div> : null}</Portal></PortalMountNodeProvider>;
}
