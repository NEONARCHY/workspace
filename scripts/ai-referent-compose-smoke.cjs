// Isolated UI regression check. All API requests are intercepted; no real login or business writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5187";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const output = path.resolve("tmp/ai-referent-compose");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [], writes = [];
  let reviewersAvailable = false;
  page.on("pageerror", (error) => errors.push(error.message));
  const check = { id: "check", status: "passed", reviewerKeys: ["umid"], detail: "" };
  let letter = {
    id: "letter-qa", subject: "Письмо партнёру", recipientOrganization: "Организация-получатель",
    recipientAddress: "office@example.test", route: "webmail", note: "", status: "draft",
    workflowKind: "delivery", source: "workspace", createdByUserId: "author",
    createdByName: "Автор письма", reviewerUserId: "reviewer", reviewerName: "Ражабов Умид Мажидович",
    revision: 3, createdAt: "2026-09-29T10:00:00Z", updatedAt: "2026-09-29T10:00:00Z",
    documentCheck: check, availableActions: ["submit", "cancel"], canEdit: true, canDelete: true,
    attachments: [{ id: "document", fileName: "Письмо.docx", byteSize: 1234, documentRole: "primary" }],
    events: [{ id: "event", actorName: "Автор письма", createdAt: "2026-09-29T10:00:00Z", toStatus: "draft", comment: "Черновик создан в Workspace." }],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    if (request.method() !== "GET") writes.push({ endpoint, method: request.method() });
    let data;
    if (endpoint.endsWith("/authority")) data = { writable: true, mode: "legacy" };
    else if (endpoint.endsWith("/reviewers")) {
      if (!reviewersAvailable) return route.fulfill({ status: 503, json: { detail: "Список временно недоступен" } });
      data = { revision: 1, runtimes: [], reviewers: [
        { key: "umid", userId: "reviewer", fullName: "Ражабов Умид Мажидович", canApprove: true },
      ] };
    }
    else if (endpoint.endsWith("/incoming")) data = { letters: [], totalCount: 0, filteredCount: 0, registeredCount: 0, attentionCount: 0, withAttachmentsCount: 0, journal: { available: false } };
    else if (endpoint.endsWith("/recipients")) data = { entries: [], totalCount: 0 };
    else if (endpoint.endsWith("/document-checks")) data = check;
    else if (endpoint.endsWith("/actions")) {
      assert.equal(request.postDataJSON().action, "submit");
      letter = { ...letter, status: "pending_review", canEdit: false, availableActions: [], revision: 4 };
      data = letter;
    } else if (endpoint.endsWith("/letters")) data = request.method() === "GET"
      ? { letters: [letter], totalCount: 1, pendingReviewCount: 0, readyCount: 0, sentCount: 0, signedCount: 0 } : letter;
    else if (endpoint.endsWith("/letters/letter-qa")) data = letter;
    else if (endpoint.startsWith("/api/v1/attachments/")) data = letter.attachments[0];
    else { errors.push("Unexpected API request: " + endpoint); return route.fulfill({ status: 404, json: {} }); }
    return route.fulfill({ json: data });
  });
  const stable = () => page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter((animation) =>
      Number(animation.effect?.getComputedTiming().endTime) < 2000
    ).map((animation) => animation.finished.catch(() => undefined)));
  });
  try {
    await page.goto(origin + "/qa/ai-referent.html");
    await page.getByRole("button", { name: "Новое письмо", exact: true }).click();
    const reviewer = page.getByRole("combobox", { name: "Согласующий", exact: true });
    const retry = page.getByRole("button", { name: "Обновить согласующих" });
    await retry.waitFor();
    assert.equal(await reviewer.isDisabled(), true);
    reviewersAvailable = true;
    await retry.click();
    await page.waitForFunction(() => !document.querySelector('[aria-labelledby="referent-reviewer-label"]').disabled);
    await page.getByRole("button", { name: "Ввести вручную" }).click();
    await page.getByRole("textbox", { name: "Организация-получатель" }).fill("Партнёр");
    const address = page.getByRole("textbox", { name: "Адрес или получатель" });
    await address.fill("office@EXAT.UZ");
    const channel = page.getByRole("combobox", { name: "Канал отправки" });
    await channel.click();
    assert.equal(await page.getByRole("option", { name: "Webmail", exact: true }).getAttribute("aria-disabled"), "true");
    await page.keyboard.press("Escape");
    await address.fill("office@example.test");
    await page.getByRole("group", { name: "Сохранение нового адресата" }).getByText("Сохранить введённый адрес в справочник?").waitFor();
    await page.getByRole("button", { name: "Нет, только для письма" }).click();
    await channel.click();
    assert.equal(await page.getByRole("option", { name: "E-XAT", exact: true }).getAttribute("aria-disabled"), "true");
    await page.keyboard.press("Escape");
    await reviewer.click();
    await page.getByRole("option", { name: "Ражабов Умид Мажидович" }).click();
    await page.getByLabel("Выбрать основной документ DOCX", { exact: true }).setInputFiles({ name: "Письмо.docx", mimeType: "application/octet-stream", buffer: Buffer.from("QA intercepted document") });
    await page.getByText("С письмом всё в порядке.", { exact: false }).waitFor();
    for (const [width, height] of [[1440, 960], [1024, 768], [640, 480]]) {
      await page.setViewportSize({ width, height }); await stable();
      const layout = await page.locator(".ai-referent-form-dialog").evaluate((dialog) => {
        const avatar = dialog.querySelector(".workspace-select-person-avatar").getBoundingClientRect();
        const field = dialog.querySelector(".workspace-select-person-wrap").getBoundingClientRect();
        const footer = dialog.querySelector(".ai-referent-form-actions").getBoundingClientRect();
        return { avatarInside: avatar.top >= field.top && avatar.bottom <= field.bottom,
          footerVisible: footer.top >= 0 && footer.bottom <= innerHeight,
          overflow: dialog.scrollWidth - dialog.clientWidth };
      });
      assert(layout.avatarInside && layout.footerVisible && layout.overflow <= 2, JSON.stringify(layout));
      await page.screenshot({ path: path.join(output, "compose-" + width + ".png") });
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("button", { name: "Отправить на согласование", exact: true }).click();
    await page.locator(".ai-referent-detail-dialog").waitFor(); await stable();
    assert.equal(writes.filter((entry) => entry.endpoint.endsWith("/actions")).length, 1);
    assert.equal(letter.status, "pending_review");
    for (const [width, height] of [[1440, 960], [1024, 768], [640, 480]]) {
      await page.setViewportSize({ width, height }); await stable();
      let expected;
      for (const tab of ["Обзор", "Документы · 1", "История · 1"]) {
        await page.getByRole("tab", { name: tab, exact: true }).click(); await stable();
        const layout = await page.locator(".ai-referent-detail-dialog").evaluate((dialog) => {
          const rect = dialog.getBoundingClientRect();
          const tabs = dialog.querySelector(".ai-referent-detail-tabs").getBoundingClientRect();
          const footer = dialog.querySelector(".ai-referent-detail-actions").getBoundingClientRect();
          return { width: rect.width, height: rect.height, top: rect.top,
            tabsHeight: tabs.height, footerHeight: footer.height,
            fits: rect.top >= 0 && rect.bottom <= innerHeight && footer.bottom <= innerHeight };
        });
        assert(layout.fits && layout.tabsHeight < 60 && layout.footerHeight < 150, JSON.stringify(layout));
        if (expected) assert.deepEqual([layout.width, layout.height, layout.top], expected);
        else expected = [layout.width, layout.height, layout.top];
        await page.screenshot({ path: path.join(output, "detail-" + width + "-" + tab.split(" ")[0] + ".png") });
      }
    }
    letter = { ...letter, status: "draft", canEdit: true, availableActions: ["submit", "cancel"],
      attachments: [...letter.attachments, { id: "appendix", fileName: "Приложение.pdf", byteSize: 500, documentRole: "additional" }] };
    await page.goto(origin + "/qa/ai-referent.html?detail");
    await page.getByRole("button", { name: "Редактировать", exact: true }).click();
    await page.getByRole("list", { name: "Сохранённое письмо", exact: true }).getByText("Письмо.docx", { exact: false }).waitFor();
    await page.getByRole("list", { name: "Сохранённые вложения" }).getByText("Приложение.pdf", { exact: false }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Скачать Письмо.docx" }).isEnabled(), true);
    const uploadsBefore = writes.filter((entry) => entry.endpoint.startsWith("/api/v1/attachments/")).length;
    await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click();
    await page.getByRole("button", { name: "Редактировать", exact: true }).waitFor();
    assert.equal(writes.filter((entry) => entry.endpoint.startsWith("/api/v1/attachments/")).length, uploadsBefore);
    assert.equal(writes.filter((entry) => entry.endpoint.endsWith("/actions")).length, 1);
    assert.equal(letter.status, "draft");
    assert.deepEqual(errors, []);
    console.log("PASS: 12 layouts, stable tabs/footer, reviewer avatar, channel lock, preflight, one submission; saved draft files visible and no reuploads. No real writes.");
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") }); throw error;
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
