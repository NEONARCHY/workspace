import type { ModuleCatalogResponse, ModuleDescriptor } from "@yuksalish/contracts";

export const fallbackModules: readonly ModuleDescriptor[] = [
  {
    key: "messenger",
    label: { ru: "Сообщения", uz_cyrl: "Хабарлар", uz_latn: "Xabarlar" },
    route: "/messenger",
    status: "placeholder",
  },
  {
    key: "tasks",
    label: { ru: "Задачи", uz_cyrl: "Вазифалар", uz_latn: "Vazifalar" },
    route: "/tasks",
    status: "placeholder",
  },
  {
    key: "requests",
    label: { ru: "Заявки", uz_cyrl: "Аризалар", uz_latn: "Arizalar" },
    route: "/requests",
    status: "placeholder",
  },
  {
    key: "hisobot",
    label: { ru: "Отчёты", uz_cyrl: "Ҳисоботлар", uz_latn: "Hisobotlar" },
    route: "/hisobot",
    status: "placeholder",
  },
];

export async function loadModuleCatalog(
  baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8080",
): Promise<readonly ModuleDescriptor[]> {
  const response = await fetch(`${baseUrl}/api/v1/modules`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Module catalog failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as ModuleCatalogResponse;
  return payload.modules;
}
