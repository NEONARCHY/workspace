const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'QA' } }));
  for (const theme of ['light', 'dark']) for (const [width, height, zoom] of [[1024, 768, 1], [640, 480, 1], [320, 640, 1], [1440, 900, 2]]) {
    await page.setViewportSize({ width, height });
    console.log(`Checking accessibility: ${theme} ${width}x${height} zoom ${zoom}`);
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=${theme}`);
    await page.evaluate(value => { document.documentElement.style.zoom = String(value); document.documentElement.classList.add('web-platform'); }, zoom);
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    const launcher = page.locator('.floating-messenger-launcher');
    await launcher.focus(); await launcher.press('Alt+Home'); await launcher.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true });
    await panel.waitFor();
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, JSON.stringify({ width, height, zoom, bounds }));
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await panel.evaluate(node => getComputedStyle(node).borderTopStyle), 'solid');
    assert.equal(await panel.evaluate(node => getComputedStyle(node.parentElement).filter), 'none');
    assert.equal(await launcher.locator('.floating-messenger-icon').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
    assert.equal(await launcher.locator('.floating-messenger-icon').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.locator('.pane-search input').press('Escape');
    await panel.waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForFunction(() => document.activeElement?.classList.contains('floating-messenger-launcher'));
  }
  await browser.close();
  console.log('Floating messenger: keyboard open/Escape/return focus, forced colors, reduced motion, 320px width, 480px height and 200% zoom passed in both themes.');
})().catch(async error => {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) console.error(await page.evaluate(() => ({ active: document.activeElement?.outerHTML.slice(0, 200),
    panels: [...document.querySelectorAll('[role=dialog]')].map(n => ({ name: n.getAttribute('aria-label'), hidden: n.hidden, animations: n.getAnimations().map(a => ({ state: a.playState, time: a.currentTime })) })) })));
  await browser?.close(); process.exit(1);
});
