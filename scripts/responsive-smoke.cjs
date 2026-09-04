// Local demo only. Existing records are read; forms are exercised without submitting.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const output = path.resolve(process.env.STRESS_TEXT ? "tmp/responsive-smoke-stress" : "tmp/responsive-smoke");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (process.env.STRESS_TEXT) {
    // Rewrite only this test browser's responses; never persist synthetic text.
    await page.route("**/api/v1/workspace/bootstrap", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const long = "Длинное название для проверки переноса ".repeat(12) + "X".repeat(180);
      for (const key of ["chats", "tasks", "requests", "projects", "feedPosts"]) if (data[key]?.[0]) data[key][0].title = long;
      if (data.messages?.[0]) data.messages[0].body = long;
      if (data.currentUser) data.currentUser.name = "ТестовыйСотрудник".repeat(12);
      await route.fulfill({ response, json: data });
    });
  }
  const errors = [];
  const checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const stable = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const inspect = async (label) => {
    await stable();
    const issues = await page.evaluate(() => {
      const problems = [];
      const selectors = ".app-shell,.app-stage,.global-bar,.app-content,.workspace-view,.section-toolbar,.bp7-header,.notification-header,.calendar-main,.employee-detail,.task-detail,.bp7-modal,.approval-create-panel,.approval-detail-panel,.chat-settings-dialog,.account-panel,.composer";
      for (const el of document.querySelectorAll(selectors)) {
        if (!el.getClientRects().length) continue;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (el.scrollWidth > el.clientWidth + 3 && !["auto", "scroll"].includes(style.overflowX)) problems.push(`${el.className}: horizontal ${el.scrollWidth}/${el.clientWidth}`);
        if (rect.right > innerWidth + 3 || rect.left < -3) problems.push(`${el.className}: outside window`);
      }
      return problems;
    });
    checks.push({ label, issues });
    if (issues.length) console.log("LAYOUT", label, issues);
    assert.equal(await page.getByText("Не удалось показать экран", { exact: true }).count(), 0, label);
  };
  const open = async (label) => {
    await page.locator(`.rail-action[aria-label="${label}"]`).click();
    if (label === "Сотрудники") await page.locator(".directory-layout").waitFor();
    await stable();
  };
  try {
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    for (const [width, height] of [[1440,900], [1180,800], [960,640], [800,600], [640,480], [640,400], [480,360], [1680,1050]]) {
      await page.setViewportSize({ width, height });
      for (const label of ["Мессенджер", "Задачи", "Заявки на оплату", "Лента", "Список проектов", "Согласование поездок", "Календарь", "Сотрудники", "Уведомления"]) {
        await open(label);
        await inspect(`${width}x${height} ${label}`);
        if (width === 640) await page.screenshot({ path: path.join(output, `640-${label}.png`) });
      }
    }
    await page.setViewportSize({ width: 640, height: 480 });
    await open("Мессенджер");
    await page.locator(".chat-row").first().click();
    const draft = page.getByRole("textbox", { name: "Новое сообщение", exact: true });
    await draft.fill("Несохранённый черновик для проверки размера окна");
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).waitFor({ state: "visible" });
    await inspect("640 conversation");
    await page.screenshot({ path: path.join(output, "640-conversation.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setViewportSize({ width: 640, height: 480 });
    assert.equal(await draft.inputValue(), "Несохранённый черновик для проверки размера окна");
    await page.getByRole("button", { name: "К списку чатов" }).click();
    await page.getByRole("button", { name: "Создать чат", exact: true }).click();
    await inspect("640 create group");
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await open("Задачи");
    if (await page.locator(".task-row").count()) {
      await page.locator(".task-row").first().click();
      await inspect("640 task detail");
      await page.screenshot({ path: path.join(output, "640-task-detail.png") });
      await page.getByRole("button", { name: "К списку задач" }).click();
    }
    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    await inspect("640 task kanban");
    await open("Список проектов");
    if (await page.locator(".project-card").count()) {
      await page.locator(".project-card").first().click();
      await inspect("640 project detail");
      await page.getByRole("button", { name: "К проектам" }).click();
    }
    await page.getByRole("button", { name: "Новый проект", exact: true }).click();
    await inspect("640 project form");
    await page.getByRole("button", { name: "Сохранить", exact: true }).scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    await open("Заявки на оплату");
    const createApproval = page.getByRole("button", { name: "Новая заявка", exact: true });
    if (await createApproval.count() && await createApproval.isEnabled()) {
      await createApproval.click();
      await inspect("640 approval form");
      await page.screenshot({ path: path.join(output, "640-approval-form.png") });
      await page.getByRole("button", { name: "Отмена", exact: true }).click();
    }
    const card = page.locator(".approval-card-open").first();
    if (await card.count()) {
      await card.click();
      await inspect("640 approval detail");
      await page.screenshot({ path: path.join(output, "640-approval-detail.png") });
      await page.getByRole("button", { name: "Закрыть карточку заявки", exact: true }).click();
    }
    await page.getByRole("button", { name: "Конструктор маршрутов", exact: true }).click();
    await inspect("640 workflow");
    await page.screenshot({ path: path.join(output, "640-workflow.png") });
    await open("Календарь");
    await page.getByRole("button", { name: "Новое событие", exact: true }).click();
    await page.getByRole("textbox", { name: "Название события" }).fill("Проверка пустой даты");
    await page.getByLabel("Начало", { exact: true }).fill("");
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "корректные начало" }).waitFor();
    await inspect("640 invalid calendar date");
    await page.locator('.rail-action[aria-label="Настройки"]').click();
    await inspect("640 account");
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    assert.deepEqual(errors, []);
    assert.deepEqual(checks.filter((check) => check.issues.length), []);
    console.log(`PASS: ${checks.length} layouts, 8 window sizes, compact navigation, draft preservation and invalid-date recovery.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") });
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors }, null, 2));
    throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
