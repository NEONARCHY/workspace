// Local demo only: synthetic payment cards and all transitions stay in memory.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const colors = { start: "#f26b47", project_financier: "#f78d4d", finance_manager_projects: "#fdb051", members: "#fff55a", chair_assistant: "#7bc56f", chief_accountant: "#abd46c", deputy_chair: "#00bbb4", chair: "#00bef6", awaiting_payment: "#f16ca8", payment: "#a5de00", correction: "#6b52cc", completed: "#00ff00", cancelled: "#ff0000" };
const normalize = (value) => value.replace(/\s+/g, " ").trim();
async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.PAYMENT_ELECTRON_EXE);
  const output = path.resolve(`tmp/payment-board-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let browser, app, page;
  if (native) {
    const profile = await fs.mkdtemp(path.join(output, "profile-"));
    app = await electron.launch({ executablePath: path.resolve(process.env.PAYMENT_ELECTRON_EXE), args: [`--user-data-dir=${profile}`] });
    page = await app.firstWindow();
    const pkg = JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8"));
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), pkg.version);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1680, height: 900 } });
  }
  const errors = []; let requests, workflow, transitions = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  const stage = (key) => ({ key, label: workflow.nodes.find((node) => node.id === key).label, kind: "approval", canAct: true });
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/workspace/bootstrap", async (route) => {
    const response = await route.fetch(); const data = await response.json(); workflow = data.workflow;
    assert(data.requests[0], "Local demo requires a payment fixture");
    requests ??= [
      ["qa-board-a", "Тест перевод А", 25000000, "UZS"],
      ["qa-board-b", "Тест перевод Б", 19, "UZS"],
      ["qa-board-usd", "Тест другой валюты", 12.5, "USD"],
    ].map(([id, title, amount, currency], index) => ({ ...data.requests[0], id, number: `QA-${index + 1}`, title, amount, currency, purpose: "Тест только в памяти", status: "running", statusLabel: "На согласовании", activeNodeKeys: ["deputy_chair"], activeStages: [stage("deputy_chair")], requesterId: data.currentUser.id, responsibleUserId: data.currentUser.id, sourceTaskId: null, actions: [], versions: [], details: { ...data.requests[0].details, projectName: "Проверка итогов", projectCode: "QA", comment: "", sourceAccount: "", destinationAccount: "" } }));
    await route.fulfill({ response, json: { ...data, requests, attachments: [] } });
  });
  await page.route("**/api/v1/approval-requests/*/actions", async (route) => {
    assert(route.request().url().endsWith("/qa-board-a/actions"));
    assert.equal(route.request().method(), "POST");
    assert.equal(route.request().postDataJSON().action, "approve");
    requests = requests.map((request) => request.id === "qa-board-a" ? { ...request, activeNodeKeys: ["chair"], activeStages: [stage("chair")] } : request);
    transitions++;
    await route.fulfill({ json: requests[0] });
  });
  const column = (key) => page.locator(`.approval-column[data-stage-key="${key}"]`);
  const total = async (key) => normalize(await column(key).locator(".approval-column-total").innerText());
  try {
    if (!native) await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="Заявки на оплату"]').click();
    for (const [key, color] of Object.entries(colors)) {
      const rgb = `rgb(${[1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(", ")})`;
      assert.equal(await column(key).locator("header").evaluate((node) => getComputedStyle(node).backgroundColor), rgb, key);
    }
    assert.equal(await total("start"), "Сумма в колонке 0 UZS");
    assert.equal(await total("deputy_chair"), "Сумма в колонке 25 000 019 UZS 12,50 USD");
    assert.equal(await column("deputy_chair").locator(".approval-column-count").innerText(), "3");
    await page.screenshot({ path: path.join(output, "colours-start.png") });
    await column("deputy_chair").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, "totals-before.png") });
    const card = page.getByRole("button", { name: "Открыть заявку №QA-1: Тест перевод А", exact: true }).locator("..");
    await card.dragTo(column("chair"));
    await page.getByRole("status").filter({ hasText: "сервер обработал переход" }).waitFor();
    assert.equal(transitions, 1);
    assert.equal(await total("deputy_chair"), "Сумма в колонке 19 UZS 12,50 USD");
    assert.equal(await total("chair"), "Сумма в колонке 25 000 000 UZS");
    await page.getByLabel("Поиск заявок").fill("Тест перевод А");
    assert.equal(await total("deputy_chair"), "Сумма в колонке 0 UZS");
    assert.equal(await total("chair"), "Сумма в колонке 25 000 000 UZS");
    await page.getByLabel("Поиск заявок").fill("");
    assert.equal(await total("deputy_chair"), "Сумма в колонке 19 UZS 12,50 USD");
    for (const width of [800, 640]) {
      if (native) await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 600), width);
      else await page.setViewportSize({ width, height: 600 });
      await column("chair").scrollIntoViewIfNeeded();
      assert(await column("chair").locator(".approval-column-total").evaluate((node) => node.scrollWidth <= node.clientWidth + 1));
      await page.screenshot({ path: path.join(output, `${width}-totals.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: 13 exact Bitrix colours, zero/decimal/mixed-currency totals, drag-and-drop recalculation, filters and compact windows${native ? " in packaged Electron" : " in Edge"}; no payment writes to server.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
    throw error;
  } finally { if (app) await app.close(); if (browser) await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
