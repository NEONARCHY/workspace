import { ThinkingOrb as LibraryThinkingOrb } from "thinking-orbs";
import type { CSSProperties } from "react";
import { useDocumentColorTheme } from "../../color-theme";

export type ThinkingOrbState = "searching" | "listening" | "composing" | "working" | "solving";

const labels: Record<ThinkingOrbState, string> = {
  searching: "Ищу данные",
  listening: "Слушаю",
  composing: "Формулирую ответ",
  working: "Обрабатываю запрос",
  solving: "Решаю задачу",
};

export function ThinkingOrb({ state = "working", size = 32 }: {
  readonly state?: ThinkingOrbState;
  readonly size?: 20 | 32 | 64;
}) {
  const theme = useDocumentColorTheme();
  return <span className="ws-thinking-orb" role="img" aria-label={labels[state]} style={{ "--ws-thinking-size": `${size}px` } as CSSProperties}>
    <LibraryThinkingOrb state={state} size={size} speed={1.15} color={theme === "dark" ? "#7cdae1" : "#0e6e77"}
      theme={theme} aria-hidden="true" />
    <i className="ws-thinking-orb-fallback" aria-hidden="true" />
  </span>;
}
