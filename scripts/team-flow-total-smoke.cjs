const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'QA: no business requests' } }));
  const dir = 'tmp/team-flow-total-qa'; fs.mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) for (const width of [1652, 1024, 640, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=team-flow&theme=${theme}`);
    const total = page.locator('.team-dash-flow-total');
    await total.waitFor();
    for (const count of ['188', '99999']) {
      await total.locator('strong').evaluate((node, text) => { node.textContent = text; }, count);
      const geometry = await total.evaluate(node => {
        const box = node.getBoundingClientRect();
        return [...node.children].map(child => {
          const rect = child.getBoundingClientRect();
          return { left: rect.left - box.left, right: box.right - rect.right, top: rect.top - box.top, bottom: box.bottom - rect.bottom, overflow: child.scrollWidth > child.clientWidth };
        });
      });
      assert.ok(geometry.every(item => item.left >= 10 && item.right >= 10 && item.top >= 8 && item.bottom >= 8 && !item.overflow), JSON.stringify({ theme, width, count, geometry }));
      if (count === '188') await page.locator('.team-dash-flow-heading').screenshot({ path: `${dir}/${theme}-${width}.png` });
    }
  }
  await browser.close();
  console.log('Active-task pill: number and label stay inside symmetric padding in both themes, 4 widths and 3/5-digit counts.');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
