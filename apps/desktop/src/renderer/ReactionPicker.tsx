import { useMemo, useState } from "react";
import { Button, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger } from "@fluentui/react-components";
import { EmojiAdd24Regular } from "@fluentui/react-icons";

export const reactionEmojis = [
  "👍", "😄", "❤️", "🤝", "👏", "💔", "😔", "🔥", "👎", "🥳", "🤔", "🤯", "😱", "😡", "🎉", "🤩",
  "🤢", "💩", "🙏", "👌", "🐇", "🤡", "😭", "😌", "✅", "💯", "❗", "😂", "😮", "😢", "👀", "🥰",
  "😍", "😎", "💪", "🙌", "🚀", "😉", "😊", "🙂", "🙃", "😋", "😛", "😜", "🤪", "🧐", "🤓", "😇",
  "🤗", "🤭", "🤫", "🤥", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤐", "😪", "😴", "🤤", "😷",
  "🤒", "🤕", "🤑", "😈", "👿", "👻", "💀", "☠️", "👽", "🤖", "🎃", "😺", "😸", "😹", "😻", "😼",
  "😽", "🙀", "😿", "😾", "👋", "🤚", "🖐️", "✋", "🖖", "🤏", "✌️", "🤞", "🤟", "🤘", "🤙", "👈",
  "👉", "👆", "👇", "☝️", "✍️", "💅", "🤳", "💃", "🕺", "🎊", "🎈", "💡", "⭐", "🌟", "⚡", "💥",
  "💦", "🎯", "🏆", "🥇", "📌", "📎", "🧠", "💬",
] as const;

interface ReactionUsage { readonly count: number; readonly lastUsed: number }
type ReactionUsageMap = Record<string, ReactionUsage>;
const storageKey = (userId: string) => `yuksalish:reaction-usage:${userId}`;

function readUsage(userId: string): ReactionUsageMap {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? parsed as ReactionUsageMap : {};
  } catch { return {}; }
}

function rememberReaction(userId: string, emoji: string): ReactionUsageMap {
  const usage = readUsage(userId);
  const next = { ...usage, [emoji]: { count: (usage[emoji]?.count ?? 0) + 1, lastUsed: Date.now() } };
  try { localStorage.setItem(storageKey(userId), JSON.stringify(next)); } catch { /* optional personalization */ }
  return next;
}

function orderedReactions(usage: ReactionUsageMap): readonly string[] {
  return reactionEmojis.map((emoji, index) => ({ emoji, index, usage: usage[emoji] }))
    .sort((left, right) => (right.usage?.count ?? 0) - (left.usage?.count ?? 0)
      || (right.usage?.lastUsed ?? 0) - (left.usage?.lastUsed ?? 0) || left.index - right.index)
    .map((item) => item.emoji);
}

export function orderedReactionsForUser(userId: string): readonly string[] {
  return orderedReactions(readUsage(userId));
}

export function ReactionPicker({ userId, disabled = false, active = [], onSelect, className = "" }: {
  readonly userId: string; readonly disabled?: boolean; readonly active?: readonly string[];
  readonly onSelect: (emoji: string) => void; readonly className?: string;
}) {
  const [usage, setUsage] = useState<ReactionUsageMap>(() => readUsage(userId));
  const emojis = useMemo(() => orderedReactions(usage), [usage]);
  return <Menu positioning={{ position: "after", align: "top" }}>
    <MenuTrigger disableButtonEnhancement><Button className={`reaction-picker-trigger ${className}`} size="small" appearance="subtle" icon={<EmojiAdd24Regular />} aria-label="Добавить реакцию" disabled={disabled} /></MenuTrigger>
    <MenuPopover className="reaction-picker-popover"><MenuList className="reaction-picker-grid" aria-label="Выберите реакцию">
      {emojis.map((emoji) => <MenuItem aria-label={emoji} aria-checked={active.includes(emoji)} role="menuitemcheckbox" key={emoji} onClick={() => {
        setUsage(rememberReaction(userId, emoji)); onSelect(emoji);
      }}>{emoji}</MenuItem>)}
    </MenuList></MenuPopover>
  </Menu>;
}
