// Isolated local UI checks: business writes are intercepted; the owned login is revoked in finally.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.COMPOSER_ELECTRON_EXE);
  const output = path.resolve(`tmp/record-composer${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let app, browser, page, ownedToken, apiOrigin;
  if (native) {
    app = await electron.launch({ executablePath: path.resolve(process.env.COMPOSER_ELECTRON_EXE), args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] });
    page = await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8")).version);
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  }
  const errors = [], captures = [], writes = [], checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (["127.0.0.1", "localhost"].includes(url.hostname) && /^\/api\/v1\/auth\/(login|refresh)$/.test(url.pathname) && response.ok()) {
      captures.push(response.json().then((data) => { ownedToken = data.accessToken; apiOrigin = url.origin; }));
    }
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" || pathname.startsWith("/api/v1/auth/")) return route.continue();
    if (/\/chats\/[^/]+\/read$/.test(pathname)) return route.fulfill({ status: 204 });
    writes.push({ pathname, payload: request.postDataJSON() });
    // Slow failure proves the save lock and draft preservation without changing the database.
    await new Promise((resolve) => setTimeout(resolve, 500));
    return route.fulfill({ status: 503, json: { detail: "QA: запись перехвачена, серверные данные не изменены" } });
  });
  const stable = () => page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return timing && timing.iterations !== Infinity && Number(timing.endTime) < 2000;
    }).map((animation) => animation.finished.catch(() => undefined)));
  });
  const resize = async (width, height) => {
    if (native) await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    else await page.setViewportSize({ width, height });
    await stable();
  };
  const inspect = async (label) => {
    await stable();
    const geometry = await page.locator(".record-composer").evaluate((form) => {
      const body = form.querySelector(".record-composer-body"), footer = form.querySelector(".record-composer-footer");
      const rect = form.getBoundingClientRect(), foot = footer.getBoundingClientRect();
      const columns = form.querySelector(".record-composer-columns");
      return { fits: rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
        overflow: Math.max(form.scrollWidth - form.clientWidth, body.scrollWidth - body.clientWidth, columns.scrollWidth - columns.clientWidth),
        footerVisible: foot.top >= 0 && foot.bottom <= innerHeight + 1,
        font: getComputedStyle(form).fontFamily };
    });
    assert(geometry.fits && geometry.footerVisible && geometry.overflow <= 2, `${label}: ${JSON.stringify(geometry)}`);
    assert(geometry.font.includes("Gilroy"));
    const footerBefore = await page.locator(".record-composer-footer").boundingBox();
    await page.locator(".record-composer-body").evaluate((node) => { node.scrollTop = node.scrollHeight; });
    const footerAfter = await page.locator(".record-composer-footer").boundingBox();
    assert(Math.abs(footerAfter.y - footerBefore.y) < 1, "footer does not scroll away");
    await page.locator(".record-composer-body").evaluate((node) => { node.scrollTop = 0; });
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })));
    assert.deepEqual(violations, [], `${label}: axe`);
    if (native) {
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
      await fs.writeFile(path.join(output, `${label}.png`), Buffer.from(png, "base64"));
    } else await page.screenshot({ path: path.join(output, `${label}.png`) });
    checks.push(label);
  };
  try {
    if (!native) await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    for (const [key, section, create, submit] of [
      ["project", "Список проектов", "Новый проект", "Сохранить"],
      ["trip", "Согласование поездок", "Новая командировка", "Сохранить"],
      ["payment", "Заявки на оплату", "Новая заявка", "Отправить по маршруту"],
    ]) {
      await resize(1440, 960);
      await page.locator(`.rail-action[aria-label="${section}"]`).click();
      await page.getByRole("button", { name: create, exact: true }).click();
      await page.locator(".record-composer").waitFor();
      const form = page.locator(".record-composer"), summary = form.locator(".record-composer-summary");
      if (key === "project") {
        await form.getByLabel("Название проекта", { exact: true }).fill("Региональные инициативы Yuksalish — программа развития");
        await form.getByLabel("Код проекта", { exact: true }).fill("QA-UI");
        await form.getByLabel("Бюджет проекта", { exact: true }).fill("12500000");
        await form.getByLabel("Потрачено", { exact: true }).fill("2500000");
        assert((await summary.textContent()).replace(/\s/g, "").includes("10000000UZS"));
      } else if (key === "trip") {
        await form.getByLabel("Цель поездки", { exact: true }).fill("Рабочая встреча с региональной командой и партнёрами");
        await form.getByLabel("Куда едем", { exact: true }).fill("Самарканд");
        await form.getByLabel("Найти участника поездки", { exact: true }).fill("__нет__");
        assert(await form.getByRole("status").isVisible());
        assert((await summary.textContent()).includes("Самарканд"));
        await form.getByLabel("Найти участника поездки", { exact: true }).fill("");
      } else {
        await form.getByLabel("Название заявки", { exact: true }).fill("Оплата организации региональной встречи");
        await form.getByLabel("Сумма заявки", { exact: true }).fill("1250000");
        assert((await summary.textContent()).replace(/\s/g, "").includes("1250000UZS"));
      }
      for (const [width, height] of native ? [[1440, 960], [960, 720], [640, 480]] : [[1440, 960], [960, 720], [640, 480], [480, 520], [320, 480]]) {
        await resize(width, height); await inspect(`${key}-${width}`);
      }
      await resize(1440, 960);
      if (native) {
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
        await inspect(`${key}-zoom-200`);
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
        await stable();
      }
      // Tab remains inside the modal and Escape restores the originating control.
      await form.getByRole("button", { name: submit, exact: true }).focus(); await page.keyboard.press("Tab");
      assert(await form.evaluate((node) => node.contains(document.activeElement)), "keyboard focus stays inside modal");
      const before = writes.length;
      await form.getByRole("button", { name: submit, exact: true }).click();
      await form.getByRole("button", { name: "Сохраняем…", exact: true }).waitFor();
      assert(await form.getByRole("button", { name: "Отмена", exact: true }).isDisabled());
      await form.getByRole("alert").waitFor();
      assert.equal(writes.length, before + 1, "one intercepted submission");
      assert(await form.isVisible(), "failed submit keeps the form open");
      assert((await form.locator("input").first().inputValue()).length > 0 || key === "trip", "entered values remain");
      await page.keyboard.press("Escape");
      await form.waitFor({ state: "hidden" });
      await stable();
      assert(await page.getByRole("button", { name: create, exact: true }).evaluate((node) => node === document.activeElement), "focus restored to create button");
    }
    assert.deepEqual(writes.map((write) => write.pathname), ["/api/v1/projects", "/api/v1/trip-requests", "/api/v1/approval-requests"]);
    assert.equal(writes[0].payload.budget, 12500000); assert.equal(writes[1].payload.destination, "Самарканд"); assert.equal(writes[2].payload.amount, 1250000);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${checks.length} layouts + axe scans; project/trip/payment previews, scroll, focus, intercepted submissions, busy states and preserved input. No business writes.`);
  } catch (error) { await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined); throw error; }
  finally {
    try {
      await Promise.all(captures);
      if (ownedToken) {
        const headers = { Authorization: `Bearer ${ownedToken}` };
        assert.equal((await fetch(`${apiOrigin}/api/v1/auth/logout`, { method: "POST", headers, signal: AbortSignal.timeout(10000) })).status, 204);
        assert.equal((await fetch(`${apiOrigin}/api/v1/auth/sessions`, { headers, signal: AbortSignal.timeout(10000) })).status, 401);
        console.log("PASS: owned QA session revoked; existing sessions untouched.");
      }
    } finally { if (app) await app.close(); if (browser) await browser.close(); }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
