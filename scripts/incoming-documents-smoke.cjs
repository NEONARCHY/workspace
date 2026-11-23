const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

(async () => {
  const output = path.resolve(process.env.INCOMING_QA_OUTPUT || "out/incoming-documents-qa");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [];
  const results = [];
  try {
    for (const theme of ["light", "dark"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      page.on("pageerror", error => errors.push(error.message));
      let assigned = false;
      const document = { id: "source", revision: 1, number: "QA-184", subject: "Подготовить ответ по обращению организации",
        sender: "Тестовая организация", receivedAt: "2026-11-23T05:00:00Z", source: "exat", filesExpected: true,
        canAssign: true, canOpenTask: false, execution: null };
      const files = [{ id: "original", name: "Обращение.pdf", byteSize: 153600, sha256: "a".repeat(64) }];
      await page.route("**/api/v1/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/execution")) {
          assert.equal(route.request().method(), "POST");
          const payload = route.request().postDataJSON();
          assert.equal(payload.assigneeId, "executor");
          assert.deepEqual(payload.coAssigneeIds, ["co"]);
          assert.deepEqual(payload.fileIds, ["original"]);
          assigned = true;
          document.canAssign = false; document.canOpenTask = true;
          document.execution = { taskId: "execution-task", status: "new", dueAt: payload.dueAt,
            assigneeId: "executor", assigneeName: "Исполнитель QA", authorId: "author" };
          return route.fulfill({ json: { document, files } });
        }
        assert.equal(route.request().method(), "GET");
        if (url.pathname.endsWith("/incoming-documents/source")) return route.fulfill({ json: { document, files } });
        if (url.pathname.endsWith("/incoming-documents")) return route.fulfill({ json: { documents: [document], total: 1, offset: 0, limit: 30 } });
        return route.fulfill({ status: 404, json: { detail: "No synthetic fixture for this route" } });
      });
      const base = process.env.INCOMING_QA_BASE || "http://127.0.0.1:5189";
      await page.goto(`${base}/qa/incoming-documents.html?theme=${theme}`);
      await page.getByRole("button", { name: /№ QA-184/ }).click();
      await page.getByRole("button", { name: "Назначить исполнение" }).click();
      await page.getByLabel("Что нужно сделать").fill("Подготовить проект официального ответа и приложить подтверждающие документы.");
      await page.getByRole("button", { name: "Основной исполнитель" }).click();
      await page.getByRole("button", { name: /Исполнитель QA/ }).click();
      await page.getByRole("button", { name: "Добавить соисполнителя" }).click();
      await page.getByRole("button", { name: /Соисполнитель QA/ }).click();
      await page.screenshot({ path: path.join(output, `${theme}-desktop.png`), fullPage: true });
      for (const [width, height] of [[1024, 768], [640, 640], [512, 384]]) {
        await page.setViewportSize({ width, height });
        const submit = page.getByRole("button", { name: "Создать поручение" });
        await submit.scrollIntoViewIfNeeded();
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert(dimensions.scroll <= dimensions.width + 1, JSON.stringify({ theme, width, dimensions }));
        assert(await submit.isVisible());
        await page.screenshot({ path: path.join(output, `${theme}-${width}.png`), fullPage: true });
        results.push({ theme, width, height, noHorizontalOverflow: true, footerReachable: true });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      assert.equal(assigned, false, "Opening and editing must never create a task");
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      await page.getByRole("button", { name: "Создать поручение" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `${theme}-forced-colors.png`), fullPage: true });
      await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
      await page.getByRole("button", { name: "Срок исполнения: открыть выбор" }).click();
      await page.getByRole("button", { name: "Следующий месяц" }).click();
      await page.locator(".ws-calendar-days button:not(.is-outside)").last().click();
      await page.keyboard.press("Escape");
      const submit = page.getByRole("button", { name: "Создать поручение" });
      assert(await submit.isEnabled());
      await submit.focus();
      await page.keyboard.press("Enter");
      const openTask = page.getByRole("button", { name: "Открыть поручение" });
      await openTask.waitFor();
      assert.equal(assigned, true);
      await openTask.click();
      await page.waitForFunction(() => document.documentElement.dataset.openedTask === "execution-task");
      await page.screenshot({ path: path.join(output, `${theme}-assigned.png`), fullPage: true });
      await page.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
    console.log("Incoming documents: light/dark, desktop/1024/640/512, reachable actions, no overflow and forced colours passed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
