// Visual regression for WS2-5. All records are intercepted; the live server is never mutated.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const people = [
  { id: "owner", username: "owner", name: "Малика Нурова", initials: "МН", role: "superadmin", jobTitle: "Председатель", color: "#0091a8" },
  { id: "manager", username: "manager", name: "Бахтиёр Самугов", initials: "БС", role: "manager", jobTitle: "Руководитель проекта", color: "#476c91" },
  { id: "employee", username: "employee", name: "Азиза Каримова", initials: "АК", role: "employee", jobTitle: "Финансовый специалист", color: "#6a8e78" },
];
const projects = [
  { id: "p1", code: "REG-26", title: "Региональная программа", description: "Подготовка и запуск региональных инициатив.", managerUserId: "manager", startDate: "2026-09-01", endDate: "2026-09-25", budget: 125000000, spentBudget: 48000000, remainingBudget: 77000000, currency: "UZS", status: "in_progress", stage: "preparation", createdByUserId: "owner", createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-15T08:00:00Z", canEdit: true, canMove: true, history: [{ id: "ph1", actorUserId: "owner", fromStage: "start", toStage: "preparation", action: "moved", createdAt: "2026-09-10T08:00:00Z" }] },
  { id: "p2", code: "EDU-26", title: "Образовательная платформа", description: "Единая среда материалов и обучения.", managerUserId: "owner", startDate: "2026-08-10", endDate: "2026-10-30", budget: 82000, spentBudget: 21000, remainingBudget: 61000, currency: "USD", status: "in_progress", stage: "approval", createdByUserId: "owner", createdAt: "2026-08-01T08:00:00Z", updatedAt: "2026-09-14T08:00:00Z", canEdit: true, canMove: true, history: [] },
  { id: "p3", code: "ARCH-25", title: "Архивный проект", description: "Завершённая инициатива.", managerUserId: "employee", startDate: "2025-01-10", endDate: "2025-12-20", budget: 50000000, spentBudget: 47000000, remainingBudget: 3000000, currency: "UZS", status: "completed", stage: "success", createdByUserId: "owner", createdAt: "2025-01-01T08:00:00Z", updatedAt: "2025-12-20T08:00:00Z", canEdit: false, canMove: false, history: [] },
];
const baseTrip = { requesterUserId: "owner", purpose: "Встреча с региональной командой", destination: "Самарканд", startDate: "2026-09-18", endDate: "2026-09-20", employeeIds: ["owner", "employee"], status: "running", statusLabel: "На согласовании", canEdit: false, actions: [], createdAt: "2026-09-10T08:00:00Z", updatedAt: "2026-09-15T08:00:00Z" };
const tripRequests = [
  { ...baseTrip, id: "t1", number: "TR-148", stage: "manager_approval", stageLabel: "Утверждение руководителем", allowedActions: ["approve", "return", "reject"] },
  { ...baseTrip, id: "t2", number: "TR-149", purpose: "Рабочая сессия с партнёрами", destination: "Бухара", startDate: "2026-09-24", endDate: "2026-09-26", employeeIds: ["manager"], stage: "hr", stageLabel: "Кадровая служба", allowedActions: ["approve", "return", "reject"] },
  { ...baseTrip, id: "t3", number: "TR-147", purpose: "Уточнение программы визита", destination: "Ташкент", status: "needs_revision", statusLabel: "На доработке", canEdit: true, stage: "launch", stageLabel: "Запуск", allowedActions: ["resubmit"] },
];

async function main() {
  const origin = process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173";
  const output = path.resolve("tmp/workspace-2-projects-trips");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const violations = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.text().includes("WebSocket connection")) errors.push(message.text()); });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204, body: "" }));
  await page.route("**/api/v1/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/auth/web/login")) return route.fulfill({ json: { accessToken: "visual-token", tokenType: "bearer", expiresIn: 900, user: people[0] } });
    if (url.endsWith("/workspace/bootstrap")) return route.fulfill({ json: { currentUser: people[0], canCreatePaymentRequests: true, people, positions: [], chats: [], messages: [], tasks: [], requests: [], projects, tripRequests, feedPosts: [], calendarEvents: [], notifications: [], attachments: [], workflow: null, requestWorkflows: [], notificationPreferences: { desktopEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, remindersEnabled: true } } });
    if (url.endsWith("/directory")) return route.fulfill({ json: { people, departments: [], positions: [] } });
    return route.fulfill({ status: 204, body: "" });
  });
  const settle = async () => page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => {
      const timing = animation.effect?.getComputedTiming();
      return timing && timing.iterations !== Infinity && Number(timing.endTime) < 2000;
    }).map(animation => animation.finished.catch(() => undefined)));
  });
  const audit = async label => {
    const result = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, failure: node.failureSummary })) })));
    if (result.length) violations.push({ label, result });
  };
  try {
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    for (const [width, height, suffix, zoom] of [[1440, 900, "1440", 1], [1024, 768, "1024", 1], [800, 640, "800", 1], [1440, 900, "zoom-200", 2]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
      await page.locator('.rail-action[aria-label="Список проектов"]').click();
      await page.locator(".project-board").waitFor();
      await settle();
      await page.screenshot({ path: path.join(output, `projects-${suffix}.png`) });
      await audit(`projects-${suffix}`);
      assert.equal(await page.locator(".project-card").count(), 2);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      await page.locator('.rail-action[aria-label="Согласование поездок"]').click();
      await page.locator(".trip-kanban").waitFor();
      await settle();
      await page.screenshot({ path: path.join(output, `trips-${suffix}.png`) });
      await audit(`trips-${suffix}`);
      assert.equal(await page.locator(".trip-board-card").count(), 3);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    }
    await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.rail-action[aria-label="Список проектов"]').click();
    await page.locator('[data-spatial-card="p1"] .spatial-card-open').click();
    await page.getByRole("dialog", { name: "Региональная программа" }).waitFor();
    await settle();
    await page.screenshot({ path: path.join(output, "project-detail.png") });
    await audit("project-detail");
    await page.getByRole("button", { name: "Закрыть карточку проекта" }).click();
    await page.locator('.rail-action[aria-label="Согласование поездок"]').click();
    await page.getByRole("button", { name: /Открыть поездку TR-148/ }).click();
    await page.getByRole("dialog").waitFor();
    await settle();
    await page.screenshot({ path: path.join(output, "trip-detail.png") });
    await audit("trip-detail");
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ projects: projects.length, trips: tripRequests.length, errors, violations }, null, 2));
    console.log(`PASS: WS2-5 project/trip screenshots and axe audit saved to ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
