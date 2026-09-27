export const chatBackgrounds = [
  { id: "mist", label: "Мятный туман", description: "Бирюзовый и молочный" },
  { id: "dawn", label: "Тихий рассвет", description: "Персиковый и сиреневый" },
  { id: "sky", label: "Ясное небо", description: "Нежный голубой" },
  { id: "sage", label: "Шалфей", description: "Спокойный зелёный" },
  { id: "paper", label: "Узор", description: "Лёгкий рисунок на светлом фоне" },
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
