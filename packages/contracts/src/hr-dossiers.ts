export interface DossierEducation {
  readonly institution: string;
  readonly startYear: number | null;
  readonly graduationYear: number | null;
  readonly specialty: string;
  readonly qualification: string;
}
export interface DossierRelative {
  readonly relationship: string;
  readonly fullName: string;
  readonly birthYear: number | null;
  readonly birthPlace: string;
  readonly workplacePosition: string;
  readonly address: string;
}
export interface DossierEmployment {
  readonly organization: string;
  readonly position: string;
  readonly startDate: string | null;
  readonly period: string;
  readonly endDate: string | null;
}
export interface DossierImportPreview {
  readonly sourceFullName: string;
  readonly sourceJobTitle: string;
  readonly fields: DossierFields;
  readonly detectedFields: readonly (keyof DossierFields)[];
  readonly warnings: readonly string[];
  readonly unrecognizedText: string;
}
export interface DossierFields {
  readonly birthDate: string | null;
  readonly birthPlace: string;
  readonly appointmentDate: string | null;
  readonly nationality: string;
  readonly partyMembership: string;
  readonly educationLevel: string;
  readonly education: readonly DossierEducation[];
  readonly employment: readonly DossierEmployment[];
  readonly languages: string;
  readonly academicDegree: string;
  readonly academicTitle: string;
  readonly militaryRank: string;
  readonly electedMembership: string;
  readonly awards: string;
  readonly relatives: readonly DossierRelative[];
  readonly additionalInfo: string;
}
export interface DossierPermissions { readonly canView: boolean; readonly canEdit: boolean; }
export interface DossierDetail {
  readonly userId: string;
  readonly fullName: string;
  readonly jobTitle: string | null;
  readonly revision: number;
  readonly status: "empty" | "draft" | "saved";
  readonly fields: DossierFields;
  readonly updatedAt: string | null;
  readonly permissions: DossierPermissions;
}
export interface DossierSummary {
  readonly userId: string;
  readonly fullName: string;
  readonly jobTitle: string | null;
  readonly departmentId: string | null;
  readonly status: DossierDetail["status"];
  readonly updatedAt: string | null;
}
export interface DossierHistory {
  readonly revision: number;
  readonly actorName: string;
  readonly changedFields: readonly string[];
  readonly createdAt: string;
}
export interface PersonnelPhotoCard {
  readonly userId: string;
  readonly fullName: string;
  readonly jobTitle: string | null;
  readonly departmentId: string | null;
  readonly birthYear: number | null;
  readonly universities: readonly string[];
}
export interface DossierContext {
  readonly canManageAccess: boolean;
  readonly canViewPhotoRoster: boolean;
}
export interface DossierAccessRule {
  readonly granteeUserId: string;
  readonly scope: "all" | "department" | "employee";
  readonly scopeId: string | null;
  readonly view: boolean;
  readonly edit: boolean;
  readonly photoRoster: boolean;
}
export interface DossierAccessSettings {
  readonly revision: number;
  readonly rules: readonly DossierAccessRule[];
}

export interface DossierReminder {
  readonly period: string;
  readonly dueDate: string;
  readonly due: boolean;
  readonly status: "pending" | "update_requested" | "no_changes" | "skipped" | "updated";
  readonly respondedAt: string | null;
}
export interface DossierReminderAnswer {
  readonly period: string;
  readonly action: "update_requested" | "no_changes" | "skipped";
}
