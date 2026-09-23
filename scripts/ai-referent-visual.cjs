// Read-only visual smoke: every API response is intercepted with invented records.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const person = { id: "reviewer-1", username: "reviewer", name: "Руководитель отдела", initials: "РО", role: "admin", status: "active", color: "#0091a8" };
const incoming = Array.from({ length: 56 }, (_, index) => ({
  id: `incoming-${index}`, agentId: "demo-agent", externalId: `${index}`, sequenceNumber: `${index + 1}`,
  platformIncomingNumber: `0${100 + index}/26/AI`, senderLetterNumber: `02-${index + 1}`,
  receivedAt: "2026-09-23T09:15:00Z", senderOrganization: "Региональное управление",
  senderPerson: "Канцелярия", subject: index % 3 === 0 ? "Ответ на запрос о документах для проекта" : "Материалы по совместной работе",
  responsibleExternalId: "reviewer", responsibleDisplayName: "Руководитель отдела", responsibleUserId: "reviewer-1",
  responsibleUserName: "Руководитель отдела", urgency: "normal", hasAttachments: true,
  attachmentsCount: 2, mainDocumentFilename: "Письмо.pdf", platformRecordId: `p-${index}`,
  status: index % 9 === 0 ? "needs_review" : "platform_submitted", fallbackUsed: false, errorMessage: "",
  source: "exat", revision: 1, createdAt: "2026-09-23T09:15:00Z", updatedAt: "2026-09-23T09:15:00Z",
}));
const outgoing = Array.from({ length: 40 }, (_, index) => ({
  id: `outgoing-${index}`, subject: "Письмо о согласовании рабочего плана", recipientOrganization: "Партнёрская организация",
  recipientAddress: "Канцелярия", route: "exat", note: "", status: index % 5 === 0 ? "pending_review" : "sent",
  source: "workspace", createdByUserId: "reviewer-1", createdByName: "Руководитель отдела",
  reviewerUserId: "reviewer-1", reviewerName: "Руководитель отдела", revision: 1,
  displayNumber: `0${300 + index}/26-AI`, createdAt: "2026-09-23T09:15:00Z", updatedAt: "2026-09-23T09:15:00Z",
  attachments: [], events: [], availableActions: [], canEdit: false,
}));
const archive = Array.from({ length: 25 }, (_, index) => ({
  id: `archive-${index}`, displayNumber: `0${200 + index}/25-AI`, subject: "Архивное письмо о программе сотрудничества",
  recipientOrganization: "Партнёрская организация", senderName: "Руководитель отдела", route: "exat", status: "Отправлено",
}));
const reviewers = ["Аскар", "Бобур", "Умид", "Давронбек"].map((label, index) => ({
  key: ["askar", "bobur", "umid", "davronbek"][index], label, suggestedUsername: "reviewer", userId: "reviewer-1",
  username: "reviewer", fullName: "Руководитель отдела", telegramId: null, enabled: true, canApprove: true,
}));

