const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const output = "tmp/light-incoming-satin-qa";
  await fs.mkdir(output, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 850 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/v1/**", route => {
      assert.equal(route.request().method(), "GET");
      return route.fulfill({ json: { totalCount: 0, filteredCount: 0, registeredCount: 0,
        attentionCount: 0, withAttachmentsCount: 0, lastSyncAt: null, journal: { available: false }, letters: [] } });
    });
    const result = [];
    for (const theme of ["light", "dark"]) {
      await page.goto("http://127.0.0.1:5178/qa/detail-layout.html?view=incoming&theme=" + theme);
      const all = page.getByRole("button", { name: /всего входящих/ });
      await all.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(350);
      const appearance = node => {
        const css = getComputedStyle(node);
        return { borderColor: css.borderColor, borderWidth: css.borderWidth, image: css.backgroundImage,
          shadow: css.boxShadow, clip: css.backgroundClip, width: node.offsetWidth, height: node.offsetHeight };
      };
      const selected = await all.evaluate(appearance);
      assert(selected.image.includes("conic-gradient"), JSON.stringify({ theme, selected }));
      assert(!selected.shadow.includes("inset"));
      assert.equal(selected.borderColor, "rgba(0, 0, 0, 0)");
      const next = page.getByRole("button", { name: /требуют внимания/ });
      await next.click();
      await page.waitForTimeout(200);
      const inactive = await all.evaluate(appearance);
      assert.equal(inactive.width, selected.width);
      assert.equal(inactive.height, selected.height);
      if (theme === "light") assert(!inactive.image.includes("conic-gradient"));
      assert((await next.evaluate(appearance)).image.includes("conic-gradient"));
      await all.click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: output + "/" + theme + ".png" });
      result.push({ theme, selected });
    }
    await page.emulateMedia({ forcedColors: "active" });
    assert(!(await allAppearance(page)).image.includes("conic-gradient"));
    assert.deepEqual(errors, []);
    await fs.writeFile(output + "/report.json", JSON.stringify(result, null, 2));
    console.log("Light/dark selected satin, unchanged geometry, filter switching and forced colours passed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
async function allAppearance(page) {
  return page.getByRole("button", { name: /всего входящих/ }).evaluate(node => ({ image: getComputedStyle(node).backgroundImage }));
}
