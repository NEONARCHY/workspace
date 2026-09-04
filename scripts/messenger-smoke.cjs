// Run against the local demo API and Vite, never a production tenant.
// PLAYWRIGHT_MODULE may point to the bundled playwright package.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs/promises");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Local demo only");
  const output = path.resolve("tmp/messenger-smoke");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || "msedge" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("dilshod");
    await page.getByLabel(/Пароль/, { exact: false }).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.getByRole("button", { name: /Мессенджер/ }).click();
    if (process.env.SMOKE_INSPECT) {
      await page.getByRole("button", { name: "Участники и права", exact: true }).click();
      await page.getByRole("button", { name: "Закрыть", exact: true }).click();
      console.log(await page.locator("h2").evaluateAll((nodes) => nodes.map((node) => ({
        text: node.textContent, ancestors: [...(function* () { let n = node; while (n) { yield `${n.tagName}:${n.getAttribute('aria-hidden')}:${n.getAttribute('inert')}`; n = n.parentElement; } })()],
      }))));
      console.log("headings", await page.getByRole("heading").allTextContents());
      return;
    }
    await page.getByRole("button", { name: "Создать чат", exact: true }).click();
    await page.getByRole("textbox", { name: /Название группы/ }).fill("Тестовая команда · alpha 0.12");
    await page.getByRole("textbox", { name: "Описание группы" }).fill("Проверка личных групп, ответов и прав участников.");
    await page.getByRole("checkbox", { name: "Бахтиёр Самугов", exact: true }).check();
    await page.screenshot({ path: path.join(output, "01-create.png") });
    await page.getByRole("button", { name: "Создать группу", exact: true }).click();
    await page.getByRole("heading", { name: "Тестовая команда · alpha 0.12", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "Новое сообщение", exact: true }).fill("Обсуждаем запуск Workspace в этой группе.");
    await page.getByRole("button", { name: "Упомянуть участника", exact: true }).click();
    await page.getByRole("checkbox", { name: "@Бахтиёр Самугов", exact: true }).check();
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await page.getByRole("button", { name: /^Ответить:/ }).click();
    await page.getByRole("textbox", { name: "Новое сообщение", exact: true }).fill("Права выдаются отдельно для каждой группы.");
    await page.getByRole("button", { name: "Отправить сообщение", exact: true }).click();
    await page.locator(".message-scroll").getByText("Права выдаются отдельно для каждой группы.", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, "02-conversation.png") });
    await page.getByRole("button", { name: "Участники и права", exact: true }).click();
    await page.getByRole("button", { name: "Права: Бахтиёр Самугов", exact: true }).click();
    await page.getByLabel("Роль в группе", { exact: true }).selectOption("moderator");
    await page.getByRole("checkbox", { name: "Прикреплять файлы", exact: true }).uncheck();
    await page.screenshot({ path: path.join(output, "03-permissions.png") });
    await page.getByRole("button", { name: "Сохранить права", exact: true }).click();
    await page.locator(".chat-member-heading small").filter({ hasText: /^Администратор$/ }).waitFor();
    await page.getByRole("button", { name: "Закрыть", exact: true }).click();
    await page.setViewportSize({ width: 1180, height: 800 });
    await page.screenshot({ path: path.join(output, "04-compact.png") });
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth > innerWidth), false);
    const colleague = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await colleague.goto(origin);
    await colleague.getByRole("textbox", { name: /Логин/ }).fill("baxtiyor");
    await colleague.getByLabel(/Пароль/, { exact: false }).fill("Yuksalish-Local-2026!");
    await colleague.getByRole("button", { name: "Войти", exact: true }).click();
    await colleague.getByRole("heading", { name: "Тестовая команда · alpha 0.12", exact: true }).waitFor();
    assert(await colleague.getByRole("button", { name: "Прикрепить файл", exact: true }).isDisabled());
    await colleague.getByRole("button", { name: "Участники и права", exact: true }).click();
    assert.equal(await colleague.getByRole("button", { name: /^Права:/ }).count(), 0);
    await colleague.screenshot({ path: path.join(output, "05-delegated-admin.png") });
    assert.deepEqual(errors, []);
    console.log("PASS: ordinary employee creates a group, sends a reply/mention and delegates permissions. Screenshots:", output);
  } catch (error) {
    await page.screenshot({ path: path.join(output, "failure.png") });
    console.error((await page.locator("body").innerText()).slice(-4000));
    throw error;
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
