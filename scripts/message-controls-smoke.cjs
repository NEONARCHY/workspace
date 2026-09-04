// Local demo only. Synthetic messages and all chat writes stay in this browser.
const { chromium, _electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.MESSAGE_ELECTRON_EXE);
  const output = path.resolve(`tmp/message-controls-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  const browser = native ? undefined : await chromium.launch({ channel: "msedge", headless: true });
  const app = native ? await _electron.launch({ executablePath: path.resolve(process.env.MESSAGE_ELECTRON_EXE), args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] }) : undefined;
  const errors = [];
  const sessions = [], captures = [];
  let lastOwn;
  let saved = false;
  let sent = false;
  const prepare = async (page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", response => {
      const url = new URL(response.url());
      if (["localhost", "127.0.0.1"].includes(url.hostname) && /\/auth\/(login|refresh)$/.test(url.pathname) && response.ok()) captures.push(response.json().then(data => sessions.push({ token: data.accessToken, origin: url.origin })));
    });
    await page.route("**/api/v1/**", route => {
      const request = route.request(), pathname = new URL(request.url()).pathname;
      if (request.method() === "GET" || pathname.startsWith("/api/v1/auth/")) return route.continue();
      return route.fulfill({ status: 503, json: { detail: "QA: запись перехвачена" } });
    });
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
      if (!lastOwn) lastOwn = { id: "qa-last-own", chatId: chat.id, authorId: data.currentUser.id, body: "Готово.", time: "12:01", createdAt: new Date().toISOString(), revision: 3, canEdit: true };
      data.chats = [{ ...chat, title: "Проверка интерфейса сообщений", unread: 0 }];
      data.messages = [
        { ...lastOwn, id: "qa-older-own", body: "Документы по проекту подготовлены.", revision: 1 },
        lastOwn,
        { ...lastOwn, id: "qa-incoming", authorId: data.people.find((person) => person.id !== data.currentUser.id).id, body: "Спасибо, сейчас посмотрю.", canEdit: false },
      ];
      data.attachments = [];
      await route.fulfill({ response, json: data });
    });
    if (!native) await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill("aziza");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="Мессенджер"]').click();
    await page.locator(".chat-row").first().click();
    await page.locator(".message.own").last().waitFor();
  };
  try {
    if (native) assert.equal(await app.evaluate(({ app }) => app.getVersion()), require("../apps/desktop/package.json").version);
    const page = native ? await app.firstWindow() : await browser.newPage({ viewport: { width: 1180, height: 800 } });
    const resize = async (width, height) => {
      if (native) await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
      else await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const screenshot = async name => {
      if (native) {
        const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
        await fs.writeFile(path.join(output, `${name}.png`), Buffer.from(png, "base64"));
      } else await page.screenshot({ path: path.join(output, `${name}.png`) });
    };
    const axeScan = async () => {
      await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
      // Scan the application, not Tabster's hidden body-level focus sentinels.
      const issues = await page.evaluate(async () => (await axe.run(".app-shell", { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })));
      assert.deepEqual(issues, []);
    };
    await prepare(page);
    await resize(1180, 800); await page.evaluate(() => document.fonts.ready);
    const message = page.locator(".message.own").last();
    const actions = message.locator(".message-actions");
    const opacity = (value) => page.waitForFunction(({ value }) => getComputedStyle(document.querySelectorAll(".message.own .message-actions")[1]).opacity === value, { value });
    await page.mouse.move(0, 0);
    await opacity("0");
    const before = await message.boundingBox();
    const bubble = await message.locator(".message-body").boundingBox();
    assert.equal(await message.locator(".message-body .message-actions").count(), 0);
    assert(bubble.height <= 70 && bubble.width < (await actions.boundingBox()).width, "Short bubbles contain only text and time, not space for actions");
    await screenshot("rest");
    await message.locator(".message-body").hover();
    await opacity("1");
    assert.deepEqual(await message.boundingBox(), before, "Hover must not move or resize messages");
    assert.equal(await actions.locator("button").first().evaluate((el) => getComputedStyle(el).fontSize), "11px");
    assert.deepEqual(await message.locator(".message-body").boundingBox(), bubble);
    assert((await actions.boundingBox()).y >= bubble.y + bubble.height, "Actions sit below the bubble");
    await actions.locator("button").first().hover(); await opacity("1");
    await screenshot("hover"); await axeScan();
    for (const [width, height] of native ? [[960, 720], [640, 480]] : [[960, 720], [640, 480], [320, 640]]) {
      await resize(width, height); await message.locator(".message-body").hover(); await opacity("1");
      assert(await actions.evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && el.scrollWidth <= el.clientWidth + 1; }), "Actions stay within the message column");
      await axeScan(); await screenshot(`width-${width}`);
    }
    await resize(1180, 800);
    if (native) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
      await message.locator(".message-body").hover(); await opacity("1"); await axeScan(); await screenshot("zoom-200");
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    }
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
    await resize(640, 480);
    await composer.press("ArrowUp");
    assert(await editor.isVisible());
    await page.getByRole("button", { name: "Сохранить сообщение" }).scrollIntoViewIfNeeded();
    await screenshot("compact-edit");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert(await actions.evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) < 0.01));
    if (browser) {
    const touchContext = await browser.newContext({ viewport: { width: 320, height: 640 }, hasTouch: true, isMobile: true });
    const touchPage = await touchContext.newPage();
    await prepare(touchPage);
    const touchActions = touchPage.locator(".message.own .message-actions").last();
    assert.equal(await touchActions.evaluate((el) => getComputedStyle(el).opacity), "1");
    assert((await touchActions.locator("button").first().boundingBox()).height >= 36);
    await touchActions.scrollIntoViewIfNeeded();
    await touchPage.screenshot({ path: path.join(output, "touch.png") });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${native ? "packaged Electron and 200% zoom" : "browser and touch"}, hover/focus, stable layout, compact controls, draft protection, ArrowUp edit/save/Escape, reduced motion; no message writes to server.`);
  } finally {
    if (app) await app.close();
    if (browser) await browser.close();
    await Promise.all(captures);
    for (const { token, origin: apiOrigin } of sessions) {
      const headers = { Authorization: `Bearer ${token}` };
      const before = await fetch(`${apiOrigin}/api/v1/auth/sessions`, { headers, signal: AbortSignal.timeout(10000) });
      if (before.status === 401) continue;
      assert.equal((await fetch(`${apiOrigin}/api/v1/auth/logout`, { method: "POST", headers, signal: AbortSignal.timeout(10000) })).status, 204);
      let status;
      for (let attempt = 0; attempt < 8; attempt++) {
        status = (await fetch(`${apiOrigin}/api/v1/auth/sessions`, { headers, signal: AbortSignal.timeout(10000) })).status;
        if (status === 401) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.equal(status, 401);
    }
    console.log("Owned QA sessions revoked; existing sessions untouched.");
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
