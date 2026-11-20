// Synthetic fixtures only; all API calls are intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const origin = process.env.ADMIN_MODE_QA_ORIGIN || "http://127.0.0.1:5184";
const out = path.resolve("tmp/admin-mode");
const navigationOrder = ["home", "messenger", "tasks", "payment_requests", "feed", "calendar", "employees", "team_overview", "settings"];
const person = { id: "admin", username: "admin", name: "Тестовый администратор", initials: "ТА", role: "admin", color: "#0091a8", jobTitle: "Specialist" };
const permissions = { sendMessages: true, uploadFiles: true, inviteMembers: true, manageMembers: true, editInfo: true };
const chats = ["Первый закреплённый", "Второй закреплённый"].map((title, index) => ({
  id: `chat-${index}`, title, kind: "group", preview: "Тестовая переписка", time: "12:00", unread: 0, description: "", permissions, members: [],
}));
(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let currentPage;
  try {
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addCookies([{ name: "__Host-yuksalish_csrf", value: "qa", domain: "127.0.0.1", path: "/", secure: true, sameSite: "Strict" }]);
      const page = await context.newPage();
      currentPage = page;
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      let enabled = true, administrator = true, changes = 0;
      let pinnedChatIds = chats.map(chat => chat.id), revision = 0;
      const user = () => ({ ...person, role: administrator && enabled ? "admin" : "employee", adminModeEnabled: administrator ? enabled : null });
      await page.route("**/api/v1/**", async route => {
        const url = new URL(route.request().url());
        if (/\/auth\/web\/(refresh|login)$/.test(url.pathname)) return route.fulfill({ json: { accessToken: "qa-token", expiresIn: 900, user: user() } });
        if (url.pathname.endsWith("/auth/admin-mode")) {
          enabled = route.request().postDataJSON().enabled; changes++;
          return route.fulfill({ json: user() });
        }
        if (url.pathname.endsWith("/workspace/bootstrap")) return route.fulfill({ json: {
          currentUser: user(), people: [user()], positions: [], departments: [], chats, messages: [], tasks: [], requests: [], projects: [], tripRequests: [], feedPosts: [], calendarEvents: [], notifications: [], attachments: [], workflow: null, requestWorkflows: [],
          personalPreferences: { pinnedChatIds, archivedChatIds: [], navigationOrder, revision },
          notificationPreferences: { desktopEnabled: false },
        } });
        if (url.pathname.endsWith("/personal-preferences/pinned-chats")) {
          pinnedChatIds = route.request().postDataJSON().chatIds; revision++;
          return route.fulfill({ json: { pinnedChatIds, archivedChatIds: [], navigationOrder, revision } });
        }
        return route.fulfill({ status: 204, body: "" });
      });
      await page.goto(origin);
      const toggle = page.getByRole("switch", { name: "Режим администратора" });
      await toggle.waitFor();
      console.log(`Checking ${width}: shell ready`);
      assert.equal(await toggle.getAttribute("aria-checked"), "true");
      if (width >= 1024) {
        const search = await page.locator(".section-jump-trigger").boundingBox();
        const hero = await page.locator(".home-hero").boundingBox();
        assert(search && hero, "home hero and search visible");
        assert(Math.abs(search.x - hero.x) <= 1, `search ${search.x} aligns with hero ${hero.x}`);
      }
      await toggle.scrollIntoViewIfNeeded();
      await toggle.focus(); await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Режим администратора"]')?.getAttribute("aria-checked") === "false");
      assert.equal(changes, 1);
      console.log(`Checking ${width}: ordinary mode restored`);
      await toggle.click();
      await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Режим администратора"]')?.getAttribute("aria-checked") === "true");
      assert.equal(changes, 2);
      console.log(`Checking ${width}: administrator mode restored`);
      if (width === 1440) {
        await page.getByRole("button", { name: "Мессенджер", exact: true }).click();
        const first = page.locator('.chat-list-item[data-chat-id="chat-0"] .chat-row');
        const second = page.locator('.chat-list-item[data-chat-id="chat-1"] .chat-row');
        await first.waitFor(); await first.hover();
        assert.equal(await first.evaluate(node => getComputedStyle(node).cursor), "pointer");
        const a = await first.boundingBox(), b = await second.boundingBox();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await page.mouse.down();
        await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2 + 14, { steps: 4 });
        await page.waitForTimeout(100);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height - 5, { steps: 12 });
        await page.mouse.up();
        await page.waitForFunction(() => document.querySelector('.chat-list-item[data-pinned="true"]')?.getAttribute("data-chat-id") === "chat-1");
        assert.deepEqual(pinnedChatIds, ["chat-1", "chat-0"]);
      }
      await page.screenshot({ path: path.join(out, `admin-${width}.png`) });
      administrator = false;
      await page.reload(); await page.locator(".app-shell").waitFor();
      assert.equal(await toggle.count(), 0, "ordinary employees have no admin toggle");
      assert.deepEqual(errors, []);
      console.log(`PASS ${width}: admin off/on, restore, employee exclusion${width === 1440 ? ", pointer and pinned reorder" : ""}`);
      await context.close();
    }
  } catch (error) {
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({ path: path.join(out, "failure.png") });
      await fs.writeFile(path.join(out, "failure.html"), await currentPage.content());
    }
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
