const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const touch of [false, true]) {
    // At 200%, retain at least the supported 320 CSS-pixel work area. The
    // separate geometry matrix covers 320/640px unzoomed phones as well.
    const page = await browser.newPage({ viewport: { width: touch ? 768 : 1440, height: 900 }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Synthetic QA' } }));
    await page.goto('http://127.0.0.1:5178/qa/page-canvas.html?theme=dark&section=notifications', { waitUntil: 'domcontentloaded' });
    await page.locator('.notification-header').waitFor();
    for (const zoom of [1, 2]) {
      await page.evaluate(value => { document.documentElement.style.zoom = String(value); window.dispatchEvent(new Event('resize')); }, zoom);
      await page.waitForTimeout(200);
      const geometry = await page.locator('.app-content').evaluate((node, scale) => {
        const box = node.getBoundingClientRect(), content = node.firstElementChild.getBoundingClientRect();
        const painted = parseFloat(getComputedStyle(node).getPropertyValue('--ws-page-scrollbar-width')) * scale;
        return { leftGap: box.right - painted - content.right, rightGap: innerWidth - box.right,
          inset: node.offsetWidth - node.clientWidth, width: node.clientWidth, scrollWidth: node.scrollWidth };
      }, zoom);
      assert.ok(Math.abs(geometry.leftGap - geometry.rightGap) / zoom < 1, JSON.stringify({ touch, zoom, geometry }));
      assert.equal(geometry.inset, touch ? 8 : 6);
      assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify({ touch, zoom, geometry }));
    }
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await page.locator('.app-content').evaluate(node => getComputedStyle(node).overflowY), 'auto');
    assert.equal(await page.locator('.notification-stream').evaluate(node => getComputedStyle(node).overflowY), 'auto');
    await page.close();
  }
  console.log('Page scroll: mouse/touch widths, 100/200% zoom, forced colours and retained inner notification scrolling passed.');
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
