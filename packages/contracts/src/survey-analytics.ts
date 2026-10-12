export type SurveyQuestionType = "categorical" | "multiple" | "numeric" | "text" | "excluded";
export interface SurveySheet {
  readonly name: string;
  /** Source row numbers are one-based; blank rows remain in this matrix. */
  readonly rows: readonly (readonly string[])[];
}
export interface SurveyWorkbook {
  readonly sheets: readonly SurveySheet[];
  readonly warnings: readonly string[];
}
export interface SurveyFilter {
  readonly column: number;
  readonly value: string;
  readonly operator?: "equals" | "contains" | "range" | "empty" | "filled";
  readonly upper?: string;
}
export interface SurveySavedView {
  readonly name: string;
  readonly query: string;
  readonly filters: readonly SurveyFilter[];
}
export interface SurveyConfiguration {
  readonly sheet: number;
  readonly headerRow: number;
  readonly types: Readonly<Record<string, SurveyQuestionType>>;
  readonly separator: ";" | "|" | ",";
  readonly missingValues: readonly string[];
  readonly query: string;
  readonly filters: readonly SurveyFilter[];
  readonly savedViews: readonly SurveySavedView[];
}
export interface SurveyAnalysis {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly revision: number;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly configuration: SurveyConfiguration;
}
export interface SurveyAnalysisDetail {
  readonly analysis: SurveyAnalysis;
  readonly workbook: SurveyWorkbook;
}
export interface SurveyAnalysisUpdate {
  readonly expectedRevision: number;
  readonly title: string;
  readonly archived: boolean;
  readonly configuration: SurveyConfiguration;
}
export interface SurveyExport {
  readonly configuration: SurveyConfiguration;
  readonly rowNumbers: readonly number[];
}
