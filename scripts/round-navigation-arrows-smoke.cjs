// Synthetic Home fixture only; all API writes are blocked by the fixture.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  fs.mkdirSync('tmp/round-navigation-arrows', { recursive: true });
  for (const theme of ['light', 'dark']) for (const width of [1440, 1024, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`http://127.0.0.1:5178/qa/personal-home.html?theme=${theme}`);
    const arrows = page.locator('.home-panel-heading > .ws-navigation-arrow');
    await arrows.first().waitFor();
    assert.ok(await arrows.count() >= 6);
    for (const arrow of await arrows.all()) {
      await arrow.scrollIntoViewIfNeeded();
      const box = await arrow.boundingBox(), icon = await arrow.locator('svg').boundingBox();
      assert.ok(Math.abs(box.width - box.height) < 1, `circle: ${JSON.stringify(box)}`);
      assert.ok(Math.abs(box.width - 36) < 0.01);
      assert.ok(Math.abs(icon.x + icon.width / 2 - box.x - box.width / 2) <= 1);
      assert.ok(Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2) <= 1);
      const style = await arrow.evaluate(node => { const css = getComputedStyle(node); return { radius: css.borderRadius, fill: css.backgroundColor, image: css.backgroundImage }; });
      assert.equal(style.radius, '50%');
      assert.ok(style.fill !== 'rgba(0, 0, 0, 0)' || style.image !== 'none', 'visible backing');
      await arrow.hover();
      const hover = await arrow.boundingBox();
      assert.ok(Math.abs(hover.width - hover.height) < 0.01);
    }
    const notifications = page.getByRole('button', { name: 'Открыть центр уведомлений', exact: true });
    await notifications.scrollIntoViewIfNeeded();
    await notifications.focus(); await page.keyboard.press('Enter');
    await page.getByRole('status').filter({ hasText: 'Переход: notifications' }).waitFor();
    await notifications.locator('..').screenshot({ path: `tmp/round-navigation-arrows/${theme}-${width}.png` });
    await page.close();
  }
  const page = await browser.newPage({ viewport: { width: 640, height: 900 }, hasTouch: true });
  await page.goto('http://127.0.0.1:5178/qa/personal-home.html?theme=dark');
  const arrow = page.locator('.ws-navigation-arrow').first(); await arrow.waitFor();
  const box = await arrow.boundingBox(); assert.ok(Math.abs(box.width - 48) < 0.01); assert.ok(Math.abs(box.height - 48) < 0.01);
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  assert.equal(await arrow.isVisible(), true);
  await browser.close();
  console.log('Round arrows: both themes/3 widths, centered icons, backing, hover, keyboard navigation, 48px touch and forced colors passed');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
