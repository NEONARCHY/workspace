// Read-only synthetic fixture: no accounts, API writes or real chat data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const report = { geometry: [], performance: [], errors: [] };
  const output = "tmp/emoji-theme-polish-qa";
  await fs.mkdir(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on("pageerror", error => report.errors.push(error.message));
    const rect = locator => locator.boundingBox();
    const frames = async (action, ms) => {
      await page.evaluate(duration => {
        window.qaFrames = [];
        let previous, start;
        const tick = now => {
          start ??= now;
          if (previous) window.qaFrames.push(now - previous);
          previous = now;
          if (now - start < duration) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }, ms);
      await action();
      await page.waitForTimeout(ms + 100);
      return page.evaluate(() => {
        const intervals = window.qaFrames, sorted = [...intervals].sort((a, b) => a - b);
        return { fps: +(1000 * intervals.length / intervals.reduce((a, b) => a + b, 0)).toFixed(1),
          p95Ms: +sorted[Math.floor(sorted.length * .95)].toFixed(1),
          over50ms: intervals.filter(ms => ms > 50).length };
      });
    };
    for (const theme of ["dark", "light"]) {
      await page.goto("http://127.0.0.1:5178/qa/animated-reactions.html?theme=" + theme);
      await page.getByRole("button", { name: "Добавить реакцию" }).click();
      const picker = page.getByLabel("Выберите реакцию");
      await picker.waitFor();
      await page.waitForTimeout(400);
      const initial = await rect(picker);
      for (const name of ["Праздник и награды", "Жесты и люди", "Животные", "Частые", "Все эмодзи"]) {
        await page.getByRole("button", { name, exact: true }).click();
        const box = await rect(picker);
        for (const prop of ["x", "y", "width", "height"]) assert(Math.abs(box[prop] - initial[prop]) < 1, name + " " + prop + " " + JSON.stringify({ initial, box }));
      }
      await page.getByRole("textbox", { name: "Поиск эмодзи" }).fill("несуществующий");
      assert.equal((await rect(picker)).height, initial.height);
      const close = await rect(page.getByRole("button", { name: "Закрыть реакции" }));
      assert.equal(close.width, close.height);
      await page.screenshot({ path: output + "/" + theme + "-search.png" });
      await page.getByRole("button", { name: "Закрыть реакции" }).click();
      await page.getByRole("button", { name: "Контекстное меню", exact: true }).click();
      const strip = page.getByRole("group", { name: "Быстрые реакции" });
      const menu = page.getByRole("menu");
      assert.equal((await rect(strip)).width, (await rect(menu)).width);
      await page.getByRole("button", { name: "Все реакции" }).click();
      await page.waitForTimeout(600);
      const contextBox = await rect(picker);
      await page.getByRole("button", { name: "Праздник и награды", exact: true }).click();
      assert.deepEqual(await rect(picker), contextBox);
      await page.screenshot({ path: output + "/" + theme + "-context.png" });
      await page.getByRole("button", { name: "Закрыть реакции" }).click();
      await page.getByRole("menuitem", { name: "Ответить", exact: true }).click();
      report.geometry.push({ theme, picker: initial, close, strip: await strip.count() });
    }
    for (const viewport of [{ width: 1024, height: 768 }, { width: 390, height: 600 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole("button", { name: "Добавить реакцию" }).click();
      const box = await rect(page.getByLabel("Выберите реакцию"));
      assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      await page.getByRole("button", { name: "Закрыть реакции" }).click();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(async () => {
      const { warmReactionArtwork } = await import("/src/renderer/reaction-artwork-preload.ts");
      await warmReactionArtwork();
      performance.clearResourceTimings();
    });
    report.performance.push({ scenario: "warm picker", ...await frames(() => page.getByRole("button", { name: "Добавить реакцию" }).click(), 2000) });
    await page.getByRole("button", { name: "Закрыть реакции" }).click();
    await page.getByRole("button", { name: "Добавить реакцию" }).click();
    await page.waitForTimeout(300);
    report.reopenNetworkBytes = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter(entry => entry.name.includes("/emoji/")).reduce((sum, entry) => sum + entry.transferSize, 0));
    assert.equal(report.reopenNetworkBytes, 0);
    await page.getByRole("button", { name: "Закрыть реакции" }).click();
    report.performance.push({ scenario: "theme wave", ...await frames(() => page.getByRole("button", { name: /Включить .* тему/ }).click(), 1000) });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: /Включить .* тему/ }).click();
    assert.equal(await page.locator("html").getAttribute("data-theme-transition"), null);
    assert.deepEqual(report.errors, []);
  } finally {
    await fs.writeFile(output + "/report.json", JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
