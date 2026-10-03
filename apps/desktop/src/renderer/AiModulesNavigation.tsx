import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronRight20Regular, Sparkle24Regular } from "@fluentui/react-icons";
import type { NavigationKey } from "@yuksalish/contracts";

export interface AiModuleNavigationItem {
  readonly key: NavigationKey;
  readonly label: string;
  readonly icon: ReactNode;
}

export interface AiModuleGroup<T extends AiModuleNavigationItem> {
  readonly key: "ai_modules";
  readonly label: "ИИ-модули";
  readonly modules: readonly T[];
}

export function groupAiNavigation<T extends AiModuleNavigationItem>(items: readonly T[]): readonly (T | AiModuleGroup<T>)[] {
  const modules = items.filter((item) => item.key.startsWith("ai_"));
  if (!modules.length) return items;
  const result: (T | AiModuleGroup<T>)[] = [];
  let added = false;
  for (const item of items) {
    if (item.key.startsWith("ai_")) {
      if (!added) {
        result.push({ key: "ai_modules", label: "ИИ-модули", modules });
        added = true;
      }
    } else {
      result.push(item);
    }
  }
  return result;
}

export function AiModulesNavigation({ modules, activeKey, inOverflow = false, onSelect, onCloseOverflow }: {
  readonly modules: readonly AiModuleNavigationItem[];
  readonly activeKey: NavigationKey;
  readonly inOverflow?: boolean;
  readonly onSelect: (key: NavigationKey) => void;
  readonly onCloseOverflow: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = modules.some((item) => item.key === activeKey);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (!triggerRef.current?.contains(event.target) && !panelRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    if (!inOverflow && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 244;
      const panelHeight = Math.min(360, 42 + modules.length * 46);
      const right = rect.right + 9;
      const left = right + panelWidth + 12 <= window.innerWidth ? right : Math.max(12, rect.left - panelWidth - 9);
      setPosition({ left, top: Math.max(12, Math.min(rect.top, window.innerHeight - panelHeight - 12)) });
    }
    setOpen(true);
  };
  const links = <nav className="rail-ai-links" aria-label="Выбор ИИ-модуля">
    {modules.map((item) => <button className={`rail-ai-link${activeKey === item.key ? " active" : ""}`}
      type="button" key={item.key} aria-current={activeKey === item.key ? "page" : undefined}
      onClick={() => { setOpen(false); onCloseOverflow(); onSelect(item.key); }}>
      <span className="rail-ai-link-icon" aria-hidden="true">{item.icon}</span>
      <span>{item.label}</span>
    </button>)}
  </nav>;

  return <>
    <button ref={triggerRef} className={`rail-action rail-ai-trigger${active ? " active" : ""}`} type="button"
      aria-label="ИИ-модули" title="ИИ-модули" aria-expanded={open} aria-haspopup={inOverflow ? undefined : "dialog"}
      aria-controls={open ? "rail-ai-modules" : undefined} onClick={toggle}>
      <span className="rail-icon"><Sparkle24Regular /></span>
      <span className="rail-label">ИИ-модули</span>
      <ChevronRight20Regular className="rail-ai-chevron" aria-hidden="true" />
    </button>
    {open && inOverflow ? <div id="rail-ai-modules" className="rail-ai-inline" ref={panelRef}>{links}</div> : null}
    {open && !inOverflow ? createPortal(<div id="rail-ai-modules" className="rail-ai-popover" role="dialog" aria-label="ИИ-модули"
      ref={panelRef} style={position} onPointerDown={(event) => event.stopPropagation()}>{links}</div>, document.body) : null}
  </>;
}
