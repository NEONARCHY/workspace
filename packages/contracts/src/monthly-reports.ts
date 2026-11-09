export interface MonthlyReportFile { readonly id: string; readonly name: string; readonly size: number }
export interface MonthlyReport {
  readonly id: string;
  readonly month: string;
  readonly userId: string;
  readonly revision: number;
  readonly comment: string;
  readonly submittedAt: string;
  readonly files: readonly MonthlyReportFile[];
}
export interface MonthlyMember {
  readonly userId: string;
  readonly name: string;
  readonly department: string;
  readonly report: MonthlyReport | null;
}
export interface MonthlyCycle {
  readonly month: string;
  readonly reminderOn: string;
  readonly total: number;
  readonly submitted: number;
  readonly authorizedAt: string | null;
  readonly authorizedByName: string | null;
  readonly comment: string;
  readonly members: readonly MonthlyMember[];
  readonly canSubmit: boolean;
}
export interface MonthlyOverview {
  readonly today: string;
  readonly activeMonth: string | null;
  readonly dashboardVisible: boolean;
  readonly canReview: boolean;
  readonly canAuthorize: boolean;
  readonly canConfigure: boolean;
  readonly reminderMonth: string | null;
  readonly payrollNotice: MonthlyCycle | null;
  readonly payrollNoticeId: string | null;
  readonly cycles: readonly MonthlyCycle[];
  readonly reports: readonly MonthlyReport[];
}
export interface MonthlyCalendarDay { readonly day: string; readonly working: boolean; readonly note: string }
