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
      let personalMode = false;
      const document = { id: "source", revision: 1, number: "QA-184", subject: "Подготовить ответ по обращению организации",
        sender: "Тестовая организация", receivedAt: "2026-11-23T05:00:00Z", source: "exat", filesExpected: true,
        canAssign: true, canOpenTask: false, execution: null };
      const originalText = "Тестовое обращение организации.\n<script>Текст письма, а не исполняемая разметка</script>";
      const files = [{ id: "original", name: "Обращение.txt", byteSize: Buffer.byteLength(originalText), sha256: "a".repeat(64) }];
      let executionDetail = null;
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
          executionDetail = { description: payload.instruction, resultText: null, coAssigneeIds: ["co"], latestReturn: null,
            files: [], canSubmit: false, canAccept: false, canReturn: false };
          return route.fulfill({ json: { document, files, executionDetail } });
        }
        assert.equal(route.request().method(), "GET");
        if (url.pathname.endsWith("/files/original")) return route.fulfill({ contentType: "text/plain; charset=utf-8", body: originalText });
        if (url.pathname.endsWith("/incoming-documents/source")) return route.fulfill({ json: { document, files, executionDetail } });
        if (url.pathname.endsWith("/incoming-documents")) {
          assert.equal(url.searchParams.get("personal"), personalMode ? "true" : null);
          return route.fulfill({ json: { documents: [document], total: 1, offset: 0, limit: 30 } });
        }
        return route.fulfill({ status: 404, json: { detail: "No synthetic fixture for this route" } });
      });
      const base = process.env.INCOMING_QA_BASE || "http://127.0.0.1:5189";
      await page.goto(`${base}/qa/incoming-documents.html?theme=${theme}`);
      await page.getByRole("button", { name: /№ QA-184/ }).click();
      await page.getByRole("button", { name: "Открыть Обращение.txt" }).click();
      await page.getByRole("dialog").getByText(originalText, { exact: true }).waitFor();
      await page.waitForFunction(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog && getComputedStyle(dialog).opacity === "1"
          && !dialog.getAnimations({ subtree: true }).some(animation => animation.playState === "running");
      });
      await page.screenshot({ path: path.join(output, `${theme}-original-text.png`), fullPage: true });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Открыть Обращение.txt");
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
      document.execution.status = "completed";
      executionDetail.resultText = "Проект ответа согласован. Письмо направлено адресату, подтверждение приложено.";
      executionDetail.files = [{ id: "result-file", ownerType: "task", ownerId: "execution-task", fileName: "Официальный ответ.pdf",
        byteSize: 245760, contentType: "application/pdf", sha256: "b".repeat(64), uploadedByUserId: "executor", createdAt: "2026-11-23T12:00:00Z" }];
      personalMode = true;
      await page.goto(`${base}/qa/incoming-documents.html?theme=${theme}&domain=tasks`);
      await page.getByRole("tab", { name: "Мои письма 1" }).click();
      await page.getByRole("button", { name: /№ QA-184/ }).click();
      await page.getByText(executionDetail.resultText).waitFor();
      await page.getByText("Официальный ответ.pdf", { exact: true }).waitFor();
      await page.evaluate(require("axe-core").source);
      const accessibility = await page.evaluate(async () => window.axe.run(".incoming-documents", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      }));
      assert.deepEqual(accessibility.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), [], `${theme} accessibility`);
      for (const [width, height] of [[1440, 900], [1024, 768], [512, 384]]) {
        await page.setViewportSize({ width, height });
        await page.getByText(executionDetail.resultText).scrollIntoViewIfNeeded();
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
        assert(dimensions.scroll <= dimensions.width + 1, JSON.stringify({ theme, width, dimensions }));
        await page.screenshot({ path: path.join(output, `${theme}-result-${width}.png`), fullPage: true });
        results.push({ theme, width, height, personalLettersTab: true, inlineResult: true, noHorizontalOverflow: true });
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      document.execution.status = "awaiting_review";
      executionDetail.canAccept = true; executionDetail.canReturn = true;
      await page.getByRole("button", { name: "Обновить", exact: true }).click();
      await page.getByRole("button", { name: "Принять результат", exact: true }).waitFor();
      await page.getByRole("button", { name: "Принять результат", exact: true }).scrollIntoViewIfNeeded();
      const reviewAccessibility = await page.evaluate(async () => window.axe.run(".incoming-documents", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      }));
      assert.deepEqual(reviewAccessibility.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), [], `${theme} review accessibility`);
      await page.screenshot({ path: path.join(output, `${theme}-review.png`), fullPage: true });
      await page.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(results, null, 2));
    console.log("Incoming documents: light/dark, desktop/1024/640/512, reachable actions, no overflow and forced colours passed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
