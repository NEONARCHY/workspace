const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const dir = 'tmp/notification-search-qa'; fs.mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) for (const width of [1440, 1024, 640, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=notification-search&theme=${theme}`);
    await page.evaluate(() => document.documentElement.classList.add('web-platform'));
    const input = page.getByRole('textbox', { name: 'Поиск уведомлений' });
    const button = page.getByRole('button', { name: 'Прочитать все', exact: true });
    const search = page.locator('.notification-head-actions > .workspace-search');
    const header = page.locator('.notification-header');
    await input.waitFor();
    await page.waitForTimeout(650); // Let the page-entry motion settle before comparing focus geometry.
    const actions = page.locator('.notification-head-actions');
    assert.deepEqual(await actions.evaluate(node => ({ image: getComputedStyle(node).backgroundImage, fill: getComputedStyle(node).backgroundColor })),
      { image: 'none', fill: 'rgba(0, 0, 0, 0)' }, 'layout reservation must not paint an empty pill');
    const before = { button: await button.boundingBox(), search: await search.boundingBox(), header: await header.boundingBox() };
    await input.focus();
    await search.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => undefined))));
    await page.waitForTimeout(650);
    const after = { button: await button.boundingBox(), search: await search.boundingBox(), header: await header.boundingBox() };
    const icon = await search.locator('.workspace-search-trigger').boundingBox();
    assert.ok(Math.abs(icon.width - icon.height) < 1 && icon.width >= 24, 'expanded icon remains a compact circle');
    assert.ok(Math.abs(before.button.x - after.button.x) < 1 && Math.abs(before.button.y - after.button.y) < 1, JSON.stringify({ theme, width, before, after }));
    assert.ok(Math.abs(before.header.height - after.header.height) < 1);
    assert.ok(Math.abs(before.search.x + before.search.width - after.search.x - after.search.width) < 1);
    if (width >= 640) assert.ok(after.search.x < before.search.x - 10, JSON.stringify({ width, before, after }));
    assert.ok(after.search.x + after.search.width <= after.button.x - 6);
    assert.ok(after.button.x + after.button.width <= width && after.search.x >= 0);
    await input.fill('Проверка поиска');
    await page.getByRole('button', { name: /Задачи.*Проверка поиска/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: /Задачи.*План встречи/ }).count(), 0);
    await header.screenshot({ path: `${dir}/${theme}-${width}-expanded.png` });
    await input.fill(''); await button.focus(); await page.waitForTimeout(650);
    const collapsed = await button.boundingBox();
    assert.ok(Math.abs(collapsed.x - before.button.x) < 1 && Math.abs(collapsed.y - before.button.y) < 1);
    await button.click();
    assert.equal(await button.isDisabled(), true);
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Notification search: left expansion, stationary action/header, filter/reset/read-all and no overlap passed in both themes at 5 widths.');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
