export interface ProjectBudgetArticle {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly amount: string;
  readonly currency: "UZS" | "USD" | "EUR";
  readonly funding: "donor" | "own" | "unspecified";
  readonly actualAmount: string;
  readonly remainingAmount: string;
}
export interface ProjectBudgetArticleInput {
  readonly idempotencyKey?: string;
  readonly title: string;
  readonly amount: string;
  readonly currency: "UZS" | "USD" | "EUR";
  readonly funding: "donor" | "own" | "unspecified";
}
export interface ProjectBudgetSummary {
  readonly projectId: string;
  readonly articles: readonly ProjectBudgetArticle[];
  readonly actualByCurrency: readonly { readonly currency: string; readonly amount: string }[];
  readonly remainingProjectAmount: string;
}
