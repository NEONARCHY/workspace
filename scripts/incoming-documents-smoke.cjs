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
        sender: "Тестовая организация", receivedAt: "2026-11-23T05:00:00Z", registeredAt: "2026-11-23T05:15:00Z",
        addedAt: "2026-11-23T06:00:00Z", source: "exat", filesExpected: true,
        canAssign: true, canOpenTask: false, execution: null };
      const originalText = "Тестовое обращение организации.\n<script>Текст письма, а не исполняемая разметка</script>";
      const files = [{ id: "original", name: "Обращение.txt", byteSize: Buffer.byteLength(originalText), sha256: "a".repeat(64) }];
      let executionDetail = null;
      const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
      await page.route("**/api/v1/**", async route => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/execution")) {
          assert.equal(route.request().method(), "POST");
          const payload = route.request().postDataJSON();
          assert.equal(payload.assigneeId, "executor");
          assert.equal(payload.instruction, "Ижро учун");
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
        if (url.pathname.endsWith("/tasks/execution-task/history")) return route.fulfill({ json: {
          historyComplete: true, nextOffset: null, events: [
            ...(document.execution.status === "completed" ? [{ id: "closed", kind: "task_completed", occurredAt: "2026-11-24T09:00:00Z", actorUserId: "author", actorName: "Постановщик QA" }] : []),
            ...(executionDetail.resultText ? [{ id: "submitted", kind: "result_submitted_for_review", occurredAt: "2026-11-24T08:00:00Z", actorUserId: "executor", actorName: "Исполнитель QA" }] : []),
            { id: "created", kind: "task_created", occurredAt: "2026-11-23T09:00:00Z", actorUserId: "author", actorName: "Постановщик QA" },
          ],
        } });
        if (url.pathname.endsWith("/attachments/result-image")) return route.fulfill({ contentType: "image/png", body: imageBytes });
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
      assert.equal(await page.getByRole("button", { name: /№ QA-184/ }).locator("time").getAttribute("datetime"), document.addedAt);
      await page.getByRole("region", { name: "Активность письма" }).getByText("Письмо поступило", { exact: true }).waitFor();
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
      const resolution = page.getByRole("combobox", { name: "Что нужно сделать" });
      await resolution.focus();
      await page.keyboard.press("Enter");
      for (const name of ["Ижро учун", "Тезкор", "Маълумот учун", "Таклиф киритиш учун"]) {
        assert(await page.getByRole("option", { name, exact: true }).isVisible());
      }
      await page.screenshot({ path: path.join(output, `${theme}-resolution-options.png`), fullPage: true });
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      assert.equal(await resolution.textContent(), "Ижро учун");
      await page.getByRole("button", { name: "Основной исполнитель" }).click();
      assert.equal(await page.getByRole("button", { name: "Центральный аппарат", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByRole("button", { name: /Региональный сотрудник QA/ }).count(), 0);
      await page.getByRole("button", { name: "Регионы", exact: true }).click();
      await page.getByRole("button", { name: /Региональный сотрудник QA/ }).waitFor();
      await page.waitForFunction(() => !document.querySelector(".person-picker-surface").getAnimations({ subtree: true }).some(animation => animation.playState === "running"));
      await page.screenshot({ path: path.join(output, `${theme}-regional-picker.png`), fullPage: true });
      await page.getByRole("button", { name: "Центральный аппарат", exact: true }).click();
      await page.getByRole("button", { name: /Исполнитель QA/ }).click();
      await page.getByRole("button", { name: "Добавить соисполнителя" }).click();
      assert.equal(await page.getByRole("button", { name: "Центральный аппарат", exact: true }).getAttribute("aria-pressed"), "true");
      assert.equal(await page.getByRole("button", { name: /Региональный сотрудник QA/ }).count(), 0);
      await page.getByRole("button", { name: /Соисполнитель QA/ }).click();
      await page.evaluate(require("axe-core").source);
      const assignmentAccessibility = await page.evaluate(async () => window.axe.run(".incoming-document-assignment", {
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
      }));
      assert.deepEqual(assignmentAccessibility.violations.map(issue => ({ id: issue.id, nodes: issue.nodes.map(node => node.target) })), [], `${theme} assignment accessibility`);
      await page.screenshot({ path: path.join(output, `${theme}-desktop.png`), fullPage: true });
      for (const [width, height] of [[1024, 768], [640, 640], [512, 384]]) {
        await page.setViewportSize({ width, height });
        // Open the real deadline control: a visible sticky footer alone does not
        // prove that the fields above it remain reachable in a short window.
        await page.getByRole("button", { name: "Срок исполнения: открыть выбор" }).click();
        await page.getByRole("button", { name: "Следующий месяц" }).waitFor();
        await page.keyboard.press("Escape");
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
        byteSize: 245760, contentType: "application/pdf", documentRole: "general", sha256: "b".repeat(64), uploadedByUserId: "executor", createdAt: "2026-11-23T12:00:00Z" },
        { id: "result-image", ownerType: "task", ownerId: "execution-task", fileName: "Подтверждение.png", byteSize: imageBytes.length,
          contentType: "image/png", documentRole: "general", sha256: "c".repeat(64), uploadedByUserId: "co", createdAt: "2026-11-23T12:10:00Z" }];
      personalMode = true;
      await page.goto(`${base}/qa/incoming-documents.html?theme=${theme}&domain=tasks`);
      await page.getByRole("tab", { name: "Мои письма 1" }).click();
      await page.getByRole("button", { name: /№ QA-184/ }).click();
      await page.getByText(executionDetail.resultText).waitFor();
      await page.getByText("Официальный ответ.pdf", { exact: true }).waitFor();
      await page.getByText("Файлы: 2", { exact: true }).waitFor();
      const activity = page.getByRole("region", { name: "Активность письма" });
      await activity.getByText("Исполнение завершено", { exact: true }).waitFor();
      assert.deepEqual(await activity.locator("li time").evaluateAll(times => times.map(time => time.dateTime)), [
        "2026-11-24T09:00:00Z", "2026-11-24T08:00:00Z", "2026-11-23T09:00:00Z",
        document.addedAt, document.registeredAt, document.receivedAt,
      ]);
      assert(await page.evaluate(() => {
        const result = document.querySelector(".incoming-result");
        return [".incoming-responsibility", ".incoming-originals"].every(selector =>
          Boolean(result.compareDocumentPosition(document.querySelector(selector)) & Node.DOCUMENT_POSITION_FOLLOWING));
      }), "The result and files precede responsibility and original documents");
      const imageFile = page.getByRole("button", { name: /Подтверждение.png/ });
      await imageFile.focus(); await page.keyboard.press("Enter");
      const viewer = page.getByRole("dialog");
      await viewer.getByRole("img", { name: "Подтверждение.png", exact: true }).waitFor();
      await viewer.getByRole("img", { name: "Подтверждение.png", exact: true }).evaluate(image => image.decode());
      const downloading = page.waitForEvent("download");
      await viewer.getByRole("button", { name: "Скачать", exact: true }).click();
      assert.equal((await downloading).suggestedFilename(), "Подтверждение.png");
      await page.waitForFunction(() => !!document.activeElement?.closest('[role="dialog"]'));
      await page.keyboard.press("Escape"); await viewer.waitFor({ state: "hidden" });
      await page.waitForFunction(() => document.activeElement?.textContent?.includes("Подтверждение.png"));
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
        await activity.getByText("Письмо поступило", { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(output, `${theme}-activity-${width}.png`), fullPage: true });
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
