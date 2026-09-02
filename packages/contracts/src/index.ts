export const moduleKeys = ["messenger", "tasks", "requests", "hisobot"] as const;

export type ModuleKey = (typeof moduleKeys)[number];
export type ModuleStatus = "placeholder" | "available";

export interface LocalizedLabel {
  readonly ru: string;
  readonly uz_cyrl: string;
  readonly uz_latn: string;
}

export interface ModuleDescriptor {
  readonly key: ModuleKey;
  readonly label: LocalizedLabel;
  readonly route: `/${string}`;
  readonly status: ModuleStatus;
}

export interface ModuleCatalogResponse {
  readonly modules: readonly ModuleDescriptor[];
}
