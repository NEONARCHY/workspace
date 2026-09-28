import { ThinkingOrb as LibraryThinkingOrb } from "thinking-orbs";

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
  return <LibraryThinkingOrb state={state} size={size} speed={1.15} color="#0e6e77"
    theme="light" aria-label={labels[state]} />;
}
