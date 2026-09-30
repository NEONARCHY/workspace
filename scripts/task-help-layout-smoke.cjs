// Isolated visual geometry check. Does not call the server or modify user data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const assert = require("node:assert/strict");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5188";
  assert(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const viewport of [{ width: 1080, height: 690 }, { width: 700, height: 500 }]) {
      const page = await browser.newPage({ viewport });
      await page.goto(origin + "/qa/task-help.html");
      const dialog = page.getByRole("dialog", { name: "Тест карточки задачи" });
      await dialog.evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const before = await dialog.evaluate((element) => ({ scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
      await page.getByRole("button", { name: "Справка: Как учитывается срок" }).click();
      const surface = page.locator(".task-section-help-surface");
      await surface.waitFor();
      const box = await surface.boundingBox();
      const after = await dialog.evaluate((element) => ({ scrollHeight: element.scrollHeight, scrollTop: element.scrollTop }));
      assert(box, "Help surface must have bounds");
      assert(box.y >= 0 && box.y + box.height <= viewport.height, `Help must fit viewport ${JSON.stringify({ viewport, box })}`);
      assert.equal(after.scrollHeight, before.scrollHeight, "Help must not extend dialog scroll height");
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
