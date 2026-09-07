// UI-only regression: never change business records; always revoke this run's login.
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises"), path = require("node:path"), assert = require("node:assert/strict");

(async () => {
  assert(process.env.QA_PASSWORD, "Set QA_PASSWORD for the local test account");
  const native = Boolean(process.env.LISTS_ELECTRON_EXE);
  const output = path.resolve(`tmp/record-lists${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let app, browser, page, token, apiOrigin;
  if (native) {
    app = await _electron.launch({ executablePath: path.resolve(process.env.LISTS_ELECTRON_EXE), args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] });
    page = await app.firstWindow();
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  }
  const captures = [], errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) && /\/auth\/(login|refresh)$/.test(url.pathname) && response.ok()) captures.push(response.json().then(data => { token = data.accessToken; apiOrigin = url.origin; }));
  });
  await page.route("**/api/v1/**", route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" || pathname.startsWith("/api/v1/auth/")) return route.continue();
    if (/\/chats\/[^/]+\/read$/.test(pathname)) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 503, json: { detail: "QA: запись перехвачена" } });
  });
  const settle = () => page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().endTime) < 2000).map(a => a.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const resize = async (width, height) => {
    if (native) await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    else await page.setViewportSize({ width, height });
    await settle();
  };
  const capture = async label => {
    await settle();
    if (native) {
      const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
      await fs.writeFile(path.join(output, `${label}.png`), Buffer.from(png, "base64"));
    } else await page.screenshot({ path: path.join(output, `${label}.png`) });
  };
  const axeScan = async () => {
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const issues = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
    assert.deepEqual(issues, []);
  };
  try {
    if (!native) await page.goto("http://127.0.0.1:5173");
    await page.getByRole("textbox", { name: /Логин/ }).fill(process.env.QA_LOGIN || "malika");
    await page.getByLabel(/Пароль/).fill(process.env.QA_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    for (const [key, label, searchLabel] of [["tasks", "Задачи", "Поиск задач"], ["employees", "Сотрудники", "Поиск сотрудников"]]) {
      await resize(1600, 1000);
      await page.locator(`.rail-action[aria-label="${label}"]`).click();
      await page.locator(".record-table").waitFor();
      assert.equal(await page.getByRole("dialog").count(), 0, "list is full width without an automatically opened record");
      for (const [width, height] of native ? [[1600, 1000], [1280, 900], [960, 720], [640, 480]] : [[1600, 1000], [1280, 900], [960, 720], [640, 480], [320, 520]]) {
        await resize(width, height);
        const geometry = await page.locator(".record-table-frame").evaluate(frame => {
          const r = frame.getBoundingClientRect(), scroller = frame.querySelector(".record-table-scroll");
          return { fits: r.left >= 0 && r.right <= innerWidth + 1, globalOverflow: document.documentElement.scrollWidth - innerWidth,
            internalScroll: scroller.scrollWidth > scroller.clientWidth, font: getComputedStyle(frame).fontFamily };
        });
        assert(geometry.fits && geometry.globalOverflow <= 1 && geometry.font.includes("Gilroy"), `${key}-${width}: ${JSON.stringify(geometry)}`);
        await axeScan(); await capture(`${key}-${width}`); checks.push({ key, width, ...geometry });
      }
      if (native) {
        await resize(1440, 960); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
        await settle(); await axeScan(); await capture(`${key}-zoom-200`);
        assert(await page.locator(".record-table-frame").evaluate(frame => frame.getBoundingClientRect().right <= innerWidth + 1));
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
      }
      await resize(1600, 1000);
      const sort = page.locator(".record-table th button").first();
      await sort.click(); assert(await sort.locator("..").getAttribute("aria-sort"));
      await page.getByRole("textbox", { name: searchLabel }).fill("__ничего_не_найдено__");
      assert.equal(await page.locator(".record-table tbody tr").count(), 0);
      assert(await page.locator(".record-table-empty").isVisible());
      await page.getByRole("textbox", { name: searchLabel }).fill("");
      const opener = page.locator(".record-open").first();
      assert(await opener.isVisible());
      const name = await opener.getAttribute("aria-label");
      await opener.click(); await page.getByRole("dialog").waitFor(); await settle(); await axeScan(); await capture(`${key}-detail`);
      await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), name, "focus returns to the opened record");
      if (key === "tasks") {
        await page.getByRole("button", { name: "Kanban", exact: true }).click();
        assert(await page.getByLabel("Kanban задач", { exact: true }).isVisible());
        const kanbanCard = page.locator(".kanban-card").first();
        await kanbanCard.click(); await page.getByRole("dialog").waitFor();
        await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert(await kanbanCard.evaluate(el => el === document.activeElement), "Kanban restores focus to the opened card");
        await page.getByRole("button", { name: "Список", exact: true }).click();
        await page.getByLabel("Моя роль в задаче").selectOption("observer"); await settle();
        await page.getByLabel("Моя роль в задаче").selectOption("all");
      } else {
        await page.getByRole("button", { name: "Должности", exact: true }).click();
        await page.getByRole("dialog", { name: "Справочник должностей" }).waitFor();
        await settle(); await axeScan(); await capture("positions");
        await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" }); await settle();
        await page.getByRole("button", { name: "Пригласить сотрудника", exact: true }).click();
        await page.getByRole("dialog", { name: "Приглашение сотрудника" }).waitFor();
        await settle();
        const inviteFocus = await page.getByRole("textbox", { name: "Имя сотрудника" }).evaluate(el => {
          const r = el.getBoundingClientRect(); return { focused: el === document.activeElement, top: r.top, bottom: r.bottom, height: innerHeight, scroll: el.closest(".account-panel").scrollTop, activeTag: document.activeElement?.tagName };
        });
        assert(inviteFocus.focused && inviteFocus.top >= 100 && inviteFocus.bottom <= inviteFocus.height, `invitation entry point: ${JSON.stringify(inviteFocus)}`);
        await axeScan(); await capture("invitation-entry");
        await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "hidden" });
        const employeeCheckbox = page.getByRole("checkbox", { name: /^Выбрать сотрудника:/ }).first();
        await employeeCheckbox.click();
        const selectionBar = page.getByRole("complementary", { name: "Действия с выбранными сотрудниками" });
        await selectionBar.waitFor(); await settle();
        assert(await page.getByRole("button", { name: "Открыть чат", exact: true }).isVisible());
        await axeScan(); await capture("employees-selection-wide");
        await resize(640, 520);
        const selectionGeometry = await selectionBar.evaluate(bar => {
          const r = bar.getBoundingClientRect();
          return { left: r.left, right: r.right, width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        assert(selectionGeometry.left >= 0 && selectionGeometry.right <= selectionGeometry.width + 1 && selectionGeometry.overflow <= 1, `employee selection: ${JSON.stringify(selectionGeometry)}`);
        await axeScan(); await capture("employees-selection-640");
        await resize(1600, 1000); await employeeCheckbox.click();
      }
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ native, checks, errors }, null, 2));
    console.log(`PASS: ${checks.length} list layouts, axe scans, search, sorting, cards, focus restoration, roles, Kanban and positions. No business writes.`);
  } catch (error) { console.error(error); await capture("failure").catch(() => undefined); throw error; }
  finally {
    // Stop refresh/polling before revocation so cleanup cannot race a live renderer.
    if (app) { await app.close(); app = undefined; }
    if (browser) { await browser.close(); browser = undefined; }
    try {
      await Promise.all(captures);
      if (token) {
        const headers = { Authorization: `Bearer ${token}` };
        assert.equal((await fetch(`${apiOrigin}/api/v1/auth/logout`, { method: "POST", headers, signal: AbortSignal.timeout(10000) })).status, 204);
        let status;
        // The API commits its request transaction as the response finishes.
        for (let attempt = 0; attempt < 8; attempt++) {
          status = (await fetch(`${apiOrigin}/api/v1/auth/sessions`, { headers, signal: AbortSignal.timeout(10000) })).status;
          if (status === 401) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(status, 401);
        console.log("Owned QA session revoked; existing sessions untouched.");
      }
    } finally { if (app) await app.close(); if (browser) await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
