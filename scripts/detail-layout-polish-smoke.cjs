// Synthetic read-only UI checks. All API reads are local fixtures; writes are blocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const output = "tmp/detail-layout-polish-qa";
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const report = { checks: [], errors: [] };
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    page.on("pageerror", error => report.errors.push(error.message));
    await page.route("**/api/v1/**", async route => {
      const url = new URL(route.request().url());
      assert.equal(route.request().method(), "GET", "No QA writes");
      if (url.pathname.endsWith("/history") && url.pathname.includes("/tasks/")) {
        await new Promise(resolve => setTimeout(resolve, 60));
        return route.fulfill({ json: { historyComplete: true, nextOffset: null, events: [
          { id: "qa-event", kind: "task_created", occurredAt: "2026-10-16T10:00:00Z", actorName: "Проверка", status: "new" },
        ] } });
      }
      if (url.pathname.endsWith("/hisobot/me")) return route.fulfill({ json: {
        telegramId: "qa", fullName: "Проверка", position: "Специалист", reportScope: "central",
        regionName: null, reportRequired: true, managementAccess: true, absenceKind: null,
        today: "2026-10-16", canSubmit: true, windowOpensAt: "12:00", windowClosesAt: "21:00",
        deadlineAt: "18:30", isOverdue: false, todayReport: null,
      } });
      return route.fulfill({ json: [] });
    });
    const goto = async (view, theme) => {
      await page.goto("http://127.0.0.1:5178/qa/detail-layout.html?view=" + view + "&theme=" + theme);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
    };
    const box = locator => locator.boundingBox();
    const noOverflow = async locator => assert(await locator.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Horizontal overflow: " + locator);
    for (const theme of ["dark", "light"]) {
      await goto("tasks", theme);
      const history = page.getByRole("button", { name: "Маршрут и история", exact: true });
      await history.waitFor();
      await history.scrollIntoViewIfNeeded();
      await page.evaluate(() => {
        window.historyHeights = [];
        let start;
        const sample = now => {
          start ??= now;
          window.historyHeights.push(document.querySelector(".task-history-disclosure").getBoundingClientRect().height);
          if (now - start < 800) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await history.click();
      await page.getByText("Задача поставлена", { exact: true }).waitFor();
      await page.waitForTimeout(850);
      const heights = await page.evaluate(() => window.historyHeights);
      assert(new Set(heights.map(Math.round)).size > 5, "History must animate, not jump");
      await history.click();
      assert.equal(await page.locator(".task-history-disclosure").getAttribute("inert"), "");
      await page.waitForTimeout(300);
      assert.equal((await box(page.locator(".task-history-disclosure"))).height, 0);
      const scope = page.locator(".task-participants-section .employee-scope-switch");
      await scope.scrollIntoViewIfNeeded();
      const form = scope.locator("..");
      assert(Math.abs((await box(scope)).width - (await box(form)).width) < 1);
      assert((await box(scope)).height <= 40);
      const segments = scope.locator("button");
      assert(Math.abs((await box(segments.nth(0))).width - (await box(segments.nth(1))).width) < 1);
      await page.screenshot({ path: output + "/" + theme + "-participants.png" });
      await page.getByRole("button", { name: "Добавить цикл", exact: true }).click();
      await page.getByRole("combobox", { name: "Период повторения" }).click();
      await page.getByRole("option", { name: "Каждые несколько месяцев", exact: true }).click();
      const cycle = page.locator(".cycle-form");
      await cycle.scrollIntoViewIfNeeded();
      await noOverflow(cycle);
      const save = await box(page.getByRole("button", { name: "Сохранить цикл" }));
      const fields = await box(page.locator(".cycle-form-main"));
      const controls = page.locator(".cycle-form-main").locator(".workspace-select, .fui-Input, .ws-date-time-trigger");
      const controlBoxes = await Promise.all((await controls.all()).map(box));
      assert(controlBoxes.every(rect => Math.abs(rect.height - 40) < .1), JSON.stringify(controlBoxes));
      assert(save.y >= fields.y + fields.height, "Cycle actions must be below fields");
      assert(save.height <= 44);
      await page.screenshot({ path: output + "/" + theme + "-cycle.png" });
      await goto("hisobot", theme);
      await page.getByRole("button", { name: "Отчёты сотрудников", exact: true }).click();
      const filters = page.locator(".hisobot-filters");
      await noOverflow(filters);
      const dates = filters.locator(".ws-date-time-trigger");
      assert.equal((await box(dates.nth(0))).height, (await box(dates.nth(1))).height);
      assert.equal((await box(dates.nth(0))).y, (await box(dates.nth(1))).y);
      const searchRow = page.locator(".hisobot-filter-search");
      const refresh = searchRow.getByRole("button", { name: "Обновить", exact: true });
      const rowBox = await box(searchRow), refreshBox = await box(refresh);
      assert(Math.abs(rowBox.x + rowBox.width - refreshBox.x - refreshBox.width) < 1);
      await searchRow.getByRole("searchbox").fill("проверка");
      await page.waitForTimeout(550);
      await noOverflow(searchRow);
      await page.screenshot({ path: output + "/" + theme + "-reports.png" });
      await goto("trip", theme);
      await page.locator(".trip-map-unresolved button").waitFor();
      assert.equal(await page.locator(".trip-map-unresolved").evaluate(node => node.parentElement.className), "trip-map-sidebar");
      const back = page.getByRole("button", { name: "К поездкам", exact: true });
      assert(await back.evaluate(node => node.previousElementSibling.textContent.includes("на карте")));
      assert.equal(await back.locator(".fui-Button__icon").evaluate(node => getComputedStyle(node).padding), "0px");
      await page.screenshot({ path: output + "/" + theme + "-map.png" });
      await goto("feed", theme);
      for (const name of ["Закрепить публикацию", "Удалить публикацию"]) {
        const control = page.getByRole("button", { name, exact: true });
        const rect = await box(control);
        assert(Math.abs(rect.width - rect.height) < .1);
        assert.equal(rect.width, 36);
      }
      await page.screenshot({ path: output + "/" + theme + "-feed.png" });
      report.checks.push({ theme, historySteps: new Set(heights.map(Math.round)).size, cycleActionHeight: save.height });
    }
    for (const width of [1024, 720, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await goto("trip", "dark");
      await page.locator(".trip-map-unresolved button").waitFor();
      assert((await box(page.locator(".trip-map-sidebar"))).y < (await box(page.locator(".trip-map-stage"))).y);
      await noOverflow(page.locator(".trip-map-workspace"));
      await goto("tasks", "dark");
      await page.getByRole("button", { name: "Добавить цикл", exact: true }).click();
      await noOverflow(page.locator(".cycle-form"));
      await goto("hisobot", "dark");
      await page.getByRole("button", { name: "Отчёты сотрудников", exact: true }).click();
      await noOverflow(page.locator(".hisobot-filters"));
      report.checks.push({ width, overflow: false });
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    await goto("tasks", "dark");
    await page.getByRole("button", { name: "Маршрут и история", exact: true }).click();
    assert.equal(await page.locator(".task-history-disclosure").evaluate(node => getComputedStyle(node).transitionDuration), "0s");
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
    assert.equal(await page.locator(".task-history-disclosure").evaluate(node => getComputedStyle(node).transitionDuration), "0s");
    await page.emulateMedia({ forcedColors: "none" });
    assert.deepEqual(report.errors, []);
  } catch (error) {
    await page.screenshot({ path: output + "/failure.png" });
    console.error((await page.locator("body").innerText()).slice(0, 2500));
    throw error;
  } finally {
    await fs.writeFile(output + "/report.json", JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
