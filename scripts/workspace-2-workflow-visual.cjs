// Visual regression for WS2-4. All business data stays in memory; no server is mutated.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const people = [
  { id: "owner", username: "owner", name: "Малика Нурова", initials: "МН", role: "superadmin", positionId: "chair", jobTitle: "Председатель", color: "#0091a8" },
  { id: "finance", username: "finance", name: "Азиза Каримова", initials: "АК", role: "manager", positionId: "finance-manager", jobTitle: "Финансовый менеджер", color: "#476c91" },
  { id: "director", username: "director", name: "Дилшод Рахимов", initials: "ДР", role: "manager", positionId: "director", jobTitle: "Директор", color: "#7a638e" },
];

const workflow = {
  id: "payment-route",
  name: "Оплата и контроль бюджета",
  version: 7,
  status: "draft",
  publishedVersion: 6,
  formSchema: {},
  nodes: [
    { id: "start", kind: "start", label: "Новая заявка", detail: "Проверены обязательные поля", positionX: 0, positionY: 115, config: {} },
    { id: "manager", kind: "approval", label: "Руководитель отдела", detail: "Первичное подтверждение", positionX: 245, positionY: 115, config: { approverRole: "manager" } },
    { id: "parallel", kind: "parallel", label: "Параллельная проверка", detail: "Бюджет и реквизиты", positionX: 490, positionY: 115, config: { decisionMode: "all" } },
    { id: "finance", kind: "approval", label: "Финансовый менеджер", detail: "Проверяет лимиты", positionX: 735, positionY: 30, config: { approverUserId: "finance" } },
    { id: "director", kind: "approval", label: "Директор", detail: "Подтверждает назначение", positionX: 735, positionY: 205, config: { approverUserId: "director" } },
    { id: "approved", kind: "end", label: "Оплата согласована", detail: "Финальное состояние", positionX: 1000, positionY: 115, config: {} },
    { id: "correction", kind: "correction", label: "Доработка", detail: "Нужен комментарий", positionX: 490, positionY: 345, config: {} },
  ],
  edges: [
    { id: "e1", source: "start", target: "manager", outcome: "submit", condition: {}, sortOrder: 0 },
    { id: "e2", source: "manager", target: "parallel", outcome: "approve", condition: {}, sortOrder: 0 },
    { id: "e3", source: "parallel", target: "finance", outcome: "branch", condition: {}, sortOrder: 0 },
    { id: "e4", source: "parallel", target: "director", outcome: "branch", condition: {}, sortOrder: 1 },
    { id: "e5", source: "finance", target: "approved", outcome: "approve", condition: {}, sortOrder: 0 },
    { id: "e6", source: "director", target: "approved", outcome: "approve", condition: {}, sortOrder: 0 },
    { id: "e7", source: "manager", target: "correction", outcome: "return", label: "Вернуть", condition: {}, sortOrder: 0 },
    { id: "e8", source: "correction", target: "start", outcome: "resubmit", condition: {}, sortOrder: 0 },
  ],
};

const request = {
  id: "payment-148",
  workflowId: "payment-route",
  number: "148",
  title: "Аванс на региональное мероприятие",
  amount: 84600000,
  currency: "UZS",
  status: "running",
  statusLabel: "На согласовании",
  activeNodeKeys: ["finance", "director"],
  activeStages: [
    { key: "finance", label: "Финансовый менеджер", kind: "approval", canAct: true },
    { key: "director", label: "Директор", kind: "approval", canAct: false },
  ],
  stageLabel: "Параллельная проверка",
  requesterId: "owner",
  responsibleUserId: "owner",
  purpose: "Организация регионального мероприятия",
  details: { projectName: "Регионы", projectCode: "REG-26", sourceAccount: "Основной счёт", destinationAccount: "Подрядчик", requestPriority: "normal", deadline: "2026-09-20T12:00:00Z", comment: "", tripPurpose: "", tripStartDate: null, tripEndDate: null, employeeIds: [], paymentPurpose: "Мероприятия", paymentReason: "Утверждённая смета", responsibleUserId: "owner" },
  createdAt: "2026-09-15T08:00:00Z",
  updatedAt: "2026-09-15T10:00:00Z",
  revision: 1,
  versions: [],
  actions: [{ action: "approve", actorUserId: "owner", nodeKey: "manager", createdAt: "2026-09-15T09:00:00Z" }],
};

async function main() {
  const origin = process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173";
  const output = path.resolve("tmp/workspace-2-workflow-visual");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const source = message.location().url;
      errors.push(source ? `${message.text()} (${source})` : message.text());
    }
  });
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/v1/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/auth/web/login")) {
      await route.fulfill({ json: { accessToken: "visual-token", tokenType: "bearer", expiresIn: 900, user: people[0] } });
      return;
    }
    if (url.endsWith("/workspace/bootstrap")) {
      await route.fulfill({ json: {
        currentUser: people[0], canCreatePaymentRequests: true, people,
        positions: [{ id: "chair", name: "Председатель" }, { id: "finance-manager", name: "Финансовый менеджер" }, { id: "director", name: "Директор" }],
        chats: [], messages: [], tasks: [], requests: [request], projects: [], tripRequests: [],
        feedPosts: [], calendarEvents: [], notifications: [], attachments: [], workflow,
        requestWorkflows: [workflow],
        notificationPreferences: { desktopEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, remindersEnabled: true },
      } });
      return;
    }
    if (url.endsWith("/directory")) {
      await route.fulfill({ json: { people, departments: [], positions: [] } });
      return;
    }
    await route.fulfill({ status: 204, body: "" });
  });
  try {
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="Заявки на оплату"]').click();
    await page.getByRole("button", { name: /Открыть заявку №148/ }).click();
    await page.getByLabel("Живой маршрут заявки").waitFor();
    assert.equal(await page.locator(".approval-journey .journey-current").count(), 2);
    await page.screenshot({ path: path.join(output, "request-journey-1440.png") });
    await page.getByRole("button", { name: "Закрыть карточку заявки" }).click();
    await page.getByRole("button", { name: "Конструктор маршрутов", exact: true }).click();
    await page.getByText("Карта процесса", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "route-editor-1440.png") });
    await page.setViewportSize({ width: 900, height: 720 });
    await page.screenshot({ path: path.join(output, "route-editor-900.png") });
    await page.locator('.react-flow__node[data-id="manager"]').click();
    await page.getByLabel("Настройки выбранного блока").getByLabel("Название").waitFor();
    await page.screenshot({ path: path.join(output, "route-editor-selected-900.png") });
    const unexpectedErrors = errors.filter((message) => !message.includes("WebSocket connection"));
    assert.deepEqual(unexpectedErrors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ currentBranches: 2, errors: unexpectedErrors }, null, 2));
    console.log(`PASS: WS2-4 journey and editor screenshots saved to ${output}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
    console.error(await page.locator("body").innerText().catch(() => "No body"));
    console.error(errors);
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
