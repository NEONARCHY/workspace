import type { ModuleCatalogResponse, ModuleDescriptor } from "@yuksalish/contracts";

export const fallbackModules: readonly ModuleDescriptor[] = [
  {
    key: "crm",
    label: { ru: "CRM", uz_cyrl: "CRM", uz_latn: "CRM" },
    route: "/crm",
    status: "placeholder",
  },
  {
    key: "tasks",
    label: { ru: "Задачи", uz_cyrl: "Вазифалар", uz_latn: "Vazifalar" },
    route: "/tasks",
    status: "available",
  },
  {
    key: "payment_requests",
    label: { ru: "Заявки на оплату", uz_cyrl: "Тўлов аризалари", uz_latn: "To‘lov arizalari" },
    route: "/payment-requests",
    status: "available",
  },
  {
    key: "feed",
    label: { ru: "Лента", uz_cyrl: "Лента", uz_latn: "Lenta" },
    route: "/feed",
    status: "available",
  },
  {
    key: "projects",
    label: { ru: "Список проектов", uz_cyrl: "Лойиҳалар рўйхати", uz_latn: "Loyihalar ro‘yxati" },
    route: "/projects",
    status: "available",
  },
  {
    key: "trip_approvals",
    label: { ru: "Согласование поездок", uz_cyrl: "Сафарни келишиш", uz_latn: "Safarni kelishish" },
    route: "/trip-approvals",
    status: "available",
  },
  {
    key: "messenger",
    label: { ru: "Мессенджер", uz_cyrl: "Мессенжер", uz_latn: "Messenjer" },
    route: "/messenger",
    status: "available",
  },
  {
    key: "calendar",
    label: { ru: "Календарь", uz_cyrl: "Тақвим", uz_latn: "Taqvim" },
    route: "/calendar",
    status: "available",
  },
  {
    key: "absences",
    label: { ru: "Отсутствия", uz_cyrl: "Йўқликлар", uz_latn: "Yo‘qliklar" },
    route: "/absences",
    status: "available",
  },
  {
    key: "members",
    label: { ru: "Работа с членами", uz_cyrl: "Аъзолар билан ишлаш", uz_latn: "A’zolar bilan ishlash" },
    route: "/members",
    status: "available",
  },
  {
    key: "employees",
    label: { ru: "Сотрудники", uz_cyrl: "Ходимлар", uz_latn: "Xodimlar" },
    route: "/employees",
    status: "available",
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
