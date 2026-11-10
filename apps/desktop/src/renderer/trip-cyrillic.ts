/** Uzbek script conversion; existing Cyrillic prose is preserved. */
export function tripCyrillic(value: string): string {
  const latin = "abdefghijklmnopqrstuvxyz";
  const cyrillic = "абдефгҳижклмнопқрстувхйз";
  const pairs: Readonly<Record<string, string>> = { "o'": "ў", "g'": "ғ", sh: "ш", ch: "ч", yo: "ё", yu: "ю", ya: "я", ye: "е", ts: "ц" };
  return value.replace(/[A-Za-z]+(?:['ʻʼ‘’][A-Za-z]+)*/gu, word => {
    const normalized = word.replace(/[ʻʼ‘’]/gu, "'").toLowerCase();
    let text = "";
    for (let index = 0; index < normalized.length;) {
      const pair = pairs[normalized.slice(index, index + 2)];
      if (pair) { text += pair; index += 2; }
      else {
        const letter = normalized[index]!;
        text += letter === "e" && index === 0 ? "э" : letter === "'" ? "ъ" : cyrillic[latin.indexOf(letter)] ?? letter;
        index += 1;
      }
    }
    return word === word.toUpperCase() ? text.toUpperCase()
      : word[0] === word[0]!.toUpperCase() ? text[0]!.toUpperCase() + text.slice(1) : text;
  });
}
