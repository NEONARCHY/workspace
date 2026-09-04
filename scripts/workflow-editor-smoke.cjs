// Local demo only. Workflow saves are simulated in memory; no graph is published.
// WORKFLOW_ELECTRON_EXE optionally tests an unpacked desktop build instead of Vite.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.WORKFLOW_ELECTRON_EXE);
  const output = path.resolve(`tmp/workflow-editor-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let app;
  let browser;
  let page;
  if (native) {
    const profile = await fs.mkdtemp(path.join(output, "profile-"));
    app = await electron.launch({ executablePath: path.resolve(process.env.WORKFLOW_ELECTRON_EXE), args: [`--user-data-dir=${profile}`] });
    page = await app.firstWindow();
    const pkg = JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8"));
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), pkg.version);
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  }
  const errors = [];
  const checks = [];
  let workflow;
  let writes = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/workspace/bootstrap", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    workflow ??= data.workflow;
    assert(workflow?.nodes.length, "Demo account needs a workflow");
    await route.fulfill({ response, json: { ...data, workflow } });
  });
  await page.route("**/api/v1/approval-templates/**", async (route) => {
    assert.equal(route.request().method(), "PUT", "Publishing is not part of this test");
    assert(route.request().url().endsWith("/graph"));
    workflow = { ...workflow, ...route.request().postDataJSON() };
    writes++;
    await route.fulfill({ json: workflow });
  });
  const inspect = async (label) => {
    const blockers = await page.locator("[data-portal-node]").evaluateAll((nodes) => nodes.filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width >= innerWidth * .9 && rect.height >= innerHeight * .9;
    }).map((node) => ({ className: node.className, background: getComputedStyle(node).backgroundColor })));
    assert.deepEqual(blockers, [], `${label}: tooltip portal must not cover the app`);
    assert.equal(await page.getByText("Не удалось показать экран", { exact: true }).count(), 0);
    checks.push(label);
  };
  const clickThrough = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    assert(await locator.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), "A portal is intercepting clicks");
    await locator.click();
  };
  try {
    if (!native) await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="Заявки на оплату"]').click();
    await page.getByRole("button", { name: "Конструктор маршрутов", exact: true }).click();
    await inspect("open designer");
    const node = page.locator(".react-flow__node.node-approval").first();
    const nodeId = await node.getAttribute("data-id");
    await node.click();
    await inspect("select node — reported white screen");
    assert(await page.locator("[data-portal-node].app-provider").count(), "Exercise a real Fluent portal");
    if (process.env.VERIFY_REGRESSION) {
      const oldStyle = await page.addStyleTag({ content: ".app-provider { display:block; width:100%; height:100%; }" });
      await assert.rejects(() => inspect("old CSS regression"), /tooltip portal must not cover/);
      await page.screenshot({ path: path.join(output, "old-css-white-screen.png") });
      await oldStyle.evaluate((node) => node.remove());
      await inspect("remove old CSS restores application");
    }
    const inspector = page.locator(".workflow-inspector");
    await clickThrough(inspector.getByRole("textbox").first());
    await inspector.getByRole("textbox").first().fill("Проверка редактора маршрута");
    await inspector.getByRole("textbox").nth(1).fill("Тестовое изменение только в памяти браузера");
    await inspector.locator("select").first().selectOption("correction");
    await inspector.locator("select[multiple]").selectOption({ index: 0 });
    await inspect("edit name, rule, kind and positions");
    await page.getByRole("button", { name: "Удалить блок", exact: true }).hover();
    await page.getByRole("tooltip").waitFor({ state: "visible" });
    await inspect("visible tooltip");
    await clickThrough(inspector.getByRole("textbox").first());
    const before = await node.boundingBox();
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 50, { steps: 10 });
    await page.mouse.up();
    await inspect("drag node");
    const count = await page.locator(".react-flow__node").count();
    await clickThrough(page.getByRole("button", { name: "Согласование", exact: true }));
    assert.equal(await page.locator(".react-flow__node").count(), count + 1);
    await clickThrough(page.getByRole("button", { name: "Удалить блок", exact: true }));
    assert.equal(await page.locator(".react-flow__node").count(), count);
    await inspect("add/delete node");
    await clickThrough(page.getByRole("button", { name: "Сохранить", exact: true }));
    await page.getByRole("button", { name: "Новая заявка", exact: true }).waitFor();
    assert.equal(writes, 1);
    assert.equal(workflow.nodes.find((item) => item.id === nodeId).label, "Проверка редактора маршрута");
    await page.getByRole("button", { name: "Конструктор маршрутов", exact: true }).click();
    await page.locator(`.react-flow__node[data-id="${nodeId}"]`).click();
    await inspect("save/reopen in-memory draft");
    await page.screenshot({ path: path.join(output, "edited-workflow.png") });
    for (const width of [800, 640]) {
      if (native) await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 600), width);
      else await page.setViewportSize({ width, height: 600 });
      await inspector.getByRole("textbox").first().scrollIntoViewIfNeeded();
      await clickThrough(inspector.getByRole("textbox").first());
      await inspect(`${width}px selected node`);
    }
    await clickThrough(page.locator('.rail-action[aria-label="Мессенджер"]'));
    await page.locator(".messenger-view").waitFor();
    await inspect("navigate away without a blocking portal");
    await page.getByRole("button", { name: "Создать чат", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /Название группы/ }).fill("Проверка диалога без создания группы");
    await clickThrough(dialog.getByRole("button", { name: "Закрыть", exact: true }));
    await dialog.waitFor({ state: "detached" });
    await inspect("real dialog remains interactive and closes normally");
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors, simulatedSaves: writes }, null, 2));
    console.log(`PASS: ${checks.length} workflow/portal checks${native ? " in packaged Electron" : " in Edge"}; workflow saves stay in memory.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
    throw error;
  } finally {
    if (app) await app.close();
    if (browser) await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
