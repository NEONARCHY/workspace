import { useMemo, useRef, useState } from "react";
import { Button, Input, Popover, PopoverSurface, PopoverTrigger } from "@fluentui/react-components";
import { EmojiAdd24Regular } from "@fluentui/react-icons";
import { Cat, Clock3, Grid2X2, Hand, Heart, PartyPopper, Search, Smile, X } from "lucide-react";
import { reactionCatalog, reactionCategories } from "./reaction-catalog";
import { ReactionEmoji } from "./ReactionEmoji";
import "./reaction-picker.css";

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
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([emoji, value]) => {
      if (!reactionEmojis.includes(emoji as typeof reactionEmojis[number]) || !value || typeof value !== "object") return false;
      const item = value as Partial<ReactionUsage>;
      return typeof item.count === "number" && Number.isFinite(item.count) && item.count >= 0
        && typeof item.lastUsed === "number" && Number.isFinite(item.lastUsed);
    })) as ReactionUsageMap;
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

export function ReactionPicker({ userId, disabled = false, active = [], onSelect, className = "", ownMessage = false }: {
  readonly userId: string; readonly disabled?: boolean; readonly active?: readonly string[];
  readonly onSelect: (emoji: string) => void; readonly className?: string; readonly ownMessage?: boolean;
}) {
  const [usageOwner, setUsageOwner] = useState(userId);
  const [usage, setUsage] = useState<ReactionUsageMap>(() => readUsage(userId));
  if (usageOwner !== userId) { setUsageOwner(userId); setUsage(readUsage(userId)); }
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const emojis = useMemo(() => orderedReactions(usage), [usage]);
  const search = query.trim().toLocaleLowerCase("ru");
  const sections = search
    ? [{ id: "search", label: "Результаты поиска", items: reactionCatalog.filter((item) => `${item.emoji} ${item.label}`.includes(search)) }]
    : category === "frequent"
      ? [{ id: "frequent", label: "Часто используемые", items: emojis.slice(0, 24).map((emoji) => reactionCatalog.find((item) => item.emoji === emoji)!) }]
      : reactionCategories.filter((item) => category === "all" || item.id === category)
        .map((item) => ({ ...item, items: reactionCatalog.filter((emoji) => emoji.category === item.id) }));
  const icons = { smile: Smile, hand: Hand, cat: Cat, party: PartyPopper, heart: Heart };
  return <Popover open={open} onOpenChange={(_, data) => {
    setOpen(data.open);
    if (data.open) { setQuery(""); setCategory("all"); setUsage(readUsage(userId)); }
  }} trapFocus positioning={{ position: ownMessage ? "before" : "after", align: "top", offset: 12, overflowBoundaryPadding: 12, shiftToCoverTarget: true, fallbackPositions: ["above", "below"] }}>
    <PopoverTrigger disableButtonEnhancement><Button className={`reaction-picker-trigger ${className}`} size="small" appearance="subtle" icon={<EmojiAdd24Regular />} aria-label="Добавить реакцию" disabled={disabled} /></PopoverTrigger>
    <PopoverSurface className="reaction-picker-popover" aria-label="Выберите реакцию">
      <div className="reaction-picker-header">
        <Input className="reaction-picker-search" aria-label="Поиск эмодзи" placeholder="Поиск эмодзи" contentBefore={<Search size={16} />} value={query} onChange={(_, data) => { setQuery(data.value); scrollRef.current?.scrollTo?.(0, 0); }} />
        <Button className="reaction-picker-close" appearance="subtle" size="small" icon={<X size={16} />} aria-label="Закрыть реакции" onClick={() => setOpen(false)} />
      </div>
      <div className="reaction-picker-scroll" ref={scrollRef}>
        {sections.map((section) => <section className="reaction-picker-section" key={section.id} aria-label={section.label}>
          <h3>{section.label}</h3>
          <div className="reaction-picker-cells" onKeyDown={(event) => {
            const steps: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 };
            const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
            const index = buttons.indexOf(event.target as HTMLButtonElement);
            const step = steps[event.key];
            if (index < 0 || (step === undefined && event.key !== "Home" && event.key !== "End")) return;
            event.preventDefault();
            buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + step!))]?.focus();
          }}>
            {section.items.map((item) => <button type="button" key={item.emoji} aria-label={item.emoji} title={item.label} aria-pressed={active.includes(item.emoji)} onClick={() => {
              setUsage(rememberReaction(userId, item.emoji)); onSelect(item.emoji); setOpen(false);
            }}><ReactionEmoji emoji={item.emoji} size={28} eager /></button>)}
          </div>
        </section>)}
        {!sections.some((section) => section.items.length) && <p className="reaction-picker-empty" role="status">Эмодзи не найдены</p>}
      </div>
      <nav className="reaction-picker-categories" aria-label="Категории эмодзи">
        {[{ id: "all", label: "Все эмодзи", Icon: Grid2X2 }, { id: "frequent", label: "Частые", Icon: Clock3 }, ...reactionCategories.map((item) => ({ ...item, Icon: icons[item.icon] }))].map(({ id, label, Icon }) => <Button key={id} appearance="subtle" size="small" icon={<Icon />} aria-label={label} title={label} aria-pressed={!search && category === id} onClick={() => { setCategory(id); setQuery(""); scrollRef.current?.scrollTo?.(0, 0); }} />)}
      </nav>
    </PopoverSurface>
  </Popover>;
}
