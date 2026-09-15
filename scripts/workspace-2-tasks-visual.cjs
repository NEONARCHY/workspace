// Visual regression for WS2-6. API data is intercepted; the live LAN server is never mutated.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const people = [
  { id: "aziza", username: "aziza", name: "Азиза Каримова", initials: "АК", role: "manager", jobTitle: "Главный бухгалтер", color: "#0091a8" },
  { id: "baxtiyor", username: "baxtiyor", name: "Бахтиёр Самугов", initials: "БС", role: "manager", jobTitle: "Руководитель подразделения", color: "#476c91" },
  { id: "dilshod", username: "dilshod", name: "Дилшод Рахимов", initials: "ДР", role: "employee", jobTitle: "Заместитель председателя", color: "#6a8e78" },
];
const base = { authorId: "aziza", assigneeId: "baxtiyor", priority: "normal", checklistDone: 0, checklistTotal: 0, participants: [], checklist: [], comments: [], dependencies: [] };
const tasks = [
  { ...base, id: "t1", title: "Согласовать график поставки мебели", description: "Проверить даты и подтвердить график с командой проекта.", project: "Новый офис", status: "new", dueLabel: "18 сентября", dueAt: "2026-09-18T12:00:00Z", chatId: "task-t1" },
  { ...base, id: "t2", title: "Подготовить договор на поставку ноутбуков", description: "Собрать финальную редакцию договора и приложения.", project: "Новый офис", status: "in_progress", priority: "high", assigneeId: "dilshod", dueLabel: "Сегодня, 17:00", dueAt: "2026-09-15T12:00:00Z", checklistDone: 2, checklistTotal: 4, checklist: [{ id: "c1", title: "Проверить реквизиты", isCompleted: true }, { id: "c2", title: "Сверить спецификацию", isCompleted: true }, { id: "c3", title: "Получить визу", isCompleted: false }, { id: "c4", title: "Передать поставщику", isCompleted: false }], comments: [{ id: "m1", authorUserId: "dilshod", body: "Реквизиты проверены, готовлю приложения.", createdAt: "2026-09-15T08:00:00Z" }] },
  { ...base, id: "t3", title: "Сверить лимиты бюджета на сентябрь", description: "Передан итоговый расчёт лимитов по подразделениям.", project: "Финансы", status: "awaiting_review", assigneeId: "aziza", dueLabel: "Завтра, 12:00", dueAt: "2026-09-16T07:00:00Z", resultText: "Лимиты сверены, расхождений нет." },
  { ...base, id: "t4", title: "Обновить список материально ответственных", description: "Учесть последние кадровые изменения.", project: "Администрация", status: "overdue", priority: "urgent", dueLabel: "Просрочено на 2 дня", dueAt: "2026-09-13T12:00:00Z", checklistDone: 1, checklistTotal: 3 },
  { ...base, id: "t5", title: "Сформировать итоговый протокол", description: "Работа завершена и принята.", project: "Региональная программа", status: "completed", dueLabel: "12 сентября", dueAt: "2026-09-12T12:00:00Z", checklistDone: 3, checklistTotal: 3 },
];

async function main() {
  const origin = process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173";
  const output = path.resolve("tmp/workspace-2-tasks");
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
    if (url.endsWith("/workspace/bootstrap")) return route.fulfill({ json: { currentUser: people[0], canCreatePaymentRequests: true, people, positions: [], chats: tasks.map(task => ({ id: task.chatId, title: task.title, kind: "task", preview: "", time: "Сегодня", unread: 0, description: "", permissions: { sendMessages: true, uploadFiles: true, inviteMembers: false, manageMembers: false, editInfo: false }, members: [] })), messages: [], tasks, requests: [], projects: [], tripRequests: [], feedPosts: [], calendarEvents: [], notifications: [], attachments: [], workflow: null, requestWorkflows: [], notificationPreferences: { desktopEnabled: false, messagesEnabled: true, tasksEnabled: true, approvalsEnabled: true, tripsEnabled: true, calendarEnabled: true, remindersEnabled: true } } });
    if (url.endsWith("/directory")) return route.fulfill({ json: { people, departments: [], positions: [] } });
    return route.fulfill({ status: 204, body: "" });
  });
  const settle = async () => page.evaluate(async () => {
    await document.fonts.ready;
    const animations = Promise.all(document.getAnimations().filter(animation => {
      const timing = animation.effect?.getComputedTiming();
      return timing && timing.iterations !== Infinity && Number(timing.endTime) < 2000;
    }).map(animation => animation.finished.catch(() => undefined)));
    await Promise.race([animations, new Promise(resolve => setTimeout(resolve, 1200))]);
  });
  const audit = async (label, selector) => {
    const result = await page.evaluate(async scope => (await axe.run(scope ? document.querySelector(scope) : document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, failure: node.failureSummary })) })), selector);
    if (result.length) violations.push({ label, result });
  };
  try {
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    await page.locator('.rail-action[aria-label="Задачи"]').click();
    for (const [width, height, suffix, zoom] of [[1440, 900, "1440", 1], [1024, 768, "1024", 1], [800, 640, "800", 1], [1440, 900, "zoom-200", 2]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
      await page.getByRole("button", { name: "Список", exact: true }).click();
      await settle();
      await page.screenshot({ path: path.join(output, `list-${suffix}.png`) });
      if (suffix === "1440") await audit(`list-${suffix}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
      await page.getByRole("button", { name: "Kanban" }).click();
      await settle();
      await page.screenshot({ path: path.join(output, `kanban-${suffix}.png`) });
      if (suffix === "1440") await audit(`kanban-${suffix}`);
      assert.equal(await page.locator(".kanban-card").count(), 4);
    }
    await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Список", exact: true }).click();
    await page.getByRole("button", { name: /Открыть задачу: Подготовить договор/ }).click();
    await page.getByRole("dialog", { name: /Подготовить договор/ }).waitFor();
    await settle();
    await page.screenshot({ path: path.join(output, "detail.png") });
    console.log("WS2-6 visual: detail captured");
    await page.locator(".task-record-dialog .compact-back").click({ force: true });
    await page.waitForTimeout(350);
    console.log("WS2-6 visual: detail closed");
    await page.getByRole("button", { name: "Новая задача", exact: true }).click();
    await page.getByRole("dialog", { name: "Новая задача" }).waitFor();
    console.log("WS2-6 visual: composer opened");
    await settle();
    await page.screenshot({ path: path.join(output, "composer.png") });
    assert.deepEqual(violations, []);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ errors, violations }, null, 2));
    console.log(`PASS: WS2-6 task screenshots and axe audit saved to ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
