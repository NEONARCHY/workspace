/** Adapted from projects/survey's profiling/aggregation/filtering workflow.
 * Pure deterministic functions. No AI, localStorage, demo data or response transmission.
 */
import type { SurveyConfiguration, SurveyFilter, SurveyQuestionType, SurveyWorkbook } from "@yuksalish/contracts";

export interface SurveyRow { readonly sourceRow: number; readonly values: readonly string[] }
export interface SurveyQuestion { readonly column: number; readonly label: string; readonly type: SurveyQuestionType; readonly reason: string }
export interface SurveyDataset { readonly questions: readonly SurveyQuestion[]; readonly rows: readonly SurveyRow[]; readonly blankRows: number; readonly sheetName: string }
export interface SurveyDistribution { readonly label: string; readonly key: string; readonly count: number; readonly percentage: number }

export const normalizeSurveyValue = (value: string) => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase("ru-RU");
export function surveyNumber(value: string): number | undefined {
  const text = value.trim().replace(/\u00a0/gu, " ");
  // Deliberately do not extract digits from dates, ranges, IDs, or arbitrary text.
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)(?:[eE][+-]?\d+)?$/u.test(text)) return undefined;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}
export function surveyMissing(value: string, configuration: SurveyConfiguration): boolean {
  const normalized = normalizeSurveyValue(value);
  return !normalized || configuration.missingValues.some((marker) => normalizeSurveyValue(marker) === normalized);
}
function detect(values: readonly string[], label: string): { type: SurveyQuestionType; reason: string } {
  if (/^(id|uuid|email|e-mail|телефон|phone|имя|фио|name)$/iu.test(label.trim()))
    return { type: "excluded", reason: "Похоже на идентификатор. Исключено из сводок, но остаётся в исходных данных." };
  if (values.length && values.every((value) => surveyNumber(value) !== undefined))
    return { type: "numeric", reason: "Все непустые значения — числа. Проверьте, не являются ли они кодами вариантов." };
  const unique = new Set(values.map(normalizeSurveyValue)).size;
  return unique > 30 && unique > values.length / 2
    ? { type: "text", reason: "Много уникальных ответов. Предложен текстовый тип." }
    : { type: "categorical", reason: "Предложен один вариант ответа. Множественный выбор включается вручную." };
}
export function buildSurveyDataset(workbook: SurveyWorkbook, configuration: SurveyConfiguration): SurveyDataset {
  const sheet = workbook.sheets[configuration.sheet];
  if (!sheet) return { questions: [], rows: [], blankRows: 0, sheetName: "" };
  const header = sheet.rows[configuration.headerRow] ?? [];
  const width = sheet.rows.slice(configuration.headerRow).reduce((max, row) => Math.max(max, row.length), 0);
  const rows: SurveyRow[] = [];
  let blankRows = 0;
  sheet.rows.slice(configuration.headerRow + 1).forEach((values, index) => {
    if (!values.some((value) => value.trim())) { blankRows++; return; }
    rows.push({ sourceRow: configuration.headerRow + index + 2, values });
  });
  const questions = Array.from({ length: width }, (_, column) => {
    const label = header[column]?.trim() || `Столбец ${column + 1} (без заголовка)`;
    const guessed = detect(rows.map((row) => row.values[column] ?? "").filter((value) => !surveyMissing(value, configuration)), label);
    return { column, label, ...guessed, type: configuration.types[String(column)] ?? guessed.type };
  });
  return { rows, questions, blankRows, sheetName: sheet.name };
}
export function surveyValues(row: SurveyRow, question: SurveyQuestion, configuration: SurveyConfiguration): readonly string[] {
  const raw = row.values[question.column] ?? "";
  if (surveyMissing(raw, configuration)) return [];
  const parts = question.type === "multiple" ? raw.split(configuration.separator) : [raw];
  const unique = new Map<string, string>();
  parts.forEach((part) => {
    if (!surveyMissing(part, configuration)) unique.set(normalizeSurveyValue(part), part.trim());
  });
  return [...unique.values()];
}
export function filterSurveyRows(dataset: SurveyDataset, configuration: SurveyConfiguration): readonly SurveyRow[] {
  const query = normalizeSurveyValue(configuration.query);
  return dataset.rows.filter((row) => {
    if (query && !row.values.some((value) => normalizeSurveyValue(value).includes(query))) return false;
    return configuration.filters.every((filter) => surveyMatches(row, dataset, configuration, filter));
  });
}
function surveyMatches(row: SurveyRow, dataset: SurveyDataset, configuration: SurveyConfiguration, filter: SurveyFilter): boolean {
  const question = dataset.questions.find((item) => item.column === filter.column);
  if (!question) return false;
  const values = surveyValues(row, question, configuration);
  switch (filter.operator ?? "equals") {
    case "empty": return values.length === 0;
    case "filled": return values.length > 0;
    case "contains": return values.some((value) => normalizeSurveyValue(value).includes(normalizeSurveyValue(filter.value)));
    case "range": {
      const value = surveyNumber(row.values[filter.column] ?? "");
      const from = surveyNumber(filter.value);
      const to = surveyNumber(filter.upper ?? "");
      return value !== undefined && from !== undefined && to !== undefined && value >= from && value <= to;
    }
    default: return values.some((value) => normalizeSurveyValue(value) === normalizeSurveyValue(filter.value));
  }
}
export function surveyDistribution(rows: readonly SurveyRow[], question: SurveyQuestion, configuration: SurveyConfiguration) {
  const counts = new Map<string, { label: string; count: number }>();
  let answered = 0;
  rows.forEach((row) => {
    const values = surveyValues(row, question, configuration);
    if (values.length) answered++;
    values.forEach((label) => {
      const key = normalizeSurveyValue(label);
      const existing = counts.get(key);
      counts.set(key, { label: existing?.label ?? label, count: (existing?.count ?? 0) + 1 });
    });
  });
  return {
    answered, missing: rows.length - answered,
    entries: [...counts].map(([key, value]): SurveyDistribution => ({
      key, ...value, percentage: answered ? value.count / answered * 100 : 0,
    })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "ru")),
  };
}
export function surveyNumericSummary(rows: readonly SurveyRow[], question: SurveyQuestion, configuration: SurveyConfiguration) {
  const values: number[] = [];
  let invalid = 0;
  let missing = 0;
  rows.forEach((row) => {
    const raw = row.values[question.column] ?? "";
    if (surveyMissing(raw, configuration)) { missing++; return; }
    const number = surveyNumber(raw);
    if (number === undefined) invalid++;
    else values.push(number);
  });
  values.sort((a, b) => a - b);
  const count = values.length;
  const middle = Math.floor(count / 2);
  // Incremental mean avoids an overflowing intermediate sum of large finite values.
  const mean = count ? values.reduce((acc, value) => acc + value / count, 0) : undefined;
  const median = count ? count % 2 ? values[middle] : values[middle - 1]! / 2 + values[middle]! / 2 : undefined;
  return { count, invalid, missing, mean, median, min: values[0], max: values[count - 1] };
}
export function surveyQuality(dataset: SurveyDataset, configuration: SurveyConfiguration, rows: readonly SurveyRow[]) {
  const signatures = new Map<string, number>();
  const repeatedRows: number[] = [];
  const flagged = new Set<number>();
  rows.forEach((row) => {
    // Position-preserving signature prevents collisions after omitting empty cells.
    const signature = JSON.stringify(dataset.questions.map((question) => normalizeSurveyValue(row.values[question.column] ?? "")));
    if (signatures.has(signature)) { repeatedRows.push(row.sourceRow); flagged.add(row.sourceRow); }
    else signatures.set(signature, row.sourceRow);
  });
  const questions = dataset.questions.filter((item) => item.type !== "excluded").map((question) => {
    let missing = 0;
    let invalid = 0;
    rows.forEach((row) => {
      const raw = row.values[question.column] ?? "";
      if (!surveyValues(row, question, configuration).length) { missing++; flagged.add(row.sourceRow); }
      else if (question.type === "numeric" && surveyNumber(raw) === undefined) { invalid++; flagged.add(row.sourceRow); }
    });
    return { question, missing, invalid };
  });
  return { repeatedRows, flaggedRows: flagged.size, questions };
}
export function surveyComparison(rows: readonly SurveyRow[], question: SurveyQuestion, group: SurveyQuestion, configuration: SurveyConfiguration) {
  const grouped = new Map<string, { label: string; rows: SurveyRow[] }>();
  let ungrouped = 0;
  rows.forEach((row) => {
    const values = surveyValues(row, group, configuration);
    if (!values.length) ungrouped++;
    values.forEach((label) => {
      const key = normalizeSurveyValue(label);
      const item = grouped.get(key) ?? { label, rows: [] };
      item.rows.push(row);
      grouped.set(key, item);
    });
  });
  return { ungrouped, overlapping: group.type === "multiple", groups: [...grouped.values()].map((item) => ({
    label: item.label, size: item.rows.length,
    distribution: surveyDistribution(item.rows, question, configuration),
    numeric: question.type === "numeric" ? surveyNumericSummary(item.rows, question, configuration) : undefined,
  })) };
}
/** Excel-safe CSV is an export copy; the protected original is never rewritten. */
export function surveyCsv(rows: readonly (readonly string[])[]): string {
  return "\uFEFF" + rows.map((row) => row.map((raw) => {
    const value = /^[\s\uFEFF]*[=+@-]/u.test(raw) && surveyNumber(raw) === undefined ? "'" + raw : raw;
    return `"${value.replace(/"/gu, '""')}"`;
  }).join(";")).join("\r\n");
}
