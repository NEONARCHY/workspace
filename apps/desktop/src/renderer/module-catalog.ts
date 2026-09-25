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
    key: "team_overview",
    label: { ru: "Обзор команды", uz_cyrl: "Жамоа шарҳи", uz_latn: "Jamoa sharhi" },
    route: "/team-overview",
    status: "available",
  },
  {
    key: "payment_requests",
    label: { ru: "Заявки на оплату", uz_cyrl: "Тўлов аризалари", uz_latn: "To‘lov arizalari" },
    route: "/payment-requests",
    status: "available",
  },
  {
    key: "ai_referent",
    label: { ru: "AI Referent", uz_cyrl: "AI Referent", uz_latn: "AI Referent" },
    route: "/ai-referent",
    status: "available",
  },
  {
    key: "telegram_access",
    label: { ru: "Доступ к Telegram-ботам", uz_cyrl: "Telegram ботларига рухсат", uz_latn: "Telegram botlariga ruxsat" },
    route: "/telegram-access",
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
    key: "project_hub",
    label: { ru: "Проекты", uz_cyrl: "Лойиҳалар", uz_latn: "Loyihalar" },
    route: "/project-hub",
    status: "available",
  },
  {
    key: "project_funding",
    label: { ru: "Проектные заявки", uz_cyrl: "Лойиҳа аризалари", uz_latn: "Loyiha arizalari" },
    route: "/project-funding",
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
    key: "zoom_meetings",
    label: { ru: "Zoom-конференции", uz_cyrl: "Zoom конференциялар", uz_latn: "Zoom konferensiyalar" },
    route: "/zoom-meetings",
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
    key: "hr",
    label: { ru: "HR", uz_cyrl: "Кадрлар", uz_latn: "Kadrlar" },
    route: "/hr",
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
