// Local-only redesign regression. No business records are written.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const native = Boolean(process.env.DESIGN_ELECTRON_EXE);
  const output = path.resolve(`tmp/design-ux${native ? "-desktop" : ""}`);
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
  const checks = [], errors = [], fontUrls = [];
  const check = (name, ok) => { assert(ok, name); checks.push(name); };
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (/Gilroy.*\.ttf/.test(request.url())) fontUrls.push(request.url()); });
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  const stable = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const open = (label) => page.locator(`.rail-action[aria-label="${label}"]`).click();
  try {
    if (!native) await page.goto("http://127.0.0.1:5173");
    await page.locator(".auth-card").waitFor();
    const fonts = await page.evaluate(async () => {
      await Promise.all([400, 500, 600, 700].map((weight) => document.fonts.load(`${weight} 14px Gilroy`, "Yuksalish Согласование O‘zbekiston")));
      await document.fonts.ready;
      return [...document.fonts].filter((font) => font.family === "Gilroy").map((font) => ({ weight: font.weight, status: font.status }));
    });
    check("four bundled Gilroy weights load", fonts.length === 4 && fonts.every((font) => font.status === "loaded"));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".auth-intro h1" });
    const actualFonts = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    check("Cyrillic heading really renders with embedded Gilroy", actualFonts.fonts.length > 0 && actualFonts.fonts.every((font) => font.isCustomFont && /Gilroy/i.test(font.familyName)));
    await cdp.detach();
    check("brandbook navy on login", await page.locator(".auth-intro").evaluate((el) => getComputedStyle(el).backgroundColor === "rgb(41, 58, 85)"));
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    // Scoped section navigation, keyboard activation, explicit empty result, Escape restoration.
    const jump = page.getByRole("button", { name: "Перейти в раздел", exact: true });
    await jump.focus(); await page.keyboard.press("Control+k");
    await page.getByRole("textbox", { name: "Найти раздел" }).fill("__нет__");
    check("section switcher empty result", await page.getByRole("status").filter({ hasText: "Раздел не найден" }).isVisible());
    await page.keyboard.press("Escape"); await stable();
    check("Escape restores trigger focus", await jump.evaluate((el) => el === document.activeElement));
    await jump.click();
    await page.getByRole("textbox", { name: "Найти раздел" }).fill("задачи");
    await page.getByRole("textbox", { name: "Найти раздел" }).press("Enter"); await stable();
    check("Enter opens matching section", await page.locator(".tasks-view").isVisible());
    check("focus moves to section content", await page.locator("#workspace-content").evaluate((el) => el === document.activeElement));
    const taskSearch = page.getByRole("textbox", { name: "Поиск задач" });
    const firstTitle = await page.locator(".task-title-cell strong").first().textContent();
    await taskSearch.fill("__not_found__");
    check("task list search filters", await page.locator(".task-row").count() === 0);
    await page.getByRole("button", { name: "Kanban", exact: true }).click();
    check("Kanban uses same search", await page.locator(".kanban-card").count() === 0);
    await taskSearch.fill(firstTitle);
    check("matching tasks restored in Kanban", await page.locator(".kanban-card").count() > 0);
    await taskSearch.fill("");
    await page.getByRole("button", { name: "Просроченные", exact: true }).click();
    check("overdue tasks have their own column", await page.locator('.kanban-column[data-task-status="overdue"]').count() === 1);
    check("filter applies to all Kanban cards", await page.locator(".kanban-card").evaluateAll((cards) => cards.every((card) => card.closest('[data-task-status="overdue"]'))));
    await open("Сотрудники"); await page.locator(".directory-layout").waitFor();
    const employeeSearch = page.getByRole("textbox", { name: "Поиск сотрудников" });
    const firstEmployee = await page.locator(".employee-list > button strong").first().textContent();
    const selectedEmployee = await page.locator(".directory-heading h2").textContent();
    await employeeSearch.fill("__not_found__");
    check("employee empty result", await page.getByText("Сотрудники не найдены", { exact: true }).isVisible());
    check("search preserves employee draft/selection", await page.locator(".directory-heading h2").textContent() === selectedEmployee);
    await employeeSearch.fill(firstEmployee.toUpperCase());
    check("employee search is case insensitive", await page.locator(".employee-list > button").count() === 1);
    await open("Календарь");
    check("calendar has no nested buttons", await page.locator(".calendar-day button button").count() === 0);
    const event = page.locator("button.calendar-event-pill").first();
    if (await event.count()) {
      await event.focus(); await page.keyboard.press("Enter");
      check("calendar event keyboard activation", await page.locator(".calendar-detail").isVisible());
    }
    await page.locator(".calendar-day-number").first().focus(); await page.keyboard.press("Enter");
    check("calendar day keyboard creates draft", await page.getByRole("textbox", { name: "Название события" }).isVisible());
    await open("Мессенджер");
    await jump.click(); await page.getByRole("textbox", { name: "Найти раздел" }).fill("настройки");
    await page.getByRole("textbox", { name: "Найти раздел" }).press("Enter"); await stable();
    check("settings route opens account panel", await page.locator(".account-panel").isVisible());
    check("focus belongs to new settings panel", await page.locator(".account-panel").evaluate((el) => el.contains(document.activeElement)));
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    for (const [section, action, selector] of [
      ["Заявки на оплату", "Новая заявка", ".approval-create-panel"],
      ["Список проектов", "Новый проект", ".bp7-modal"],
    ]) {
      await open(section); await page.getByRole("button", { name: action, exact: true }).click(); await stable();
      const panel = page.locator(selector);
      check(`${section}: initial modal focus`, await panel.evaluate((el) => el.contains(document.activeElement)));
      const buttons = panel.locator("button:visible:not(:disabled)");
      await buttons.last().focus(); await page.keyboard.press("Tab");
      check(`${section}: Tab stays in modal`, await panel.evaluate((el) => el.contains(document.activeElement)));
      await page.keyboard.press("Escape"); await stable();
      check(`${section}: Escape and background restored`, await panel.count() === 0 && await page.getByRole("button", { name: action, exact: true }).isEnabled());
    }
    // Native zoom changes CSS viewport, not just screenshot scaling.
    if (native) await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    else await page.setViewportSize({ width: 720, height: 480 });
    await stable();
    await jump.click();
    check("compact section trigger retains accessible name", await page.getByRole("dialog", { name: "Перейти в раздел" }).isVisible());
    check("zoomed dialog fits CSS viewport", await page.locator(".section-jump-dialog").evaluate((el) => {
      const rect = el.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth + 2 && rect.height <= innerHeight + 2;
    }));
    await page.keyboard.press("Escape");
    await page.locator(".section-jump-dialog").waitFor({ state: "hidden" });
    const overflow = await page.evaluate(() => [...document.querySelectorAll(".app-shell,.global-bar,.app-content")].some((el) => el.scrollWidth > el.clientWidth + 3));
    check(native ? "200% native zoom reflow" : "720px equivalent zoom reflow", !overflow);
    // Playwright clips Electron screenshots to CSS pixels at non-100% zoom.
    // Capture the actual BrowserWindow so the whole physical viewport is visible.
    if (native) {
      const pixels = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString("base64"));
      await fs.writeFile(path.join(output, "compact.png"), Buffer.from(pixels, "base64"));
    } else await page.screenshot({ path: path.join(output, "compact.png") });
    fontUrls.push(...await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name).filter((url) => /Gilroy.*\.ttf/.test(url))));
    // file:// resource timing entries can be omitted by Electron. Inspect the
    // actual @font-face URLs too; glyph rendering/loaded status were checked above.
    fontUrls.push(...await page.evaluate(() => [...document.styleSheets].flatMap((sheet) => {
      try { return [...sheet.cssRules].filter((rule) => rule instanceof CSSFontFaceRule && rule.style.fontFamily === "Gilroy").flatMap((rule) => {
        const match = rule.style.getPropertyValue("src").match(/url\(["']?([^\)"']+)/);
        return match ? [new URL(match[1], sheet.href || document.baseURI).href] : [];
      }); } catch { return []; }
    })));
    check("all font requests stay local", fontUrls.length > 0 && fontUrls.every((url) => native ? url.startsWith("file:") : new URL(url).hostname === "127.0.0.1"));
    assert.deepEqual(errors, []);
    console.log(`PASS: ${checks.length} redesign UX/font/keyboard checks${native ? " in packaged Electron" : " in Edge"}.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined);
    throw error;
  } finally {
    await fs.writeFile(path.join(output, "checks.json"), JSON.stringify({ checks, errors }, null, 2));
    if (app) await app.close();
    if (browser) await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
