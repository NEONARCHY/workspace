// Synthetic long history: trusted mouse events, no live account writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:5178/qa/detail-layout.html?view=messenger-forward&theme=dark&history=500');
  const own = page.locator('[data-message-id="qa-text"]'); await own.waitFor(); await own.scrollIntoViewIfNeeded();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const text = own.locator('.message-text'); const box = await text.boundingBox();
  const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
  const metricsBefore = await cdp.send('Performance.getMetrics');
  await page.mouse.move(box.x + 10, box.y + 5);
  await page.evaluate(() => {
    window.paintStart = {};
    window.addEventListener('pointerdown', () => { window.paintStart.down = performance.now(); }, { capture: true, once: true });
    document.addEventListener('pointerdown', () => { window.paintStart.downHandlerMs = performance.now() - window.paintStart.down; }, { once: true });
  });
  await page.mouse.down();
  assert.equal(await own.locator('.message-reaction-trigger').evaluate(node => node.classList.contains('is-visible')), false, 'pointer focus must not prepare reactions/rebuild history');
  await page.evaluate(() => {
    window.paintReady = new Promise(resolve => {
      window.addEventListener('pointermove', () => { window.paintStart.move = performance.now(); }, { capture: true, once: true });
      const pane = document.querySelector('.message-scroll');
      const observer = new MutationObserver(() => {
        if (!pane.hasAttribute('data-message-selection')) return;
        observer.disconnect(); window.paintStart.moveToSelectionMs = performance.now() - window.paintStart.move; resolve(window.paintStart);
      });
      observer.observe(pane, { attributes: true, attributeFilter: ['data-message-selection'] });
    });
  });
  await page.mouse.move(box.x + 10, box.y + 7); // First 2px vertical movement inside native text.
  assert.equal(await page.getByLabel('Переписка', { exact: true }).getAttribute('data-paint-selecting'), 'true');
  const timing = await page.evaluate(() => window.paintReady);
  const metricsAfter = await cdp.send('Performance.getMetrics');
  const durations = Object.fromEntries(metricsAfter.metrics.filter(item => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(item.name)).map(item => [item.name, Math.round((item.value - metricsBefore.metrics.find(old => old.name === item.name).value) * 1000)]));
  console.log(JSON.stringify({ timing, durations }));
  assert.ok(timing.moveToSelectionMs < 500, JSON.stringify(timing)); // Shared dev host ceiling, not an FPS guarantee.
  await page.mouse.up();
  assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.getSelection()?.isCollapsed), true, 'painting clears native text selection');
  await page.getByRole('button', { name: 'Отменить выделение', exact: true }).click();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
  const restored = await text.boundingBox();
  await page.mouse.move(restored.x + 2, restored.y + 5); await page.mouse.down();
  await page.mouse.move(restored.x + 55, restored.y + 5, { steps: 3 }); await page.mouse.up();
  assert.equal(await page.getByRole('checkbox').count(), 0, 'horizontal text drag does not enter message selection');
  assert.ok(await page.evaluate(() => (window.getSelection()?.toString().length ?? 0) > 0), 'native horizontal copy remains available');
  await page.mouse.move(5, 5); await page.getByLabel('Переписка', { exact: true }).focus(); await text.hover();
  await own.locator('.message-reaction-trigger.is-visible').waitFor({ state: 'attached' });
  const hovered = await text.boundingBox();
  await page.mouse.move(hovered.x + 10, hovered.y + 5); await page.mouse.down();
  await page.evaluate(() => {
    window.hoverPaintReady = new Promise(resolve => {
      let start;
      window.addEventListener('pointermove', () => { start = performance.now(); }, { capture: true, once: true });
      const pane = document.querySelector('.message-scroll');
      const observer = new MutationObserver(() => {
        if (!pane.hasAttribute('data-message-selection')) return;
        observer.disconnect(); resolve(performance.now() - start);
      });
      observer.observe(pane, { attributes: true, attributeFilter: ['data-message-selection'] });
    });
  });
  await page.mouse.move(hovered.x + 10, hovered.y + 7);
  const hoveredMs = await page.evaluate(() => window.hoverPaintReady);
  assert.ok(hoveredMs < 500, `starting after reaction hover took ${hoveredMs}ms`);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Отменить выделение', exact: true }).click();
  console.log(`502 messages, first 2px movement: pointerdown ${timing.downHandlerMs.toFixed(1)}ms, move→selection ${timing.moveToSelectionMs.toFixed(1)}ms; no reaction preparation.`);
  console.log(`Starting after reactions already opened: ${hoveredMs.toFixed(1)}ms.`);
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
