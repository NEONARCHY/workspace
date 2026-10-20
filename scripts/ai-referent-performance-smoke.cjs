// Synthetic local registry only. No authentication or business writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const origin = new URL(process.env.QA_URL || "http://127.0.0.1:5190");
assert(["localhost", "127.0.0.1"].includes(origin.hostname));
const phase = process.env.QA_PHASE || "after", baseline = phase === "before";
const output = path.resolve(`tmp/referent-performance/${phase}`);
const letters = Array.from({ length: 100 }, (_, i) => ({
  id: `incoming-${i}`, agentId: "qa", externalId: String(i), sequenceNumber: String(i),
  platformIncomingNumber: `QA-${i}`, senderLetterNumber: `OUT-${i}`, receivedAt: "2026-10-20T08:00:00Z",
  senderOrganization: "Тестовая организация", senderPerson: "Канцелярия", subject: `Письмо ${i}: материалы рабочей встречи`,
  responsibleExternalId: "qa", responsibleDisplayName: "Тестовый сотрудник", urgency: "normal", hasAttachments: true,
  attachmentsCount: 2, mainDocumentFilename: `Письмо-${i}.pdf`, platformRecordId: `record-${i}`,
  status: i % 5 === 0 ? "needs_review" : "platform_submitted", fallbackUsed: false, errorMessage: "", source: "exat", revision: 1,
  createdAt: "2026-10-20T08:00:00Z", updatedAt: "2026-10-20T08:00:00Z",
}));
const registry = { letters, totalCount: 500, filteredCount: 500, registeredCount: 400, attentionCount: 100,
  withAttachmentsCount: 500, lastSyncAt: "2026-10-20T08:00:00Z", journal: { available: true, fileName: "register.xlsx", updatedAt: "2026-10-20T08:00:00Z" } };
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(document.getAnimations().filter(a => Number(a.effect?.getComputedTiming().endTime) < 2000).map(a => a.finished.catch(() => undefined)));
});
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [], requests = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__dateFormats = 0;
    Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, { construct(target, args) { window.__dateFormats++; return Reflect.construct(target, args); } });
  });
  await page.route("**/api/v1/**", route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
    requests.push(url.pathname + url.search);
    if (request.method() !== "GET") return route.fulfill({ status: 403, json: { detail: "Read-only QA" } });
    let data = {};
    if (endpoint.endsWith("/visibility")) data = { incomingMode: "all", canViewJournals: true, canManageVisibility: false, revision: 0 };
    else if (endpoint.endsWith("/authority")) data = { writable: true, mode: "legacy" };
    else if (endpoint.endsWith("/incoming")) data = registry;
    else if (endpoint.endsWith("/letters")) data = { letters: [], totalCount: 0, pendingReviewCount: 0, readyCount: 0, sentCount: 0, signedCount: 0 };
    else if (endpoint.endsWith("/reviewers")) data = { revision: 1, reviewers: [], runtimes: [] };
    else if (endpoint.includes("/ai-referent/packets/")) data = { files: [] };
    return route.fulfill({ json: data });
  });
  try {
    await page.goto(new URL("/qa/page-canvas.html?section=referent&theme=dark", origin).href);
    await page.locator(".ai-incoming-table tbody tr").nth(99).waitFor(); await settle(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable"); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m => [m.name, m.value]));
    const scan = async label => {
      const before = await metrics(), formats = await page.evaluate(() => window.__dateFormats);
      await page.evaluate(() => {
        const start = performance.now(); window.__frameResult = null; const frames = []; let previous;
        const sample = time => { if (previous) frames.push(time - previous); previous = time; if (time - start < 1500) requestAnimationFrame(sample); else window.__frameResult = frames; };
        requestAnimationFrame(sample);
      });
      const input = page.getByRole("textbox", { name: "Поиск входящих писем" });
      if (label === "focus") await input.focus();
      else await input.pressSequentially("материалы", { delay: 30 });
      await page.waitForFunction(() => window.__frameResult !== null);
      const frames = await page.evaluate(() => window.__frameResult), after = await metrics(); frames.sort((a, b) => a - b);
      return { label, formatters: (await page.evaluate(() => window.__dateFormats)) - formats,
        layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
        scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000, frames: frames.length,
        frameP95: frames[Math.floor(frames.length * .95)], maxFrame: frames.at(-1), over33: frames.filter(n => n > 33.4).length };
    };
    const performanceChecks = [await scan("focus"), await scan("typing")];
    console.log(JSON.stringify({ phase, performanceChecks }));
    if (!baseline) assert(performanceChecks.every(check => check.formatters === 0), "Input must not construct a formatter per row");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const layouts = [];
    for (const theme of process.env.QA_PERF_ONLY ? [] : ["light", "dark"]) for (const size of [[1920, 1080], [1440, 960], [1024, 768], [640, 720], [390, 640]]) {
      await page.setViewportSize({ width: size[0], height: size[1] });
      await page.goto(new URL(`/qa/page-canvas.html?section=referent&theme=${theme}`, origin).href);
      await page.locator(".ai-incoming-table tbody tr").nth(99).waitFor(); await settle(page);
      const geometry = await page.evaluate(() => {
        const root = document.querySelector(".ai-referent-view"), summary = document.querySelector(".ai-referent-summary");
        const r = root.getBoundingClientRect(), s = summary.getBoundingClientRect(), style = getComputedStyle(root);
        return { left: s.left - r.left, right: r.right - s.right, padding: style.padding, documentOverflow: document.documentElement.scrollWidth - innerWidth,
          buttons: [...summary.querySelectorAll("button")].map(el => { const b = el.getBoundingClientRect(); return { x: b.x, right: b.right, y: b.y, height: b.height }; }),
          effects: [...root.querySelectorAll("*")].filter(el => getComputedStyle(el).backdropFilter !== "none").length };
      });
      assert.equal(geometry.buttons.length, 4);
      if (!baseline) assert(Math.abs(geometry.left - geometry.right) < 1.1, JSON.stringify({ theme, size, ...geometry }));
      assert(geometry.documentOverflow <= 1);
      layouts.push({ theme, size, ...geometry });
      await page.screenshot({ path: path.join(output, `${theme}-${size[0]}.png`) });
      console.log(`PASS layout ${theme}-${size[0]}`);
    }
    if (!baseline && !process.env.QA_PERF_ONLY) {
      const strip = page.getByRole("region", { name: "Реестр входящих писем" });
      await strip.evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
      assert(await strip.evaluate(el => el.scrollTop > 0 && el.scrollLeft > 0), "Registry retains independent scrolling in compact mode");
      const summary = page.getByRole("region", { name: "Сводка входящих писем" });
      for (const [name, category] of [["Зарегистрировано", "registered"], ["всего входящих", "all"], ["требуют внимания", "attention"], ["с вложениями", "attachments"]]) {
        const previous = requests.length;
        const button = summary.getByRole("button", { name: new RegExp(name) });
        const response = page.waitForResponse(response => {
          const url = new URL(response.url());
          return url.pathname.endsWith("/ai-referent/incoming") && url.searchParams.get("category") === category;
        });
        await button.click();
        await response;
        await page.waitForFunction(() => document.querySelector('.ai-incoming-table-wrap[aria-busy="false"]'));
        assert(requests.slice(previous).some(request => new URL(request, origin).searchParams.get("category") === category));
        assert.equal(await button.getAttribute("aria-pressed"), "true");
      }
      await page.setViewportSize({ width: 1440, height: 960 }); await settle(page);
      await page.getByRole("button", { name: "Пакет документов", exact: true }).first().click();
      await page.getByRole("dialog", { name: "Пакет документов" }).waitFor();
      await page.getByText("Робот ещё не передал файлы этого письма.", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Пакет документов" }).waitFor({ state: "hidden" });
      console.log("PASS all summary filters, compact scrolling and file-dialog lifecycle");
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ performanceChecks, layouts, errors, requests }, null, 2));
    console.log(JSON.stringify({ phase, performanceChecks, desktop: layouts[0], errors }));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
