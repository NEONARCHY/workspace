// Personal mutations remain in memory. Real chats/content are read, never changed.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const defaultOrder = ["crm", "tasks", "payment_requests", "feed", "projects", "trip_approvals", "messenger", "calendar", "employees", "notifications", "settings"];
async function main() {
  const native = Boolean(process.env.ORGANIZATION_ELECTRON_EXE), origin = "http://127.0.0.1:5173";
  const output = path.resolve(`tmp/personal-organization-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let app, browser, page;
  if (native) {
    app = await electron.launch({ executablePath: path.resolve(process.env.ORGANIZATION_ELECTRON_EXE), args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] });
    page = await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8")).version);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 900));
  } else { browser = await chromium.launch({ channel: "msedge", headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); }
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let prefs = { pinnedChatIds: [], archivedChatIds: [], navigationOrder: [...defaultOrder], revision: 0 }, chats, rejectNext = false;
  await page.route("**/api/v1/workspace/bootstrap", async (route) => {
    const response = await route.fetch(), data = await response.json();
    chats = data.chats;
    await route.fulfill({ response, json: { ...data, personalPreferences: prefs } });
  });
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  await page.route("**/api/v1/personal-preferences/**", async (route) => {
    if (rejectNext) { rejectNext = false; await route.fulfill({ status: 503, json: { detail: "QA: сервер временно недоступен" } }); return; }
    const url = new URL(route.request().url()), body = route.request().postDataJSON();
    if (body.revision !== undefined && body.revision !== prefs.revision) { await route.fulfill({ status: 409, json: { detail: "QA: конфликт версий; обновите настройки" } }); return; }
    const next = structuredClone(prefs);
    if (url.pathname.includes("/chats/")) {
      const id = url.pathname.split("/").at(-1);
      assert(chats.some((chat) => chat.id === id));
      if (body.action === "pin") next.pinnedChatIds = [id, ...next.pinnedChatIds.filter((item) => item !== id)];
      if (["unpin", "archive"].includes(body.action)) next.pinnedChatIds = next.pinnedChatIds.filter((item) => item !== id);
      if (body.action === "archive") next.archivedChatIds = [...new Set([...next.archivedChatIds, id])];
      if (body.action === "unarchive") next.archivedChatIds = next.archivedChatIds.filter((item) => item !== id);
    } else if (url.pathname.endsWith("pinned-chats")) {
      assert.deepEqual([...body.chatIds].sort(), [...prefs.pinnedChatIds].sort()); next.pinnedChatIds = body.chatIds;
    } else if (url.pathname.endsWith("navigation")) { assert.deepEqual([...body.order].sort(), [...defaultOrder].sort()); next.navigationOrder = body.order; }
    else throw new Error(`Unexpected personal mutation: ${url.pathname}`);
    next.revision++; prefs = next;
    await route.fulfill({ status: 200, json: prefs });
  });
  const login = async () => {
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click(); await page.locator(".app-shell").waitFor();
  };
  const chatRow = (id) => page.locator(`.chat-list-item[data-chat-id="${id}"]`);
  const action = async (id, name) => {
    await chatRow(id).hover(); await chatRow(id).locator(".chat-more").click();
    await page.getByRole("menuitem", { name, exact: true }).click();
    await page.locator('.chat-list[aria-busy="false"]').waitFor();
  };
  const pinOrder = () => page.locator('.chat-list-item[data-pinned="true"]').evaluateAll((nodes) => nodes.map((node) => node.dataset.chatId));
  const navOrder = () => page.locator(".personal-rail-nav .rail-slot").evaluateAll((nodes) => nodes.map((node) => node.dataset.navigationKey));
  const waitPins = (order) => page.waitForFunction((order) => JSON.stringify([...document.querySelectorAll('.chat-list-item[data-pinned="true"]')].map((node) => node.dataset.chatId)) === JSON.stringify(order), order);
  try {
    if (!native) await page.goto(origin);
    await login(); assert(chats.length >= 2);
    const [first, second] = chats;
    await action(first.id, "Закрепить"); await action(second.id, "Закрепить"); await waitPins([second.id, first.id]);
    await chatRow(second.id).dragTo(chatRow(first.id)); await waitPins([first.id, second.id]);
    await action(first.id, "Переместить ниже"); await waitPins([second.id, first.id]);
    await page.screenshot({ path: path.join(output, "pinned.png") });
    await chatRow(first.id).locator(".chat-row").click();
    const composer = page.getByRole("textbox", { name: "Новое сообщение", exact: true });
    await composer.fill("Неотправленный черновик сохраняется при архивировании");
    await action(first.id, "В архив");
    await page.locator(".chat-archive-banner").waitFor();
    assert.equal(await chatRow(first.id).count(), 0);
    assert.equal(await composer.inputValue(), "Неотправленный черновик сохраняется при архивировании");
    await page.getByRole("button", { name: /^Архив/ }).click(); await chatRow(first.id).waitFor();
    await page.screenshot({ path: path.join(output, "archive.png") });
    await action(first.id, "Вернуть из архива"); await page.getByText("Архив пуст", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Чаты", exact: true }).click(); await chatRow(first.id).waitFor();
    assert.deepEqual(await pinOrder(), [second.id]);
    rejectNext = true; await action(first.id, "Закрепить");
    await page.getByRole("alert").filter({ hasText: "QA: сервер временно недоступен" }).waitFor();
    assert.deepEqual(await pinOrder(), [second.id]);
    await page.getByRole("button", { name: "Изменить порядок меню", exact: true }).click();
    await page.locator('[data-navigation-key="calendar"].navigation-edit-row').dragTo(page.locator('[data-navigation-key="crm"].navigation-edit-row'));
    assert.equal(await page.locator(".navigation-edit-row").first().getAttribute("data-navigation-key"), "calendar");
    await page.screenshot({ path: path.join(output, "navigation-editor.png") });
    await page.getByRole("button", { name: "Сохранить", exact: true }).click(); await page.locator(".personal-rail-nav").waitFor();
    assert.equal((await navOrder())[0], "calendar");
    // A fresh login reloads preferences from the response, not local storage.
    await page.reload(); await login(); await waitPins([second.id]); assert.equal((await navOrder())[0], "calendar");
    await page.getByRole("button", { name: "Изменить порядок меню", exact: true }).click();
    await page.getByRole("button", { name: "По умолчанию", exact: true }).click();
    await page.getByRole("button", { name: "Отмена", exact: true }).click(); assert.equal((await navOrder())[0], "calendar");
    await page.getByRole("button", { name: "Изменить порядок меню", exact: true }).click();
    await page.getByRole("button", { name: "По умолчанию", exact: true }).click();
    prefs.revision++; // Simulate another client editing while this editor is open.
    await page.getByRole("button", { name: "Сохранить", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "QA: конфликт" }).waitFor();
    await page.getByRole("button", { name: "Отмена", exact: true }).click();
    for (const width of [800, 640]) {
      if (native) await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 600), width);
      else await page.setViewportSize({ width, height: 600 });
      await page.getByRole("button", { name: "Изменить порядок меню", exact: true }).click();
      const overflow = await page.locator(".navigation-editor").evaluate((node) => node.scrollWidth > node.clientWidth + 2);
      assert.equal(overflow, false);
      await page.getByRole("button", { name: "Календарь: ниже", exact: true }).click();
      await page.getByRole("button", { name: "Сохранить", exact: true }).click(); await page.locator(".personal-rail-nav").waitFor();
      await page.screenshot({ path: path.join(output, `compact-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: pin/reorder by drag and keyboard alternatives, archive/restore with draft preservation, failure rollback, saved navigation/relogin, cancel/defaults/conflict, compact windows${native ? " in packaged Electron" : " in Edge"}; no personal preferences or chat mutations sent to server.`);
  } catch (error) { await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => undefined); throw error; }
  finally { if (app) await app.close(); if (browser) await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
