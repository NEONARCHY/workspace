export type ReferencePartnerKind = "partner" | "donor" | "government" | "contractor" | "other";
export type ReferenceTemplateKind = "project" | "grant" | "budget" | "letter" | "other";
export type ReferenceLocale = "ru" | "uz_cyrl" | "uz_latn";

export interface ReferenceProfileFields {
  readonly legalName: string;
  readonly shortName: string;
  readonly tin: string;
  readonly registeredAddress: string;
  readonly postalAddress: string;
  readonly bankName: string;
  readonly bankCode: string;
  readonly bankAccount: string;
  readonly phone: string;
  readonly email: string;
  readonly website: string;
}
export interface ReferenceProfile extends ReferenceProfileFields {
  readonly revision: number;
  readonly updatedAt: string | null;
}
export interface ReferencePartnerFields {
  readonly name: string;
  readonly kind: ReferencePartnerKind;
  readonly tin: string;
  readonly address: string;
  readonly contactPerson: string;
  readonly phone: string;
  readonly email: string;
  readonly website: string;
  readonly notes: string;
}
export interface ReferencePartner extends ReferencePartnerFields {
  readonly id: string;
  readonly archived: boolean;
  readonly revision: number;
  readonly updatedAt: string;
}
export interface ReferenceExpertFields {
  readonly name: string;
  readonly specialization: string;
  readonly partnerId: string | null;
  readonly phone: string;
  readonly email: string;
  readonly notes: string;
}
export interface ReferenceExpert extends ReferenceExpertFields {
  readonly id: string;
  readonly archived: boolean;
  readonly revision: number;
  readonly updatedAt: string;
}
export interface ReferenceTemplateFields {
  readonly title: string;
  readonly kind: ReferenceTemplateKind;
  readonly locale: ReferenceLocale;
  readonly description: string;
}
export interface ReferenceTemplateVersion {
  readonly id: string;
  readonly version: number;
  readonly fileName: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly createdAt: string;
}
export interface ReferenceTemplate extends ReferenceTemplateFields {
  readonly id: string;
  readonly archived: boolean;
  readonly revision: number;
  readonly updatedAt: string;
  readonly versions: readonly ReferenceTemplateVersion[];
}
export interface ReferenceDirectory {
  readonly profile: ReferenceProfile;
  readonly partners: readonly ReferencePartner[];
  readonly experts: readonly ReferenceExpert[];
  readonly templates: readonly ReferenceTemplate[];
  readonly changes: readonly {
    readonly actorUserId: string;
    readonly action: string;
    readonly targetType: string;
    readonly targetId: string;
    readonly createdAt: string;
    readonly details: Readonly<Record<string, unknown>>;
  }[];
}