async function main() {
  const output = path.resolve("tmp/ai-referent-visual");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error" && !message.text().includes("WebSocket connection to")) errors.push(message.text());
  });
  await page.route("**/api/v1/**", route => {
    const url = route.request().url();
    if (url.endsWith("/auth/web/login")) return route.fulfill({ json: { accessToken: "visual-token", tokenType: "bearer", expiresIn: 900, user: person } });
    if (url.endsWith("/workspace/bootstrap")) return route.fulfill({ json: { currentUser: person, canCreatePaymentRequests: true, people: [person], positions: [], chats: [], messages: [], tasks: [], requests: [], projects: [], tripRequests: [], feedPosts: [], calendarEvents: [], notifications: [], attachments: [], workflow: null, requestWorkflows: [], notificationPreferences: { desktopEnabled: false } } });
    if (url.endsWith("/directory")) return route.fulfill({ json: { people: [person], departments: [], positions: [] } });
    if (url.includes("/ai-referent/incoming")) return route.fulfill({ json: { letters: incoming, totalCount: incoming.length, registeredCount: 50, attentionCount: 6, withAttachmentsCount: 56, lastSyncAt: "2026-09-23T09:15:00Z", journal: { available: true, fileName: "register.xlsx", updatedAt: "2026-09-23T09:15:00Z" } } });
    if (url.includes("/ai-referent/letters")) return route.fulfill({ json: { letters: outgoing, totalCount: outgoing.length, pendingReviewCount: 8, readyCount: 0, sentCount: 32 } });
    if (url.includes("/ai-referent/reviewers") || url.includes("/ai-referent/configuration")) return route.fulfill({ json: { revision: 1, updatedAt: "2026-09-23T09:15:00Z", reviewers, runtimes: [] } });
    if (url.includes("/ai-referent/archive")) return route.fulfill({ json: { letters: archive } });
    if (url.includes("/ai-referent/journals")) return route.fulfill({ json: { files: [] } });
    if (url.includes("/ai-referent/recipients")) return route.fulfill({ json: {
      entries: [{ id: "org-1", name: "Министерство развития", categoryKey: "ministries", addresses: ["ORG-001"], route: "exat", addressBookOrganization: "Министерство развития" },
        { id: "org-2", name: "Агентство образования", categoryKey: "agencies", addresses: ["ORG-002"], route: "exat", addressBookOrganization: "Агентство образования" }],
      totalCount: 2, updatedAt: "2026-09-23T09:15:00Z",
    } });
    if (url.includes("/ai-referent/telegram-link")) return route.fulfill({ json: { telegramId: null } });
    if (url.includes("/ai-referent/packets")) return route.fulfill({ json: { files: [{ id: "file-1", name: "original/Письмо.pdf", byteSize: 245760, sha256: "a", source: "packet", createdAt: "2026-09-23T09:15:00Z" }] } });
    return route.fulfill({ status: 204, body: "" });
  });
  try {
    await page.goto(process.env.YUKSALISH_VISUAL_URL || "http://127.0.0.1:4173");
    await page.getByRole("textbox", { name: /Логин/ }).fill("visual");
    await page.getByLabel(/Пароль/).fill("visual-only");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="AI Referent"]').click();
    try {
      await page.getByText("Материалы по совместной работе").first().waitFor({ timeout: 6000 });
    } catch (error) {
      await page.screenshot({ path: path.join(output, "startup-failure.png") });
      console.error((await page.locator("body").innerText()).slice(0, 1200), errors);
      throw error;
    }
    await page.evaluate(() => document.fonts.ready);
    for (const [width, height, suffix] of [[1440, 900, "1440"], [1024, 768, "1024"], [800, 640, "800"]]) {
      await page.setViewportSize({ width, height });
      const box = await page.locator(".ai-incoming-table-wrap").evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
      await page.screenshot({ path: path.join(output, `incoming-${suffix}.png`) });
      assert.ok(box.client > 80, `incoming list should remain visible at ${width}: ${JSON.stringify(box)}`);
      assert.ok(box.scroll > box.client, `incoming list must scroll at ${width}: ${JSON.stringify(box)}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Пакет документов" }).first().click();
    await page.getByRole("dialog", { name: "Пакет документов" }).waitFor();
    await page.getByRole("dialog", { name: "Пакет документов" }).getByText("Письмо.pdf").waitFor();
    assert.ok(await page.locator(".ai-referent-file-info").first().evaluate(node => node.clientWidth > 120));
    await page.waitForTimeout(400); // Let the Fluent dialog entrance finish before the visual capture.
    await page.screenshot({ path: path.join(output, "packet.png") });
    await page.getByRole("button", { name: "Закрыть пакет" }).click();
    await page.getByRole("tab", { name: "Исходящие" }).click();
    await page.getByText("Письмо о согласовании рабочего плана").first().waitFor();
    const list = await page.locator(".ai-referent-list").evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
    assert.ok(list.scroll > list.client, "outgoing list must scroll");
    await page.screenshot({ path: path.join(output, "outgoing.png") });
    await page.setViewportSize({ width: 800, height: 640 });
    const compactList = await page.locator(".ai-referent-list").evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight }));
    assert.ok(compactList.client > 80, `outgoing list should remain visible at 800: ${JSON.stringify(compactList)}`);
    await page.screenshot({ path: path.join(output, "outgoing-800.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "Новое письмо" }).click();
    const compose = page.getByRole("dialog", { name: "Новое исходящее письмо" });
    await compose.waitFor();
    await compose.getByRole("button", { name: /Министерство развития/ }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, "compose.png") });
    await compose.getByRole("textbox", { name: "Поиск адресата" }).fill("развития");
    await compose.getByRole("button", { name: /Министерство развития/ }).click();
    await compose.getByText("ORG-001").waitFor();
    await page.screenshot({ path: path.join(output, "compose-recipient-selected.png") });
    await compose.locator('input[type="file"]').first().setInputFiles({ name: "Письмо.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("visual-only") });
    await compose.locator('input[type="file"]').nth(1).setInputFiles({ name: "Приложение.pdf", mimeType: "application/pdf", buffer: Buffer.from("visual-only") });
    await compose.getByText("Письмо.docx").waitFor();
    await compose.getByText("Приложение.pdf").waitFor();
    await page.setViewportSize({ width: 800, height: 640 });
    await page.screenshot({ path: path.join(output, "compose-800-files.png") });
    await compose.locator(".fui-DialogContent").evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.screenshot({ path: path.join(output, "compose-800-selected.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await compose.getByRole("button", { name: "Отмена" }).click();
    await page.locator(".ai-referent-row").first().click();
    const detail = page.getByRole("dialog");
    await detail.getByRole("tab", { name: "Документы · 0" }).click();
    await detail.getByText("Файл письма ещё не приложен.").waitFor();
    await detail.getByRole("tab", { name: "История · 0" }).click();
    await detail.getByRole("tab", { name: "Обзор" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(output, "outgoing-detail.png") });
    await detail.getByRole("button", { name: "Закрыть" }).click();
    await page.getByRole("tab", { name: "Согласующие" }).click();
    await page.getByText("Люди и каналы").waitFor();
    await page.screenshot({ path: path.join(output, "reviewers.png") });
    await page.getByRole("tab", { name: "Архив и журналы" }).click();
    await page.getByText("Архивное письмо о программе сотрудничества").first().waitFor();
    await page.screenshot({ path: path.join(output, "archive.png") });
    await page.getByRole("tab", { name: "Мой Telegram" }).click();
    await page.getByText("Подключите личный Telegram").waitFor();
    await page.screenshot({ path: path.join(output, "telegram.png") });
    assert.deepEqual(errors, []);
    console.log(`PASS: AI Referent visual smoke: ${output}`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
