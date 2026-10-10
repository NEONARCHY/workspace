/** Template v1. Money remains decimal text until explicitly reviewed. */
export interface ProjectImportSource {
  readonly documentId: string;
  readonly locator: string;
  readonly excerpt: string;
}
export interface ProjectImportDocument {
  readonly id: string;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly mimeType: string;
}
export interface ProjectImportPassport {
  readonly title: string;
  readonly code: string;
  readonly description: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly budget: string;
  readonly currency: "UZS" | "USD" | "EUR";
  readonly donor: string;
  readonly partners: string;
  readonly scope: "yuksalish" | "consortium";
  readonly sources: readonly ProjectImportSource[];
}
export interface ProjectImportItem {
  readonly title: string;
  readonly kind: "task" | "event";
  readonly description: string;
  readonly period: string;
  readonly startsAt: string | null;
  readonly dueAt: string | null;
  readonly budget: string;
  readonly budgetCurrency?: "UZS" | "USD" | "EUR" | null;
  readonly include: boolean;
  readonly assigneeUserIds: readonly string[];
  readonly sources: readonly ProjectImportSource[];
}
export interface ProjectImportDirection {
  readonly title: string;
  readonly description: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly items: readonly ProjectImportItem[];
  readonly sources: readonly ProjectImportSource[];
}
export interface ProjectImportBudgetLine {
  readonly title: string;
  readonly amount: string;
  readonly currency: "UZS" | "USD" | "EUR";
  readonly funding: "donor" | "own" | "unspecified";
  readonly sources: readonly ProjectImportSource[];
}
export interface ProjectImportContent {
  readonly templateVersion: 1;
  readonly project: ProjectImportPassport;
  readonly directions: readonly ProjectImportDirection[];
  readonly budgetLines: readonly ProjectImportBudgetLine[];
  readonly issues: readonly {
    readonly message: string;
    readonly sources: readonly ProjectImportSource[];
    readonly resolution: string;
  }[];
}
export interface ProjectDocumentImport {
  readonly id: string;
  readonly state: "draft" | "queued" | "processing" | "ready" | "failed" | "published";
  readonly revision: number;
  readonly documents: readonly ProjectImportDocument[];
  readonly content: ProjectImportContent;
  readonly error: string | null;
  readonly projectId: string | null;
  readonly publication?: ProjectImportPublication | null;
  readonly updatedAt: string;
}
export interface ProjectImportPublication {
  readonly expectedRevision: number;
  readonly managerUserId: string;
  readonly responsibleUserIds: readonly string[];
  readonly accessStatus: "open" | "closed";
  readonly reviewed: true;
}
