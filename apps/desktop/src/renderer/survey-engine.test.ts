import { describe, expect, it } from "vitest";
import type { SurveyConfiguration, SurveyWorkbook } from "@yuksalish/contracts";
import { buildSurveyDataset, filterSurveyRows, surveyComparison, surveyCsv, surveyDistribution, surveyMissing, surveyNumber, surveyNumericSummary, surveyQuality } from "./survey-engine";

const config: SurveyConfiguration = { sheet: 0, headerRow: 0, types: {}, separator: ";", missingValues: [], query: "", filters: [], savedViews: [] };
const book: SurveyWorkbook = { warnings: [], sheets: [{ name: "Ответы", rows: [
  ["Группа", "Возраст", "Варианты"], [" A ", "20", "Да; Да;НЕТ"], ["a", "30", "да"], ["B", "", ""], ["B", "40", "нет;да"], [],
] }] };
const setup = (changes: Partial<SurveyConfiguration> = {}) => {
  const configuration = { ...config, ...changes };
  return { configuration, dataset: buildSurveyDataset(book, configuration) };
};
describe("trustworthy survey arithmetic", () => {
  it("counts blank rows explicitly and keeps original source coordinates", () => {
    const { dataset } = setup();
    expect(dataset.blankRows).toBe(1);
    expect(dataset.rows.map((row) => row.sourceRow)).toEqual([2, 3, 4, 5]);
    expect(dataset.rows[0]?.values[0]).toBe(" A ");
  });
  it("does not guess multiple choice from punctuation", () => expect(setup().dataset.questions[2]?.type).toBe("categorical"));
  it("deduplicates each respondent's variant and merges case/spacing, with answered denominator", () => {
    const { dataset, configuration } = setup({ types: { "2": "multiple" } });
    const summary = surveyDistribution(dataset.rows, dataset.questions[2]!, configuration);
    expect(summary.answered).toBe(3); expect(summary.missing).toBe(1);
    expect(summary.entries.map((item) => [item.key, item.count])).toEqual([["да", 3], ["нет", 2]]);
    expect(summary.entries[0]?.percentage).toBe(100);
    expect(summary.entries[1]?.percentage).toBeCloseTo(200 / 3, 12);
  });
  it("averages the two middle values for even-size median", () => {
    const { dataset, configuration } = setup();
    expect(surveyNumericSummary(dataset.rows.slice(0, 2), dataset.questions[1]!, configuration)).toMatchObject({ mean: 25, median: 25, count: 2 });
  });
  it("uses only valid numeric answers, reporting missing and invalid independently", () => {
    const { dataset, configuration } = setup();
    expect(surveyNumericSummary([...dataset.rows, { sourceRow: 7, values: ["C", "18-24"] }], dataset.questions[1]!, configuration)).toMatchObject({ count: 3, mean: 30, median: 30, invalid: 1, missing: 1 });
  });
  it("does not turn dates, bands, IDs or arbitrary digits into exact numbers", () => {
    ["2026-10-12", "18–24", "age 20", "1 000", "Infinity", ""].forEach((raw) => expect(surveyNumber(raw)).toBeUndefined());
    expect(surveyNumber("20,5")).toBe(20.5); expect(surveyNumber("-1.2e2")).toBe(-120);
  });
  it("keeps literal null, zero and negative answers unless explicitly marked missing", () => {
    ["null", "0", "нет", "undefined"].forEach((raw) => expect(surveyMissing(raw, config)).toBe(false));
    expect(surveyMissing(" NULL ", { ...config, missingValues: ["null"] })).toBe(true);
  });
  it("filters all conditions with AND and matches variants individually", () => {
    const { dataset, configuration } = setup({ types: { "2": "multiple" }, filters: [{ column: 0, value: "a" }, { column: 2, value: "нет" }] });
    expect(filterSurveyRows(dataset, configuration).map((row) => row.sourceRow)).toEqual([2]);
  });
  it("numeric ranges are inclusive, while text and missing filters are explicit", () => {
    const { dataset } = setup();
    expect(filterSurveyRows(dataset, { ...config, filters: [{ column: 1, operator: "range", value: "20", upper: "30" }] })).toHaveLength(2);
    expect(filterSurveyRows(dataset, { ...config, filters: [{ column: 1, operator: "empty", value: "" }] })).toHaveLength(1);
    expect(filterSurveyRows(dataset, { ...config, query: "нет" })).toHaveLength(2);
  });
  it("quality counts distinct flagged rows, not the sum of overlapping problems", () => {
    const wb: SurveyWorkbook = { warnings: [], sheets: [{ name: "x", rows: [["Q", "N"], ["", "bad"], ["", "bad"]] }] };
    const cfg = { ...config, types: { "1": "numeric" as const } };
    const dataset = buildSurveyDataset(wb, cfg);
    const quality = surveyQuality(dataset, cfg, dataset.rows);
    expect(quality.flaggedRows).toBe(2); expect(quality.repeatedRows).toEqual([3]);
  });
  it("duplicate signatures preserve empty column positions and separators", () => {
    const wb: SurveyWorkbook = { warnings: [], sheets: [{ name: "x", rows: [["Q", "R"], ["A", ""], ["", "A"], ["a|b", "c"], ["a", "b|c"]] }] };
    const dataset = buildSurveyDataset(wb, config);
    expect(surveyQuality(dataset, config, dataset.rows).repeatedRows).toEqual([]);
  });
  it("quality missing counts follow the filtered slice", () => {
    const { dataset, configuration } = setup({ filters: [{ column: 0, value: "a" }] });
    const quality = surveyQuality(dataset, configuration, filterSurveyRows(dataset, configuration));
    expect(quality.questions[1]?.missing).toBe(0);
  });
  it("counts delimiter-only multiple choice as unanswered", () => {
    const wb: SurveyWorkbook = { warnings: [], sheets: [{ name: "x", rows: [["Q"], [";;"]] }] };
    const cfg = { ...config, types: { "0": "multiple" as const } };
    const dataset = buildSurveyDataset(wb, cfg);
    expect(surveyDistribution(dataset.rows, dataset.questions[0]!, cfg).missing).toBe(1);
    expect(surveyQuality(dataset, cfg, dataset.rows).questions[0]?.missing).toBe(1);
  });
  it("does not infer extra questions from pre-header explanatory rows", () => {
    const wb: SurveyWorkbook = { warnings: [], sheets: [{ name: "x", rows: [["note", "note2"], ["Q"], ["A"]] }] };
    expect(buildSurveyDataset(wb, { ...config, headerRow: 1 }).questions).toHaveLength(1);
  });
  it("compares groups with per-question bases and identifies overlapping groups", () => {
    const { dataset, configuration } = setup({ types: { "2": "multiple" } });
    const comparison = surveyComparison(dataset.rows, dataset.questions[1]!, dataset.questions[2]!, configuration);
    expect(comparison.overlapping).toBe(true); expect(comparison.ungrouped).toBe(1);
    expect(comparison.groups.find((item) => item.label.toLowerCase() === "да")?.size).toBe(3);
  });
  it("handles empty slices without invented zeros for numeric statistics", () => {
    const { dataset, configuration } = setup();
    expect(surveyNumericSummary([], dataset.questions[1]!, configuration).mean).toBeUndefined();
    expect(surveyDistribution([], dataset.questions[0]!, configuration).entries).toEqual([]);
  });
  it("neutralizes spreadsheet formulas in headers and text while preserving valid negative numbers", () => {
    expect(surveyCsv([["=HYPERLINK(1)", "@SUM(1)", "-20", "x;\"y\"", " +cmd", "line\nbreak"]])).toBe('\uFEFF"\'=HYPERLINK(1)";"\'@SUM(1)";"-20";"x;""y""";"\' +cmd";"line\nbreak"');
  });
});
