export type ThinkingOrbState = "searching" | "listening" | "composing" | "working" | "solving";

const labels: Record<ThinkingOrbState, string> = {
  searching: "Ищу данные",
  listening: "Слушаю",
  composing: "Формулирую ответ",
  working: "Обрабатываю запрос",
  solving: "Решаю задачу",
};

export function ThinkingOrb({ state = "working" }: { readonly state?: ThinkingOrbState }) {
  return <span className={`thinking-orbs thinking-orbs-${state}`} role="status" aria-label={labels[state]}>
    <span /><span /><span />
  </span>;
}
