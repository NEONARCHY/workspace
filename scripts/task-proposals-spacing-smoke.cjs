const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.route('**/api/v1/task-proposals', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/task-plans**', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/tasks/project-options', route => route.fulfill({ json: [] }));
  const dir = 'tmp/task-proposals-qa'; fs.mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) for (const width of [1652, 1024, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=task-overview&theme=${theme}`);
    await page.evaluate(() => document.documentElement.classList.add('web-platform'));
    const strip = page.getByRole('region', { name: 'Заявки на постановку задач', exact: true });
    await strip.waitFor();
    for (const open of [false, true]) {
      if (open) await strip.locator('summary').click();
      const geometry = await strip.evaluate(node => {
        const header = node.previousElementSibling.getBoundingClientRect();
        const summary = node.nextElementSibling.getBoundingClientRect();
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return { top: box.top - header.bottom, bottom: summary.top - box.bottom, background: style.backgroundImage };
      });
      assert.ok(Math.abs(geometry.top - 14) < 1 && Math.abs(geometry.bottom - 14) < 1, JSON.stringify(geometry));
      assert.ok(geometry.background.includes('conic-gradient'), geometry.background);
      if (!open) await page.screenshot({ path: `${dir}/${theme}-${width}.png` });
    }
    await page.emulateMedia({ forcedColors: 'active' });
    assert.notEqual(await strip.evaluate(node => getComputedStyle(node).borderTopStyle), 'none');
    await page.emulateMedia({ forcedColors: 'none' });
  }
  await browser.close();
  console.log('Task proposals: equal 14px gaps, open/closed disclosure, satin in both themes and forced-colors border passed at 3 widths.');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
