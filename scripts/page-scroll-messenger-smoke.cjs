const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const theme of ['light', 'dark']) for (const width of [1440, 640, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'QA only' } }));
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&scrollrail=1&theme=${theme}`);
    const main = page.locator('.app-stage > .app-content');
    await main.waitFor(); await main.evaluate(node => { node.scrollTop = 120; });
    await page.getByRole('button', { name: 'Мессенджер', exact: true }).click();
    const full = page.getByRole('region', { name: 'Раздел мессенджера', exact: true }); await full.waitFor();
    await page.waitForFunction(() => document.querySelector('.app-stage > .app-content').scrollTop === 0);
    await page.waitForTimeout(100);
    const geometry = await main.evaluate(node => {
      const box = node.getBoundingClientRect(), slot = node.querySelector('.messenger-page-slot').getBoundingClientRect();
      const width = parseFloat(getComputedStyle(node).getPropertyValue('--ws-page-scrollbar-width'));
      return { right: slot.right, leftGap: box.right - width - slot.right, rightGap: innerWidth - box.right };
    });
    assert.ok(Math.abs(geometry.leftGap - geometry.rightGap) <= 1, JSON.stringify({ width, theme, geometry }));
    assert.ok(Math.abs((await full.boundingBox()).x + (await full.boundingBox()).width - geometry.right) <= 1);
    await full.getByRole('button', { name: /^Финансы и закупки/ }).click();
    const history = full.getByLabel('Переписка', { exact: true }); await history.waitFor();
    assert.equal(await history.evaluate(node => getComputedStyle(node).overflowY), 'auto');
    await page.getByRole('button', { name: 'Проекты', exact: true }).click();
    await page.getByRole('heading', { name: 'Проекты', exact: true }).waitFor();
    await page.locator('.floating-messenger-launcher').click();
    await page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true }).waitFor();
    assert.equal(await page.locator('.floating-messenger-launcher').isVisible(), false);
    await page.close();
  }
  await browser.close(); console.log('Page rail: full messenger portal, retained native history, committed navigation reset and mini exclusion passed in 6 cases');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
