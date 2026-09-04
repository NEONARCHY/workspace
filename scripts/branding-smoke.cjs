// Read-only local branding/layout checks; no messages, invitations or decisions are sent.
const { chromium, _electron: electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  const native = Boolean(process.env.BRANDING_ELECTRON_EXE);
  const output = path.resolve(`tmp/branding-smoke${native ? "-desktop" : ""}`);
  await fs.mkdir(output, { recursive: true });
  let browser, app, page;
  if (native) {
    app = await electron.launch({ executablePath: path.resolve(process.env.BRANDING_ELECTRON_EXE), args: [`--user-data-dir=${await fs.mkdtemp(path.join(output, "profile-"))}`] });
    page = await app.firstWindow();
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), JSON.parse(await fs.readFile("apps/desktop/package.json", "utf8")).version);
  } else {
    browser = await chromium.launch({ channel: "msedge", headless: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  }
  const errors = [], checks = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", (route) => route.fulfill({ status: 204 }));
  const stable = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const resize = async (width, height = 900) => {
    if (native) await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
    else await page.setViewportSize({ width, height });
    await stable();
  };
  const inspectLogo = async (selector, variant) => {
    await page.waitForFunction((selector) => {
      const img = document.querySelector(selector);
      return img?.complete && img.naturalWidth > 0;
    }, selector);
    const logo = await page.locator(selector).evaluate((img) => {
      const rect = img.getBoundingClientRect();
      return { source: img.currentSrc, alt: img.alt, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: rect.width, height: rect.height, left: rect.left, right: rect.right, viewport: innerWidth };
    });
    assert.equal(logo.alt, "Yuksalish");
    assert.equal(logo.naturalWidth, 3058);
    assert.equal(logo.naturalHeight, 1010);
    assert(logo.source.includes(`yuksalish-logo-${variant}`));
    assert(native ? logo.source.startsWith("file:") : new URL(logo.source).origin === origin);
    assert(logo.width > 50 && logo.height > 10, `${selector}: legible size`);
    assert(Math.abs(logo.width / logo.height - 3058 / 1010) < 0.02, `${selector}: preserved proportions`);
    assert(logo.left >= 0 && logo.right <= logo.viewport + 1, `${selector}: inside window`);
  };
  const inspectLayout = async () => {
    const issues = await page.evaluate(() => [...document.querySelectorAll(".auth-screen,.auth-card,.auth-mode-switch,.global-bar,.global-brand")].filter((el) => el.getClientRects().length).flatMap((el) => {
      const rect = el.getBoundingClientRect();
      return el.scrollWidth > el.clientWidth + 2 || rect.left < -1 || rect.right > innerWidth + 2 ? [el.className] : [];
    }));
    assert.deepEqual(issues, [], "no branding/header/form overflow");
  };
  const inspectAlignment = async () => {
    const offsets = await page.locator(".auth-brand").evaluate((img) => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const context = canvas.getContext("2d");
      context.drawImage(img, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = canvas.width;
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < left; x++) {
          if (data[(y * canvas.width + x) * 4 + 3] > 127) { left = x; break; }
        }
      }
      const rect = img.getBoundingClientRect();
      const visibleLeft = rect.left + rect.width * left / canvas.width;
      return [".auth-kicker", ".auth-intro h1"].map((selector) => visibleLeft - document.querySelector(selector).getBoundingClientRect().left);
    });
    assert(offsets.every((offset) => Math.abs(offset) < 1), `visible logo edge aligns with text: ${offsets}`);
  };
  const inspectHeader = async () => {
    assert.equal(await page.locator(".global-bar img,.brand-lockup,.header-brand").count(), 0, "no duplicate header branding");
    const status = page.locator(".global-bar .connection-state");
    assert(await status.isVisible(), "connection status remains visible");
    assert.equal(await status.textContent(), "Сервер подключён");
    assert(await status.evaluate((node) => node.classList.contains("online")));
    const centered = await status.evaluate((node) => {
      const rect = node.getBoundingClientRect(), bar = node.closest(".global-bar").getBoundingClientRect();
      return Math.abs(rect.top + rect.height / 2 - bar.top - bar.height / 2) < 2;
    });
    assert(centered, "status vertically centered in header");
  };
  try {
    if (!native) await page.goto(origin);
    await page.locator(".auth-brand").waitFor();
    for (const width of native ? [1440, 800, 640] : [1440, 800, 640, 480, 320]) {
      await resize(width);
      for (const mode of ["Вход", "Активация приглашения", "Сброс доступа"]) {
        await page.getByRole("button", { name: mode, exact: true }).click();
        assert.equal(await page.getByText(/Сообщения, задачи и согласования доступны только после входа/).count(), 0);
        assert.equal(await page.getByText(/получает отдельную отзываемую сессию/).count(), 0);
        await inspectLogo(".auth-brand", "white");
        await inspectAlignment();
        await inspectLayout();
        checks.push(`${width} login/${mode}`);
      }
      await page.getByRole("button", { name: "Вход", exact: true }).click();
      await page.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true });
    }
    await resize(1440);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    for (const width of native ? [1440, 800, 640] : [1440, 800, 640, 480]) {
      await resize(width, width < 1000 ? 600 : 900);
      for (const collapsed of [false, true]) {
        const isCollapsed = await page.locator(".app-shell").evaluate((node) => node.classList.contains("rail-collapsed"));
        if (isCollapsed !== collapsed) await page.locator(".rail-toggle").click();
        await stable();
        assert.equal(await page.locator(".rail-brand").isVisible(), !collapsed);
        if (!collapsed) await inspectLogo(".rail-brand", "color");
        await inspectHeader();
        await inspectLayout();
        checks.push(`${width} app/${collapsed ? "collapsed" : "expanded"}`);
        await page.screenshot({ path: path.join(output, `app-${width}-${collapsed ? "collapsed" : "expanded"}.png`) });
      }
    }
    await resize(1440);
    for (const label of ["Задачи", "Заявки на оплату", "Согласование поездок", "Сотрудники"]) {
      await page.locator(`.rail-action[aria-label="${label}"]`).click();
      await inspectHeader();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${checks.length} branding layouts, pixel-measured logo alignment, all login modes, original local artwork, preserved proportions, status-only header, menu collapse/expand and navigation${native ? " in packaged Electron" : " in Edge"}.`);
  } catch (error) { await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => undefined); throw error; }
  finally { if (app) await app.close(); if (browser) await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
