import { useEffect, useRef, useState, type ReactNode } from "react";
import type { NavigationKey } from "@yuksalish/contracts";
import { Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, Input } from "@fluentui/react-components";
import { Dismiss20Regular, Search20Regular } from "@fluentui/react-icons";

export function SectionJump({ items, onNavigate }: {
  readonly items: readonly { key: NavigationKey; label: string; icon: ReactNode }[];
  readonly onNavigate: (key: NavigationKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);
  const show = () => { lastFocused.current = document.activeElement as HTMLElement; setQuery(""); setOpen(true); };
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
  const choose = (key: NavigationKey) => {
    setOpen(false);
    onNavigate(key);
    // Settings opens its own dialog; let that dialog manage its focus.
    if (key !== "settings") requestAnimationFrame(() => document.getElementById("workspace-content")?.focus());
  };
  return <>
    <button ref={trigger} className="section-jump-trigger" type="button" onClick={show} aria-label="Перейти в раздел" aria-haspopup="dialog" aria-expanded={open}>
      <Search20Regular /><span>Перейти в раздел</span><kbd>Ctrl K</kbd>
    </button>
    <Dialog open={open} onOpenChange={(_, data) => { if (!data.open) close(); }}>
      <DialogSurface className="section-jump-dialog">
        <DialogBody>
          <DialogTitle action={<Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Закрыть переход по разделам" onClick={close} />}>Перейти в раздел</DialogTitle>
          <DialogContent>
            <Input aria-label="Найти раздел" contentBefore={<Search20Regular />} placeholder="Название раздела" value={query}
              onChange={(_, data) => setQuery(data.value)} onKeyDown={(event) => { if (event.key === "Enter" && visible[0]) choose(visible[0].key); }} />
            <div className="section-jump-results">
              {visible.map((item) => <button key={item.key} type="button" onClick={() => choose(item.key)}>{item.icon}<span>{item.label}</span></button>)}
              {!visible.length && <p role="status">Раздел не найден. Попробуйте другое название.</p>}
            </div>
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  </>;
}
