// Read-only detail/board layout regression on a local test account.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  assert(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
  assert(process.env.WS2_VISUAL_PASSWORD, "Set WS2_VISUAL_PASSWORD for a local test account");
  const output = path.resolve(`tmp/workspace-2-detail-${process.env.WS2_VISUAL_PHASE || "after"}`);
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const results = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", route => route.fulfill({ status: 204 }));
  try {
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill(process.env.WS2_VISUAL_USER || "malika");
    await page.getByLabel(/Пароль/).fill(process.env.WS2_VISUAL_PASSWORD);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator('.rail-action[aria-label="Заявки на оплату"]').click();
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const open = page.locator(".approval-card-open").first();
    for (const [name, width, height] of [
      ["desktop", 1440, 900],
      ["laptop", 1024, 768],
      ["compact", 800, 640],
      // 200% browser zoom halves the effective CSS viewport.
      ["zoom-200", 720, 450],
    ]) {
      await page.setViewportSize({ width, height });
      await open.click();
      await page.getByRole("dialog", { name: /./ }).waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => {
          const timing = animation.effect?.getComputedTiming();
          return timing && timing.iterations !== Infinity && Number(timing.endTime) < 2000;
        }).map(animation => animation.finished.catch(() => undefined)));
      });
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      const result = await page.evaluate(name => {
        const panel = document.querySelector(".approval-detail-panel").getBoundingClientRect();
        const board = document.querySelector(".approval-kanban").getBoundingClientRect();
        const viewport = { width: innerWidth, height: innerHeight };
        return { name, panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
          board: { left: board.left, right: board.right }, viewport,
          dialogScrollHeight: document.querySelector(".approval-detail-content").scrollHeight,
          dialogClientHeight: document.querySelector(".approval-detail-content").clientHeight,
          activeInside: document.querySelector(".approval-detail-panel").contains(document.activeElement) };
      }, name);
      results.push(result);
      assert(result.panel.top >= -1 && result.panel.bottom <= height + 1, `${name}: panel is vertically clipped`);
      assert(result.panel.left >= -1 && result.panel.right <= width + 1, `${name}: panel is horizontally clipped`);
      assert(result.activeInside, `${name}: focus escaped the open dialog`);
      const violations = await page.evaluate(async () => {
        const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
        return result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }));
      });
      assert.deepEqual(violations, [], `${name}: accessibility violations: ${JSON.stringify(violations)}`);
      await page.keyboard.press("Tab");
      assert(await page.locator(".approval-detail-panel").evaluate(element => element.contains(document.activeElement)), `${name}: Tab left the dialog`);
      if (width < 1050) {
        const reachedEnd = await page.evaluate(() => {
          const content = document.querySelector(".approval-detail-content");
          content.scrollTop = content.scrollHeight;
          const last = document.querySelector(".approval-detail-process").lastElementChild;
          return last.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom + 1;
        });
        assert(reachedEnd, `${name}: last detail action cannot be scrolled into view`);
      }
      if (name === "zoom-200") await page.keyboard.press("Escape");
      else await page.getByRole("button", { name: "Закрыть карточку заявки" }).click();
      await page.locator(".approval-detail-panel").waitFor({ state: "detached" });
      assert(await open.evaluate(element => element === document.activeElement), `${name}: card focus was not restored`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open.click();
    assert.equal(await page.locator(".approval-detail-panel").evaluate(element => getComputedStyle(element).animationName), "none");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "no-preference", forcedColors: "active" });
    await open.click();
    assert.equal(await page.locator(".approval-detail-overlay").evaluate(element => getComputedStyle(element).backdropFilter), "none");
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
  } finally {
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ results, errors }, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(results, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
