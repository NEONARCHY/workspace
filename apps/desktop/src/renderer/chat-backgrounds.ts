export const chatBackgrounds = [
  { id: "mist", label: "Мятный туман", description: "Бирюзовый и молочный" },
  { id: "dawn", label: "Тихий рассвет", description: "Персиковый и сиреневый" },
  { id: "sky", label: "Ясное небо", description: "Нежный голубой" },
  { id: "sage", label: "Шалфей", description: "Спокойный зелёный" },
  { id: "paper", label: "Узор", description: "Лёгкий рисунок на светлом фоне" },
  { id: "suzani", label: "Сюзане", description: "Тёплый узбекский орнамент" },
  { id: "tiles", label: "Мозаика", description: "Геометрия в бирюзовых тонах" },
  { id: "clouds", label: "Облака", description: "Воздушный голубой фон" },
  { id: "contrast", label: "Контраст", description: "Насыщенный песочный фон" },
  { id: "night", label: "Ночная бирюза", description: "Тёмный спокойный фон" },
] as const;

export type ChatBackground = (typeof chatBackgrounds)[number]["id"];
const key = (userId: string) => `yuksalish:chat-background:${userId}`;

export function readChatBackground(userId: string): ChatBackground {
  try {
    const stored = localStorage.getItem(key(userId));
    return chatBackgrounds.find((item) => item.id === stored)?.id ?? "mist";
  } catch {
    return "mist";
  }
}

export function saveChatBackground(userId: string, background: ChatBackground): void {
  try { localStorage.setItem(key(userId), background); } catch { /* Appearance remains usable without storage. */ }
}
