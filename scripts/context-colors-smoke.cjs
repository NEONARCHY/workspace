// Read-only local UI review. No decisions, messages or form submissions.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.GLOW_ELECTRON_EXE), output = path.resolve(`tmp/context-colors-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let browser, app, page;
  if (native) {
    app = await electron.launch({ executablePath: path.resolve(process.env.GLOW_ELECTRON_EXE), args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] });
    page = await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8")).version);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  }
  const errors = [], checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  const shadow = (locator) => locator.evaluate((node) => getComputedStyle(node).boxShadow);
  try {
    if (!native) await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    for (const label of ["Мессенджер", "Задачи", "Заявки на оплату", "Лента", "Список проектов", "Согласование поездок", "Календарь", "Сотрудники", "Уведомления"]) {
      await page.locator(`.rail-action[aria-label="${label}"]`).click();
      assert.notEqual(await shadow(page.locator(".rail-action.active")), "none");
      if (label === "Задачи") {
        await page.getByRole("button", { name: "Kanban", exact: true }).click();
        const tones = await page.locator(".kanban-column").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).getPropertyValue("--context-accent").trim()));
        assert.deepEqual(tones, ["#60788b", "#0f6cbd", "#966100", "#107c41"]);
      }
      if (label === "Список проектов") {
        const tones = await page.locator(".project-stage-success,.project-stage-failure").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).getPropertyValue("--context-accent").trim()));
        assert.deepEqual(tones, ["#107c41", "#b42332"]);
      }
      const action = page.locator(".workspace-view .fui-Button:not([disabled]):not([aria-disabled=true])").first();
      if (await action.count() && await action.isVisible()) {
        await action.hover(); assert.notEqual(await shadow(action), "none", `${label} button glow`);
        assert.equal(await action.evaluate((node) => getComputedStyle(node).filter), "none");
      }
      const card = page.locator(".chat-row.selected,.approval-board-card,.project-card,.kanban-card,.notification-row,.employee-list > button.selected").first();
      if (await card.count() && await card.isVisible()) { await card.hover(); assert.notEqual(await shadow(card), "none", `${label} card glow`); }
      const infinite = await page.evaluate(() => document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations === Infinity && animation.effect?.target?.closest(".animated-amount,.rail-action,.approval-column-total")).length);
      assert.equal(infinite, 0);
      checks.push(label);
      await page.screenshot({ animations: "disabled", path: path.join(output, `${checks.length}-section.png`) });
    }
    // A disabled control must not gain the interactive shadow.
    await page.evaluate(() => {
      const button = document.createElement("button"); button.className = "fui-Button"; button.disabled = true; button.id = "qa-disabled-glow"; button.textContent = "Disabled QA";
      document.querySelector(".notification-header").append(button);
    });
    await page.locator("#qa-disabled-glow").hover();
    assert.equal(await shadow(page.locator("#qa-disabled-glow")), "none");
    await page.locator("#qa-disabled-glow").evaluate((node) => node.remove());
    await page.emulateMedia({ forcedColors: "active" });
    assert.equal(await shadow(page.locator(".rail-action.active")), "none");
    assert.notEqual(await page.locator(".rail-action.active").evaluate((node) => getComputedStyle(node).outlineStyle), "none");
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    assert.equal(await page.locator(".rail-action.active").evaluate((node) => getComputedStyle(node).animationName), "none");
    assert.deepEqual(errors, []);
    console.log(`PASS: contextual glow across ${checks.length} sections, task/project semantics, disabled state, no blur or looping glow, reduced motion and high contrast${native ? " in packaged Electron" : " in Edge"}.`);
  } catch (error) { await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined); throw error; }
  finally { if (app) await app.close(); if (browser) await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
