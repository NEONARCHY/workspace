export interface HiringFields {
  readonly fullName: string;
  readonly jobTitle: string;
  readonly department: string;
  readonly startDate: string;
  readonly contractNumber: string;
  readonly orderNumber: string;
  readonly documentDate: string;
  readonly workType: "primary" | "secondary";
  readonly term: "indefinite" | "fixed";
  readonly endDate: string | null;
  readonly fixedTermReason: string;
  readonly probationMonths: number;
  readonly probationEligible: boolean;
  readonly workRegime: string;
  readonly daysPerWeek: number;
  readonly hoursPerWeek: number;
  readonly annualLeave: number;
  readonly additionalLeave: number;
  readonly salaryTerms: string;
  readonly accountantDative: string;
  readonly allowances: string;
  readonly passport: string;
  readonly pinfl: string;
  readonly address: string;
  readonly phone: string;
  readonly additionalTerms: string;
}
export interface HiringSignatureBox {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface HiringSummary {
  readonly id: string;
  readonly fullName: string;
  readonly jobTitle: string;
  readonly status: "draft" | "pending" | "returned" | "awaiting_employee" | "completed";
  readonly revision: number;
  readonly updatedAt: string;
  readonly canEdit: boolean;
  readonly canSign: boolean;
}
export interface HiringDetail extends HiringSummary {
  readonly fields: HiringFields;
  readonly applicationBox: HiringSignatureBox;
  readonly hasApplication: boolean;
  readonly applicationPages: number;
  readonly hasEmployeeScan: boolean;
  readonly returnComment: string;
  readonly signerName: string;
  readonly approvedAt: string | null;
  readonly documentHashes: Readonly<Record<string, string>>;
}
export interface HiringRegistry {
  readonly items: readonly HiringSummary[];
  readonly total: number;
  readonly canCreate: boolean;
  readonly canConfigureSignature: boolean;
  readonly signatureReady: boolean;
  readonly signerName: string;
}
export type HiringActionName = "submit" | "approve" | "return" | "complete";
export interface HiringActionRequest {
  readonly expectedRevision: number;
  readonly action: HiringActionName;
  readonly requestId: string;
  readonly comment: string;
  readonly employeeSignatureConfirmed: boolean;
}
export interface IdentityRecognition {
  readonly fullName: string | null;
  readonly pinfl: string | null;
  readonly passport: string | null;
  readonly nameComplete?: boolean;
  readonly warnings: readonly string[];
}
export type HiringDocumentKind = "contract" | "order" | "application" | "application-placement" | "employee-scan" | "packet";
