export const chatBackgrounds = [
  { id: "mist", label: "Мятный туман", description: "Бирюзовый и молочный" },
  { id: "dawn", label: "Тихий рассвет", description: "Персиковый и сиреневый" },
  { id: "sky", label: "Ясное небо", description: "Нежный голубой" },
  { id: "sage", label: "Шалфей", description: "Спокойный зелёный" },
  { id: "lagoon", label: "Лагуна", description: "Глубокий бирюзовый градиент" },
  { id: "sunset", label: "Закат", description: "Тёплый коралловый градиент" },
  { id: "ocean", label: "Океан", description: "Синий градиент с мягким светом" },
  { id: "iris", label: "Ирис", description: "Лавандовый и голубой" },
  { id: "contrast", label: "Контраст", description: "Насыщенный песочный фон" },
  { id: "night", label: "Ночная бирюза", description: "Тёмный спокойный фон" },
] as const;

export type ChatBackground = (typeof chatBackgrounds)[number]["id"];
const key = (userId: string) => `yuksalish:chat-background:${userId}`;
const legacyBackgrounds: Record<string, ChatBackground> = {
  paper: "lagoon", suzani: "sunset", tiles: "ocean", clouds: "iris",
};

export function readChatBackground(userId: string): ChatBackground {
  try {
    const stored = localStorage.getItem(key(userId));
    return chatBackgrounds.find((item) => item.id === stored)?.id
      ?? (stored ? legacyBackgrounds[stored] : undefined) ?? "mist";
  } catch {
    return "mist";
  }
}

export function saveChatBackground(userId: string, background: ChatBackground): void {
  try { localStorage.setItem(key(userId), background); } catch { /* Appearance remains usable without storage. */ }
}
