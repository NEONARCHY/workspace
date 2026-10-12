export interface FilePreviewBlock {
  readonly kind: "paragraph" | "table";
  readonly text: string;
  readonly rows: readonly (readonly string[])[];
}
export interface OfficeFilePreview {
  readonly kind: "word" | "excel";
  readonly blocks: readonly FilePreviewBlock[];
  readonly sheets: readonly string[];
  readonly sheetIndex: number;
  readonly rowOffset: number;
  readonly totalRows: number;
  readonly rows: readonly (readonly string[])[];
  readonly truncated: boolean;
}
