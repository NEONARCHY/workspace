import { useCallback, useState, useSyncExternalStore } from "react";
import { isEmojiPlaying, subscribeEmoji } from "./emoji-playback";
import { reactionAnimatedUrl, reactionImageUrl, reactionStillUrl } from "./reaction-catalog";
import "./reaction-emoji.css";

/** Decorative artwork; the containing reaction control owns its accessible name. */
export function ReactionEmoji({ emoji, size = 20, eager = false }: { readonly emoji: string; readonly size?: number; readonly eager?: boolean }) {
  const [node, setNode] = useState<HTMLImageElement | null>(null);
  const [failedSources, setFailedSources] = useState<ReadonlySet<string>>(() => new Set());
  const animated = reactionAnimatedUrl(emoji);
  const subscribe = useCallback((notify: () => void) => animated ? subscribeEmoji(node, notify) : () => {}, [node, animated]);
  const snapshot = useCallback(() => isEmojiPlaying(node), [node]);
  const playing = useSyncExternalStore(subscribe, snapshot, () => false);
  const still = reactionStillUrl(emoji);
  const source = [...(playing && animated ? [animated] : []), still, reactionImageUrl(emoji)]
    .find(candidate => !failedSources.has(candidate));
  if (!source) return <span className="reaction-emoji-fallback" aria-hidden="true">{emoji}</span>;
  return <img ref={setNode} className="reaction-emoji-art" src={source} alt="" aria-hidden="true"
    width={size} height={size} draggable={false} decoding="async" loading={eager ? "eager" : "lazy"}
    data-animated={source === animated ? "true" : undefined}
    onError={() => setFailedSources(current => new Set([...current, source]))} />;
}
