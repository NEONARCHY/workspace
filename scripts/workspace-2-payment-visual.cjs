// Read-only local visual regression for the payment board; no request mutations.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

async function main() {
  const origin = process.env.YUKSALISH_SMOKE_URL || "http://127.0.0.1:5173";
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Local URL required");
  const password = process.env.WS2_VISUAL_PASSWORD;
  if (!password) throw new Error("Set WS2_VISUAL_PASSWORD to a local test account password");
  const output = path.resolve(`tmp/workspace-2-${process.env.WS2_VISUAL_PHASE || "after"}`);
  await fs.mkdir(output, { recursive: true });
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/v1/chats/*/read", route => route.fulfill({ status: 204 }));
  try {
    await page.goto(origin);
    await page.getByRole("textbox", { name: /Логин/ }).fill(process.env.WS2_VISUAL_USER || "malika");
    await page.getByLabel(/Пароль/).fill(password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.locator('.rail-action[aria-label="Заявки на оплату"]').click();
    await page.locator(".approval-kanban").waitFor();
    for (const [name, width, height, zoom] of [
      ["desktop", 1440, 900, 1],
      ["laptop", 1024, 768, 1],
      ["compact", 800, 640, 1],
      ["zoom-200", 1440, 900, 2],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); }, zoom);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => {
          const timing = animation.effect?.getComputedTiming();
          return timing && timing.iterations !== Infinity && Number(timing.endTime) < 2000;
        }).map(animation => animation.finished.catch(() => undefined)));
      });
      await page.screenshot({ path: path.join(output, `${name}.png`) });
      report.push(await page.evaluate(name => {
        const board = document.querySelector(".approval-kanban");
        const filters = [...document.querySelectorAll(".approval-board-filters button")];
        return {
          name,
          documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          boardScrolls: board.scrollWidth > board.clientWidth,
          visibleColumns: [...document.querySelectorAll(".approval-column")].filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.left < window.innerWidth && rect.right > 0;
          }).length,
          requestCards: document.querySelectorAll(".approval-board-card").length,
          filters: filters.map(button => button.textContent.trim()),
        };
      }, name));
    }
    await page.evaluate(() => { document.documentElement.style.zoom = "1"; });
    await page.setViewportSize({ width: 1440, height: 900 });
    if (await page.locator(".approval-overview-main strong").count()) {
      const actionable = Number(await page.locator(".approval-overview-main strong").textContent());
      await page.getByRole("button", { name: "Нужно моё решение", exact: true }).click();
      assert.equal(await page.locator(".approval-board-card").count(), actionable);
      await page.getByRole("button", { name: "Все", exact: true }).click();
      assert.equal(await page.locator(".approval-board-card").count(), report[0].requestCards);
      await page.getByLabel("Поиск заявок").fill("Несуществующая заявка WS2");
      assert.equal(await page.locator(".approval-board-card").count(), 0);
      assert.match(await page.getByRole("button", { name: "Все", exact: true }).textContent(), /0/);
      await page.getByLabel("Поиск заявок").fill("");
      assert.equal(await page.locator(".approval-board-card").count(), report[0].requestCards);
    }
    await page.waitForFunction(() => !document.querySelector('[data-animating="true"]'));
    await page.evaluate(await fs.readFile(require.resolve("axe-core/axe.min.js"), "utf8"));
    const violations = await page.evaluate(async () => {
      const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
      return result.violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }));
    });
    assert.deepEqual(violations, [], `Accessibility violations: ${JSON.stringify(violations)}`);
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await page.locator(".approval-board-card").first().evaluate(element =>
      Number.parseFloat(getComputedStyle(element).transitionDuration)), 0);
    await page.emulateMedia({ forcedColors: "active", reducedMotion: "no-preference" });
    assert.notEqual(await page.locator(".approval-overview").evaluate(element =>
      getComputedStyle(element).borderTopStyle), "none");
    if (errors.length) throw new Error(`Renderer errors: ${errors.join("; ")}`);
    if (report.some(item => item.documentOverflow || !item.boardScrolls)) {
      throw new Error("Unexpected document overflow or inaccessible board columns");
    }
  } finally {
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify({ report, errors }, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
