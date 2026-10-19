// Synthetic fixtures only: trusted right-click, including focus before contextmenu.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5178/qa/detail-layout.html?view=messenger-forward&theme=dark&history=500');
  const own = page.locator('[data-message-id="qa-text"]'); await own.waitFor(); await own.scrollIntoViewIfNeeded();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => {
    window.warmedMenuHosts = new Set(document.querySelectorAll('[data-portal-node="true"]'));
    window.menuTiming = new Promise(resolve => {
      let down = 0, context = 0;
      window.addEventListener('pointerdown', () => { down = performance.now(); }, { capture: true, once: true });
      window.addEventListener('contextmenu', () => { context = performance.now(); }, { capture: true, once: true });
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.message-context-stack')) return;
        observer.disconnect(); const mounted = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({ downToMountMs: mounted - down,
          contextToMountMs: mounted - context, downToPaintMs: performance.now() - down })));
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
  });
  await own.click({ button: 'right' });
  const timing = await page.evaluate(() => window.menuTiming);
  const after = await cdp.send('Performance.getMetrics');
  const durations = Object.fromEntries(after.metrics.filter(item => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(item.name)).map(item => [item.name, Math.round((item.value - before.metrics.find(old => old.name === item.name).value) * 1000)]));
  console.log(JSON.stringify({ messages: 502, timing, durations }));
  assert.ok(timing.downToMountMs < 500, 'shared dev-host regression ceiling, not an FPS guarantee');
  await page.getByRole('button', { name: 'Ответить', exact: true }).waitFor();
  assert.equal(await own.locator('.message-reaction-trigger').evaluate(node => node.classList.contains('is-visible')), false, 'pointer focus does not prepare the hover reaction strip');
  assert.equal(await page.locator('.message-context-stack').evaluate(node => window.warmedMenuHosts.has(node.closest('[data-portal-node="true"]'))), true, 'cold menu reuses the already themed host');
  assert.equal(await page.getByRole('group', { name: 'Быстрые реакции', exact: true }).getByRole('button').count(), 8);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-context-stack').count(), 0);
  await own.click({ button: 'right' }); await page.getByRole('button', { name: 'Ответить', exact: true }).waitFor();
  assert.equal(await page.locator('.message-context-stack').evaluate(node => window.warmedMenuHosts.has(node.closest('[data-portal-node="true"]'))), true, 'repeat opening retains its host');
  await page.getByRole('button', { name: 'Все реакции', exact: true }).click();
  await page.getByRole('textbox', { name: 'Поиск эмодзи', exact: true }).waitFor();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-context-stack').count(), 0);
  await page.locator('.reaction-picker-context-popover').waitFor({ state: 'detached' });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'empty warm host causes no horizontal overflow');
  await page.getByLabel('Переписка', { exact: true }).focus(); await page.keyboard.press('Tab'); await own.focus();
  await own.press('Shift+F10'); await page.getByRole('button', { name: 'Ответить', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.message-context-stack').count(), 0, 'keyboard menu still closes with Escape');
  assert.deepEqual(errors, []);
  console.log('Cold/repeat host identity, 7 quick reactions, full picker, Shift+F10, Escape and no overflow passed.');
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
