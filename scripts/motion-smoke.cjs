/* Native, read-only business-data QA. QA_PASSWORD is required; the owned login
   is revoked in finally, never by deleting another device's session. */
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  assert(process.env.QA_PASSWORD, "Set QA_PASSWORD for the local test account");
  const output = path.resolve("tmp/motion-desktop");
  await fs.mkdir(output, { recursive: true });
  const profile = await fs.mkdtemp(path.join(output, "profile-"));
  const app = await _electron.launch({
    executablePath: path.resolve("apps/desktop/release/win-unpacked/Yuksalish Workspace.exe"),
    args: [`--user-data-dir=${profile}`],
  });
  let token, apiOrigin;
  const captures = [], errors = [], report = {};
  const page = await app.firstWindow();
  page.on("pageerror", e => errors.push(e.message));
  page.on("response", response => {
    const url = new URL(response.url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) && /\/auth\/(login|refresh)$/.test(url.pathname) && response.ok()) {
      captures.push(response.json().then(data => { token = data.accessToken; apiOrigin = url.origin; }));
    }
  });
  await page.route("**/api/v1/**", route => {
    const request = route.request(), pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" || pathname.startsWith("/api/v1/auth/")) return route.continue();
    if (/\/chats\/[^/]+\/read$/.test(pathname)) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 403, json: { detail: "Read-only motion QA" } });
  });
  const settle = () => page.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().endTime) < 2000)
      .map(a => a.finished.catch(() => undefined)));
  });
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 960));
    report.graphics = await app.evaluate(async ({ app }) => {
      let features;
      for (let attempt = 0; attempt < 30; attempt++) {
        await app.getGPUInfo("basic");
        features = app.getGPUFeatureStatus();
        if (features.gpu_compositing !== "disabled_software") break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { version: app.getVersion(), hardwareAccelerationEnabled: app.isHardwareAccelerationEnabled(), features };
    });
    await page.locator(".auth-card").waitFor();
    report.fonts = await page.evaluate(async () => {
      await Promise.all([400, 500, 600, 700].map(weight => document.fonts.load(`${weight} 16px Gilroy`)));
      const bodyStyle = getComputedStyle(document.body);
      return { faces: [...document.fonts].map(f => ({ family: f.family, weight: f.weight, status: f.status })),
        preloads: [...document.querySelectorAll('link[rel="preload"][as="font"]')].map(link => link.getAttribute("href")),
        synthesis: bodyStyle.fontSynthesis, kerning: bodyStyle.fontKerning, textRendering: bodyStyle.textRendering };
    });
    assert.equal(report.fonts.preloads.length, 4);
    assert(report.fonts.faces.every(f => f.status === "loaded" && ["400", "500", "600", "700"].includes(f.weight)));
    assert.equal(report.fonts.synthesis, "none");
    assert.equal(report.fonts.kerning, "normal");
    assert.equal(report.fonts.textRendering, "optimizelegibility");
    await page.getByRole("textbox", { name: /Логин/ }).fill(process.env.QA_LOGIN || "malika");
    await page.getByLabel(/Пароль/).fill(process.env.QA_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor(); await settle();
    await page.evaluate(() => {
      window.motionQA = { frames: [], longTasks: [], animationCalls: [] };
      const original = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = original.call(this, frames, options);
        if (this.matches(".fui-DialogSurface")) window.motionQA.animationCalls.push({ frames, options });
        return animation;
      };
      let last;
      const tick = now => {
        if (last !== undefined && !document.hidden) window.motionQA.frames.push(now - last);
        last = now; window.motionQA.raf = requestAnimationFrame(tick);
      };
      window.motionQA.raf = requestAnimationFrame(tick);
      window.motionQA.observer = new PerformanceObserver(list => {
        window.motionQA.longTasks.push(...list.getEntries().map(e => e.duration));
      });
      window.motionQA.observer.observe({ type: "longtask", buffered: false });
    });
    report.sections = [];
    for (const name of ["CRM", "Задачи", "Заявки на оплату", "Список проектов", "Согласование поездок", "Календарь", "Сотрудники", "Мессенджер"]) {
      await page.locator(`.rail-action[aria-label="${name}"]`).click();
      const animation = await page.locator(".app-content > .workspace-view").evaluate(node => {
        const offenders = [...node.querySelectorAll("*")].filter(element =>
          [...element.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) &&
          element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden"
        ).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent.trim().slice(0, 40), size: parseFloat(getComputedStyle(element).fontSize) }))
          .filter(item => item.size < 11);
        const style = getComputedStyle(node);
        return { name: style.animationName, duration: style.animationDuration, transform: style.transform, typographyOffenders: offenders };
      });
      assert.equal(animation.name, "ws-view-enter"); assert.equal(animation.transform, "none");
      assert.deepEqual(animation.typographyOffenders, [], `${name}: visible text must be at least 11px`);
      await settle(); report.sections.push({ section: name, ...animation });
    }
    // Trigger all dialogs via their normal UI; native motion must not enlarge text.
    await page.keyboard.press("Control+k");
    await page.locator(".section-jump-dialog").waitFor(); await settle();
    report.dialogMotion = await page.evaluate(() => window.motionQA.animationCalls);
    assert(report.dialogMotion.length > 0, "captured Fluent surface motion");
    const scaleCalls = report.dialogMotion.filter(({ frames }) => frames.some(frame => "scale" in frame));
    assert(scaleCalls.length > 0);
    for (const { frames } of scaleCalls) assert.deepEqual(frames.map(frame => frame.scale), [1, 1], "no 85% → 100% text scaling");
    await page.keyboard.press("Escape"); await page.locator(".section-jump-dialog").waitFor({ state: "hidden" });
    await page.locator('.rail-action[aria-label="Согласование поездок"]').click();
    await page.getByRole("button", { name: "Новая командировка", exact: true }).click();
    await page.locator(".record-composer").waitFor(); await settle();
    report.dialogGeometry = await page.locator(".record-composer").evaluate(node => {
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom,
        fits: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        transform: getComputedStyle(node).transform };
    });
    assert(report.dialogGeometry.fits);
    await page.getByLabel("Цель поездки", { exact: true }).fill("Проверка плавности ввода — без сохранения");
    assert.equal(await page.getByLabel("Цель поездки", { exact: true }).inputValue(), "Проверка плавности ввода — без сохранения");
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"));
    await fs.writeFile(path.join(output, "trip.png"), Buffer.from(png, "base64"));
    await page.keyboard.press("Escape"); await page.locator(".record-composer").waitFor({ state: "hidden" });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('.rail-action[aria-label="Список проектов"]').click();
    const reduced = await page.locator(".workspace-view").evaluate(node => getComputedStyle(node).animationName);
    assert.equal(reduced, "none");
    await page.evaluate(() => { window.motionQA.animationCalls = []; });
    await page.keyboard.press("Control+k"); await page.locator(".section-jump-dialog").waitFor();
    await settle();
    report.reducedDialogMotion = await page.evaluate(() => window.motionQA.animationCalls);
    assert(report.reducedDialogMotion.length > 0);
    assert(report.reducedDialogMotion.every(call => call.options.duration <= 1), "Fluent respects reduced motion too");
    assert.equal(await page.evaluate(() => document.getAnimations().filter(a => a.playState === "running").length), 0);
    await page.keyboard.press("Escape"); await page.locator(".section-jump-dialog").waitFor({ state: "hidden" });
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
    await page.locator('.rail-action[aria-label="Календарь"]').click();
    assert.equal(await page.locator(".workspace-view").evaluate(node => getComputedStyle(node).animationName), "none");
    await page.emulateMedia({ forcedColors: "none" });
    await settle();
    report.timing = await page.evaluate(() => {
      const data = window.motionQA; cancelAnimationFrame(data.raf); data.observer.disconnect();
      const frames = data.frames.sort((a, b) => a - b);
      return { frameSamples: frames.length, frameMedianMs: frames[Math.floor(frames.length * .5)],
        frameP95Ms: frames[Math.floor(frames.length * .95)], maxLongTaskMs: Math.max(0, ...data.longTasks),
        longTaskCount: data.longTasks.length, remainingAnimations: document.getAnimations().filter(a => a.playState === "running").length };
    });
    assert.deepEqual(errors, []);
    assert.equal(report.timing.remainingAnimations, 0);
    report.checks = "8 section entrances, 11px typography floor, kerning, Fluent no-scale motion, creation form, input, Escape, reduced motion, forced colours, font preloads, no idle animations, no page errors";
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try {
      await Promise.all(captures);
      if (token) {
        const headers = { Authorization: `Bearer ${token}` };
        assert.equal((await fetch(`${apiOrigin}/api/v1/auth/logout`, { method: "POST", headers, signal: AbortSignal.timeout(10000) })).status, 204);
        assert.equal((await fetch(`${apiOrigin}/api/v1/auth/sessions`, { headers, signal: AbortSignal.timeout(10000) })).status, 401);
        console.log("Owned QA session revoked; existing sessions untouched.");
      }
    } finally { await app.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
