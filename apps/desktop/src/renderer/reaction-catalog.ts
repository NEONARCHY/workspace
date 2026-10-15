import animatedCodes from "./animated-reactions.json";

const animatedReactions = new Set(animatedCodes);

// Unicode values match the API allowlist. Noto Animated / Twemoji: CC BY 4.0.
export const reactionCategories = [
  { id: "faces", label: "Эмоции", icon: "smile", entries: "😄|радость улыбка;😔|грусть;🥳|праздник;🤔|думаю;🤯|взрыв мозга;😱|страх;😡|злость;🤩|восторг;🤢|тошнота;💩|какашка;🤡|клоун;😭|плач слезы;😌|спокойствие;😂|смех;😮|удивление;😢|печаль;🥰|любовь;😍|влюблен;😎|круто;😉|подмигивание;😊|улыбка;🙂|улыбка;🙃|вверх ногами;😋|вкусно;😛|язык;😜|подмигивание язык;🤪|безумие;🧐|монокль;🤓|очки;😇|ангел;🤗|обнимаю;🤭|смущение;🤫|тихо;🤥|ложь;😐|нейтрально;😑|без эмоций;😶|без слов;😏|усмешка;😒|недовольство;🙄|закатываю глаза;😬|неловкость;🤐|молчу;😪|сон;😴|сплю;🤤|слюни;😷|маска;🤒|болею;🤕|травма;🤑|деньги;😈|дьявол;👿|злой дьявол;👻|призрак;💀|череп;☠️|опасность;👽|пришелец;🤖|робот;🎃|тыква" },
  { id: "gestures", label: "Жесты и люди", icon: "hand", entries: "👍|палец вверх нравится;🤝|рукопожатие;👏|аплодисменты;👎|палец вниз;🙏|спасибо пожалуйста;👌|хорошо ок;👀|глаза смотрю;💪|сила;🙌|ура руки;👋|привет пока;🤚|ладонь;🖐️|пять пальцев;✋|стоп;🖖|вулкан;🤏|немного;✌️|победа;🤞|удача;🤟|люблю;🤘|рок;🤙|позвони;👈|влево;👉|вправо;👆|вверх;👇|вниз;☝️|внимание;✍️|пишу;💅|маникюр;🤳|селфи;💃|танец;🕺|танец" },
  { id: "animals", label: "Животные", icon: "cat", entries: "🐇|кролик заяц;😺|кот улыбка;😸|кот радость;😹|кот смех;😻|кот любовь;😼|кот усмешка;😽|кот поцелуй;🙀|кот страх;😿|кот грусть;😾|кот злость" },
  { id: "celebration", label: "Праздник и награды", icon: "party", entries: "🎉|праздник хлопушка;🚀|ракета запуск;🎊|конфетти;🎈|шар праздник;🎯|цель;🏆|кубок награда;🥇|медаль первое место" },
  { id: "symbols", label: "Символы и предметы", icon: "heart", entries: "❤️|сердце любовь;💔|разбитое сердце;🔥|огонь;✅|готово да;💯|сто процентов;❗|восклицание важно;💡|идея лампа;⭐|звезда;🌟|сияющая звезда;⚡|молния;💥|взрыв;💦|вода;📌|кнопка;📎|скрепка;🧠|мозг;💬|сообщение" },
] as const;

export const reactionCatalog = reactionCategories.flatMap((category) => category.entries.split(";").map((entry) => {
  const [emoji, label] = entry.split("|");
  return { emoji: emoji!, label: label!, category: category.id };
}));

function reactionCode(emoji: string): string {
  return Array.from(emoji).filter((character) => character !== "\uFE0F")
    .map((character) => character.codePointAt(0)!.toString(16)).join("-");
}

export function reactionImageUrl(emoji: string): string {
  return `${import.meta.env.BASE_URL}emoji/twemoji/${reactionCode(emoji)}.svg`;
}

export function reactionAnimatedUrl(emoji: string): string | undefined {
  const code = reactionCode(emoji);
  return animatedReactions.has(code)
    ? `${import.meta.env.BASE_URL}emoji/noto/${code}.webp` : undefined;
}

export function reactionStillUrl(emoji: string): string {
  return reactionAnimatedUrl(emoji)?.replace(/\.webp$/, "-still.webp") ?? reactionImageUrl(emoji);
}
