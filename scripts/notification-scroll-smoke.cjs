// Synthetic QA only: no accounts, API writes, or employee data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const origin = process.env.NOTIFICATION_QA_ORIGIN || "http://127.0.0.1:5183";
const output = path.resolve("tmp/notification-scroll");
const rows = ".notification-stream .notification-row";
const selectedMetrics = new Set(["ScriptDuration", "LayoutDuration", "RecalcStyleDuration", "TaskDuration", "JSHeapUsedSize", "Nodes"]);
async function metrics(cdp) {
  return Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.filter(item => selectedMetrics.has(item.name)).map(item => [item.name, item.value]));
}
function delta(before, after) {
  return Object.fromEntries(Object.entries(after).map(([key, value]) => [key, Math.round((value - before[key]) * (key.endsWith("Duration") ? 1000 : 1))]));
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const results = [];
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
      for (const theme of ["light", "dark"]) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        const cdp = await page.context().newCDPSession(page);
        await cdp.send("Performance.enable");
        await page.goto(`${origin}/qa/detail-layout.html?view=notification-search&notificationCount=300&theme=${theme}`);
        await page.locator(rows).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        const firstCount = await page.locator(rows).count();
        assert.equal(firstCount, 15);
        // Measure remount after module loading, rather than Vite's compilation/network.
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
        const mounts = [];
        for (let index = 0; index < 3; index++) {
          await page.getByRole("button", { name: "Сменить раздел QA" }).click();
          assert.equal(await page.locator(rows).count(), 0);
          const start = await metrics(cdp);
          await page.getByRole("button", { name: "Сменить раздел QA" }).click();
          await page.locator(rows).first().waitFor();
          await page.waitForTimeout(200);
          mounts.push(delta(start, await metrics(cdp)));
        }
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
        const row = page.locator(rows).first();
        await row.scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(220);
        const initialHeight = (await row.boundingBox()).height;
        await row.hover();
        await page.waitForTimeout(220);
        const hoverHeight = (await row.boundingBox()).height;
        assert(Math.abs(initialHeight - hoverHeight) < 1, "hover must not change row height");
        await page.screenshot({ path: path.join(output, `after-${theme}-${width}.png`) });
        const scrollStart = await metrics(cdp);
        const frameIntervals = await page.evaluate(async () => {
          let owner = document.querySelector(".notification-stream");
          while (owner && !(owner.scrollHeight > owner.clientHeight && /auto|scroll/.test(getComputedStyle(owner).overflowY))) owner = owner.parentElement;
          owner ||= document.scrollingElement;
          const intervals = [];
          let previous = performance.now();
          for (let frame = 0; frame < 90; frame++) {
            await new Promise(requestAnimationFrame);
            const now = performance.now();
            intervals.push(now - previous);
            previous = now;
            owner.scrollTop += 30;
          }
          return intervals.sort((a, b) => a - b);
        });
        const scrollWork = delta(scrollStart, await metrics(cdp));
        // The real scroll owner can be either the inner list or enclosing compact page.
        const start = await metrics(cdp);
        const countSteps = [];
        for (let batch = 0; batch < 24; batch++) {
          const count = await page.locator(rows).count();
          countSteps.push(count);
          if (count === 300) break;
          await page.locator(".notification-load-more").evaluate(node => node.scrollIntoView({ block: "end" }));
          await page.waitForTimeout(110);
        }
        assert.equal(await page.locator(rows).count(), 300, "all events remain reachable");
        assert(countSteps.every(count => count % 15 === 0));
        await page.getByRole("textbox", { name: "Поиск уведомлений" }).fill("Событие 29");
        assert.equal(await page.locator(rows).count(), 11, "search includes events beyond loaded batches");
        await page.getByRole("textbox", { name: "Поиск уведомлений" }).fill("");
        assert.equal(await page.locator(rows).count(), 15);
        const scrolling = delta(start, await metrics(cdp));
        await page.getByRole("button", { name: "Сменить раздел QA" }).click();
        assert.equal(await page.locator(rows).count(), 0);
        await cdp.send("HeapProfiler.collectGarbage");
        const exited = await metrics(cdp);
        await page.getByRole("button", { name: "Сменить раздел QA" }).click();
        assert.equal(await page.locator(rows).count(), 15);
        await page.getByRole("button", { name: "Прочитать все", exact: true }).click();
        assert.equal(await page.locator(rows).count(), 0);
        assert.equal(await page.getByRole("progressbar").getAttribute("aria-valuenow"), "100");
        assert.deepEqual(errors, []);
        results.push({ width, height, theme, firstCount, initialHeight, hoverHeight, mounts,
          scrollWork, frameP95: frameIntervals[Math.floor(frameIntervals.length * .95)], countSteps, scrolling, exited });
        console.log(`PASS ${theme} ${width}: first=${firstCount}, hover=${initialHeight}->${hoverHeight}, batches/reset/read checked`);
        await page.close();
      }
    }
    await fs.writeFile(path.join(output, "after.json"), JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
