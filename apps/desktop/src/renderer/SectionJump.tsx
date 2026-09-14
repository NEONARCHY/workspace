import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NavigationKey } from "@yuksalish/contracts";
import { Button, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from "@fluentui/react-components";
import { WorkspaceDialog as Dialog } from "./WorkspaceDialog";
import { Dismiss20Regular, Search20Regular } from "@fluentui/react-icons";

export interface WorkspaceCommand { id: string; label: string; context: string; icon: ReactNode; onSelect: () => void }
export function SectionJump({ items, onNavigate, commands = [] }: {
  readonly items: readonly { key: NavigationKey; label: string; icon: ReactNode }[];
  readonly onNavigate: (key: NavigationKey) => void;
  readonly commands?: readonly WorkspaceCommand[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const show = () => { lastFocused.current = document.activeElement as HTMLElement; setQuery(""); setCursor(0); setOpen(true); };
  const close = () => { setOpen(false); requestAnimationFrame(() => {
    const target = lastFocused.current?.isConnected ? lastFocused.current : trigger.current;
    target?.focus();
  }); };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey && !event.isComposing) {
        // Do not steal focus from another form/dialog currently being edited.
        if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
        event.preventDefault(); show();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const visible = items.filter((item) => item.label.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));
  const records = query.trim().length >= 2 ? commands.filter(item => `${item.label} ${item.context}`.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"))).slice(0, 15) : [];
  const choose = (key: NavigationKey) => {
    setOpen(false);
    onNavigate(key);
    // Settings opens its own dialog; let that dialog manage its focus.
    if (key !== "settings") requestAnimationFrame(() => document.getElementById("workspace-content")?.focus());
  };
  const results = [...visible.map(item => ({ id: item.key, label: item.label, context: "Раздел", icon: item.icon, action: () => choose(item.key) })), ...records.map(item => ({ ...item, action: () => { setOpen(false); item.onSelect(); } }))];
  const resultList = useRef<HTMLDivElement>(null);
  useEffect(() => { resultList.current?.querySelector(".command-active")?.scrollIntoView?.({ block: "nearest" }); }, [cursor]);
  return <>
    <button ref={trigger} className="section-jump-trigger" type="button" onClick={show} aria-label="Перейти в раздел" aria-haspopup="dialog" aria-expanded={open}>
      <Search20Regular /><span>Поиск и быстрый переход</span><kbd>Ctrl K</kbd>
    </button>
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) close(); }}>
      <DialogSurface className="section-jump-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть переход по разделам" onClick={close} />}>Перейти в раздел</DialogTitle>
          <DialogContent>
            <Input aria-label="Найти раздел" contentBefore={<Search20Regular />} placeholder="Раздел, задача или чат…" value={query}
              onChange={(_, data) => { setQuery(data.value); setCursor(0); }} onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setCursor(current => Math.max(0, Math.min(results.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); }
                if (event.key === "Enter" && results[cursor]) { event.preventDefault(); results[cursor].action(); }
              }} />
            <div ref={resultList} className="section-jump-results">
              {results.map((item, index) => <button key={item.id} className={index === cursor ? "command-active" : ""} type="button" onClick={item.action}>{item.icon}<span><strong>{item.label}</strong><small>{item.context}</small></span></button>)}
              {!results.length && <p role="status">Раздел не найден. Попробуйте другое название.</p>}
            </div>
            <span className="sr-only" aria-live="polite">{results[cursor] ? `Выбрано: ${results[cursor].label}. ${results[cursor].context}` : "Нет результатов"}</span>
            <p className="command-hint">↑ ↓ выбрать · Enter открыть · Esc закрыть. Поиск по доступным вам данным.</p>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </>;
}
