import { useState, type ReactNode } from "react";
import { Button, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { MoreHorizontal20Regular } from "@fluentui/react-icons";

/** One set of existing actions, either inline or in a labelled compact popover. */
export function BrowserChatActions({ compact, children }: { compact: boolean; children: ReactNode }) {
  const [menu, setMenu] = useState({ compact, open: false });
  // Crossing the breakpoint must not reopen an old popover on the next rotation.
  if (menu.compact !== compact) setMenu({ compact, open: false });
  const open = menu.compact === compact && menu.open;
  const setOpen = (value: boolean) => setMenu({ compact, open: value });
  if (!compact) return <div className="conversation-header-actions">{children}</div>;
  return <Popover open={open} onOpenChange={(_, data) => setOpen(data.open)} positioning="below-end" trapFocus>
    <PopoverTrigger disableButtonEnhancement><Button className="browser-chat-actions-trigger" appearance="subtle"
      icon={<MoreHorizontal20Regular />} aria-label="Действия переписки" /></PopoverTrigger>
    <PopoverSurface className="browser-chat-actions-popover" aria-label="Действия переписки">
      <div onClick={(event) => {
        // Keep nested background/theme popovers open; plain actions close this layer.
        const button = (event.target as HTMLElement).closest("button");
        if (button && !button.hasAttribute("aria-haspopup")) setOpen(false);
      }}>{children}</div>
    </PopoverSurface>
  </Popover>;
}
