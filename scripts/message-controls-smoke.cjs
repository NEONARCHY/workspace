// Local demo only. Synthetic messages and all chat writes stay in this browser.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const output = path.resolve("tmp/message-controls-smoke");
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [];
  let lastOwn;
  let saved = false;
  let sent = false;
  const prepare = async (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
    await page.route("**/api/v1/chats/*/messages", async (route) => {
      assert.equal(route.request().method(), "POST");
      const payload = route.request().postDataJSON();
      lastOwn = { ...lastOwn, id: "qa-sent-own", body: payload.body, revision: 3 };
      sent = true;
      await route.fulfill({ json: lastOwn });
    });
    await page.route("**/api/v1/messages/qa-*", async (route) => {
      assert.equal(route.request().method(), "PATCH");
      const payload = route.request().postDataJSON();
      assert.equal(payload.expectedRevision, 3);
      lastOwn = { ...lastOwn, body: payload.body, revision: 4, editedAt: new Date().toISOString() };
      saved = true;
      await route.fulfill({ json: lastOwn });
    });
    await page.route("**/api/v1/workspace/bootstrap", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const chat = data.chats.find((item) => item.permissions.sendMessages);
      assert(chat, "Demo account needs a writable chat");
      if (!lastOwn) lastOwn = { id: "qa-last-own", chatId: chat.id, authorId: data.currentUser.id, body: "Счёт проверен, можно запускать согласование.", time: "12:01", createdAt: new Date().toISOString(), revision: 3, canEdit: true };
      data.chats = [{ ...chat, title: "Проверка интерфейса сообщений", unread: 0 }];
      data.messages = [
        { ...lastOwn, id: "qa-older-own", body: "Документы по проекту подготовлены.", revision: 1 },
        lastOwn,
        { ...lastOwn, id: "qa-incoming", authorId: data.people.find((person) => person.id !== data.currentUser.id).id, body: "Спасибо, сейчас посмотрю.", canEdit: false },
      ];
      data.attachments = [];
      await route.fulfill({ response, json: data });
    });
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("aziza");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="Мессенджер"]').click();
    await page.locator(".chat-row").first().click();
    await page.locator(".message.own").last().waitFor();
  };
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 800 } });
    await prepare(page);
    const message = page.locator(".message.own").last();
    const actions = message.locator(".message-actions");
    const opacity = (value) => page.waitForFunction(({ value }) => getComputedStyle(document.querySelectorAll(".message.own .message-actions")[1]).opacity === value, { value });
    await page.mouse.move(0, 0);
    await opacity("0");
    const before = await message.boundingBox();
    await page.screenshot({ path: path.join(output, "rest.png") });
    await message.locator(".message-body").hover();
    await opacity("1");
    assert.deepEqual(await message.boundingBox(), before, "Hover must not move or resize messages");
    assert.equal(await actions.locator("button").first().evaluate((el) => getComputedStyle(el).fontSize), "11px");
    await page.screenshot({ path: path.join(output, "hover.png") });
    await page.mouse.move(0, 0);
    await opacity("0");
    await message.getByRole("button", { name: /^Ответить:/ }).focus();
    await page.keyboard.press("Tab");
    await opacity("1");
    assert(await message.getByRole("button", { name: /^Создать задачу/ }).evaluate((el) => el === document.activeElement));
    const composer = page.getByLabel("Новое сообщение", { exact: true });
    await composer.fill("Мой черновик");
    await composer.press("ArrowUp");
    assert.equal(await page.getByLabel("Изменить текст сообщения").count(), 0);
    assert.equal(await composer.inputValue(), "Мой черновик");
    await composer.press("Enter");
    await page.waitForFunction(() => document.querySelector('input[aria-label="Новое сообщение"]').value === "" && !document.querySelector('input[aria-label="Новое сообщение"]').disabled);
    assert(sent);
    assert(await composer.evaluate((el) => el === document.activeElement), "Sending must return focus to composer");
    await page.keyboard.press("ArrowUp");
    const editor = page.getByLabel("Изменить текст сообщения");
    assert.equal(await editor.inputValue(), lastOwn.body);
    assert(await editor.evaluate((el) => el === document.activeElement));
    await editor.press("Escape");
    assert(await composer.evaluate((el) => el === document.activeElement));
    await composer.press("ArrowUp");
    await editor.fill("Счёт проверен. Можно запускать согласование.");
    await page.getByRole("button", { name: "Сохранить сообщение" }).click();
    await editor.waitFor({ state: "detached" });
    assert(saved);
    assert.equal(await message.locator("p").innerText(), "Счёт проверен. Можно запускать согласование.");
    await page.setViewportSize({ width: 640, height: 480 });
    await composer.press("ArrowUp");
    assert(await editor.isVisible());
    await page.screenshot({ path: path.join(output, "compact-edit.png") });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert(await actions.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) < 0.01));
    const touchContext = await browser.newContext({ viewport: { width: 640, height: 640 }, hasTouch: true, isMobile: true });
    const touchPage = await touchContext.newPage();
    await prepare(touchPage);
    const touchActions = touchPage.locator(".message.own .message-actions").last();
    assert.equal(await touchActions.evaluate((el) => getComputedStyle(el).opacity), "1");
    assert((await touchActions.locator("button").first().boundingBox()).height >= 36);
    await touchPage.screenshot({ path: path.join(output, "touch.png") });
    assert.deepEqual(errors, []);
    console.log("PASS: hover/focus/touch, stable layout, compact controls, draft protection, ArrowUp edit/save/Escape, reduced motion; no message writes to server.");
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
