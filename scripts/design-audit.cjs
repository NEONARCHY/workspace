// Local visual/axe audit. Chat read markers are intercepted; no record is edited.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const native = Boolean(process.env.DESIGN_ELECTRON_EXE);
  const phase = process.env.DESIGN_PHASE || "after";
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const output = path.resolve(`tmp/design-${phase}${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let browser, app, page;
  if (native) {
    app = await electron.launch({ executablePath: process.env.DESIGN_ELECTRON_EXE, args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] });
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8")).version);
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  }
  const results = [], errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  const scan = async (label) => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      // Scan the final visible state, not Fluent's intermediate entrance opacity.
      await Promise.all(document.getAnimations().filter((animation) => {
        const timing = animation.effect?.getComputedTiming();
        return timing && timing.iterations !== Infinity && Number(timing.endTime) < 2000;
      }).map((animation) => animation.finished.catch(() => undefined)));
    });
    // DevTools evaluation keeps the application's production CSP unchanged.
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const audit = await page.evaluate(async () => {
      const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
      return {
        font: getComputedStyle(document.querySelector(".app-provider")).fontFamily,
        violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map((n) => ({ target: n.target, failure: n.failureSummary })) })),
        incomplete: result.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })),
      };
    });
    results.push({ label, ...audit });
    await page.screenshot({ path: path.join(output, `${label}.png`) });
    console.log(label, audit.violations.map((v) => `${v.id}:${v.nodes.length}`).join(", ") || "PASS");
  };
  try {
    if (!native) await page.goto(origin);
    await page.locator(".auth-card").waitFor();
    await scan("login");
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    for (const [key, label] of Object.entries({ messenger: "Мессенджер", tasks: "Задачи", payments: "Заявки на оплату", feed: "Лента", projects: "Список проектов", trips: "Согласование поездок", calendar: "Календарь", employees: "Сотрудники", notifications: "Уведомления", crm: "CRM" })) {
      await page.locator(`.rail-action[aria-label="${label}"]`).click();
      if (key === "employees") await page.locator(".directory-layout").waitFor();
      await scan(key);
    }
    await page.locator('.rail-action[aria-label="Заявки на оплату"]').click();
    await page.getByRole("button", { name: "Новая заявка", exact: true }).click();
    await scan("payment-form");
    await page.getByRole("button", { name: "Закрыть форму создания" }).click();
    await page.locator(".approval-card-open").first().click();
    await scan("payment-detail");
    await page.getByRole("button", { name: "Закрыть карточку заявки" }).click();
    await page.getByRole("button", { name: "Конструктор маршрутов" }).click();
    await page.locator(".react-flow__node.node-approval").first().click();
    await scan("workflow-inspector");
    await page.locator('.rail-action[aria-label="Список проектов"]').click();
    await page.getByRole("button", { name: "Новый проект" }).click();
    await scan("project-form");
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.locator('.rail-action[aria-label="Согласование поездок"]').click();
    await page.getByRole("button", { name: "Новая командировка" }).click();
    await scan("trip-form");
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.getByRole("button", { name: "Перейти в раздел", exact: true }).click();
    await scan("section-jump");
    await page.keyboard.press("Escape");
    await page.locator('.rail-action[aria-label="Настройки"]').click();
    await page.locator(".account-panel").waitFor();
    await scan("account");
    assert.deepEqual(errors, []);
    if (phase !== "before") assert.equal(results.reduce((n, r) => n + r.violations.length, 0), 0, "no axe AA violations on scanned screens");
  } finally {
    await fs.writeFile(path.join(output, "audit.json"), JSON.stringify({ results, errors }, null, 2));
    if (app) await app.close();
    if (browser) await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
