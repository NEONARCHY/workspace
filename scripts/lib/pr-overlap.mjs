export function findPrOverlaps(pulls) {
  const pairs = [];
  for (let left = 0; left < pulls.length; left++) {
    const a = pulls[left];
    const paths = new Set(a.files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean)));
    for (let right = left + 1; right < pulls.length; right++) {
      const b = pulls[right];
      if (a.base !== b.base) continue;
      const files = [...new Set(b.files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean)))]
        .filter((path) => paths.has(path)).sort();
      if (files.length) pairs.push({ left: a.number, right: b.number, files });
    }
  }
  return pairs;
}

const inline = (value) => `\`${value.replaceAll("`", "&#96;").replace(/[\r\n]/gu, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}\``;
export function renderOverlapReport(repository, pulls, pairs) {
  const label = (number) => number === 0 ? "Текущая локальная ветка" : `[PR #${number}](https://github.com/${repository}/pull/${number})`;
  const incomplete = pulls.filter((pull) => pull.incomplete);
  const lines = ["## Параллельная работа: пересечения PR", "",
    "Это предупреждение о совместно изменённых файлах, не доказательство конфликта и не запрет на PR.", ""];
  for (const pair of pairs) {
    lines.push(`### ${label(pair.left)} ↔ ${label(pair.right)}`, "");
    for (const path of pair.files.slice(0, 30)) lines.push(`- ${inline(path)}`);
    if (pair.files.length > 30) lines.push(`- И ещё ${pair.files.length - 30} файлов.`);
    lines.push("", "Согласуйте общие строки/контракты. После первого merge синхронизируйте второй PR с main и повторите проверки.", "");
  }
  if (!pairs.length) lines.push(incomplete.length ? "В проверенной части файлов пересечений не найдено." : "Общих изменённых файлов не найдено.", "");
  if (incomplete.length) lines.push(`Неполный результат: GitHub ограничивает список 3000 файлами (${incomplete.map((pull) => label(pull.number)).join(", ")}).`, "");
  lines.push("Семантические зависимости между разными файлами всё равно требуют review. Отдельные файлы заметок обновлений не пересекаются.", "");
  return lines.join("\n");
}

export const escapeAnnotation = (value) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
