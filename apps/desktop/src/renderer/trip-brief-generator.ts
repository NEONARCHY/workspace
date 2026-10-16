const months = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"] as const;
const cyrillic = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяўқғҳ";
const latin = ["a", "b", "v", "g", "d", "e", "yo", "j", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u", "f", "x", "ts", "ch", "sh", "shch", "ʼ", "i", "", "e", "yu", "ya", "oʻ", "q", "gʻ", "h"] as const;
const replacements = new Map([...cyrillic].map((letter, index) => [letter, latin[index] ?? letter]));

function toLatin(value: string): string {
  return [...value].map((letter) => {
    const translated = replacements.get(letter.toLowerCase());
    return translated === undefined ? letter : letter === letter.toUpperCase()
      ? translated.charAt(0).toUpperCase() + translated.slice(1) : translated;
  }).join("");
}

const clean = (value: string) => value.replace(/\s+/gu, " ").trim().replace(/[ .;,]+$/u, "");
const filler = new Set(["test", "asdf", "qwerty", "тест", "нет", "йўқ", "yoq", "bilmayman"]);

function meaningful(value: string, minLetters: number, minWords: number): boolean {
  const normalized = clean(value);
  const words = normalized.match(/\p{L}+/gu) ?? [];
  return [...normalized.matchAll(/\p{L}/gu)].length >= minLetters && words.length >= minWords
    && !/https?:\/\/|www\.|\b[\w.-]+\.(?:com|uz|org|net)\b/iu.test(normalized)
    && !/(.)\1{5,}/iu.test(normalized) && !filler.has(normalized.toLocaleLowerCase())
    && (words.length === 1 || new Set(words.map((word) => word.toLocaleLowerCase())).size > 1);
}

export interface TripBriefFacts {
  readonly destination: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly purpose: string;
  readonly expenseSource: string;
}

export function tripBriefError(facts: TripBriefFacts): string | undefined {
  if (!meaningful(facts.destination, 3, 1)) return "Укажите реальное место поездки без ссылок и заглушек.";
  if (!facts.startDate || !facts.endDate) return "Укажите даты поездки.";
  if (facts.endDate < facts.startDate) return "Дата окончания не может быть раньше даты начала.";
  if (clean(facts.purpose).length > 600 || !meaningful(facts.purpose, 20, 4)) return "Опишите основание и конкретное мероприятие: от четырёх слов и 20 букв до 600 знаков, без ссылок и заглушек.";
  if (!meaningful(facts.expenseSource, 3, 1)) return "Укажите фактический источник покрытия расходов, без ссылок и заглушек.";
  return undefined;
}

export function editedTripBriefError(value: string): string | undefined {
  if (value.length > 6000 || !meaningful(value, 80, 12)) {
    return "Проверьте текст билдирги: минимум 12 слов и 80 букв, максимум 6000 знаков, без ссылок и заглушек.";
  }
  return undefined;
}

function datePhrase(startDate: string, endDate: string): string {
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endDate.split("-").map(Number);
  if (startDate === endDate) return `${startYear}-yil ${startDay}-${months[startMonth! - 1]} kuni`;
  if (startYear === endYear && startMonth === endMonth) return `${startYear}-yil ${startDay}-${endDay}-${months[startMonth! - 1]} kunlari`;
  return `${startYear}-yil ${startDay}-${months[startMonth! - 1]}dan ${endYear}-yil ${endDay}-${months[endMonth! - 1]}gacha`;
}

export function tripBriefPreview(facts: TripBriefFacts): string {
  if (tripBriefError(facts)) return "Заполните поля выше — здесь появится текст билдирги.";
  const place = toLatin(clean(facts.destination));
  const activity = toLatin(clean(facts.purpose)).replace(/[.!?]+$/u, "");
  const funding = toLatin(clean(facts.expenseSource));
  return [
    `${datePhrase(facts.startDate, facts.endDate)} ${place} hududiga xizmat safari rejalashtirilgan. Safar davomida ${activity}.`,
    "Shu munosabat bilan mazkur xizmat safariga ruxsat berishingizni soʻrayman.",
    `Safar xarajatlarini qoplash manbai: ${funding}.`,
  ].join("\n\n");
}
