// Synthetic, read-only browser fixture. Measure the first selection, not a warmed repeat.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${process.env.QA_BASE_URL || 'http://127.0.0.1:5178'}/qa/detail-layout.html?view=messenger-forward&theme=dark&history=500`);
  const source = page.locator('[data-message-id="qa-text"]');
  await source.waitFor();
  await source.scrollIntoViewIfNeeded();
  await source.click({ button: 'right' });
  const select = page.getByRole('button', { name: 'Выделить', exact: true });
  await select.waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const before = await cdp.send('Performance.getMetrics');
  await page.evaluate(() => {
    window.selectionTiming = new Promise(resolve => {
      const button = [...document.querySelectorAll('.message-context-menu button')].find(node => node.textContent === 'Выделить');
      button.addEventListener('click', () => {
        const start = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
      }, { once: true });
    });
    window.stableMessageText = document.querySelector('[data-message-id="qa-history-0"] .message-text');
  });
  await select.click();
  const elapsed = await page.evaluate(() => window.selectionTiming);
  const after = await cdp.send('Performance.getMetrics');
  const durations = Object.fromEntries(after.metrics.filter(item => ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration'].includes(item.name))
    .map(item => [item.name, Math.round((item.value - before.metrics.find(prior => prior.name === item.name).value) * 1000)]));
  const marks = await page.getByRole('checkbox').count();
  assert.ok(marks > 0 && marks < 30, `only viewport markers should mount, got ${marks}`);
  assert.equal(await page.evaluate(() => window.stableMessageText === document.querySelector('[data-message-id="qa-history-0"] .message-text')), true);
  // A generous regression ceiling for shared CI/dev hosts, not an FPS guarantee.
  assert.ok(elapsed < 1000, `first selection took ${elapsed.toFixed(1)}ms`);
  const pane = page.getByLabel('Переписка', { exact: true });
  await pane.evaluate(node => { node.scrollTop = 0; });
  const earlier = page.getByRole('checkbox', { name: 'Выделить сообщение: Сообщение истории 0: проверка выделения без перестроения текста и вложений.', exact: true });
  await earlier.waitFor();
  await earlier.check();
  assert.ok((await page.getByRole('region', { name: 'Выделенные сообщения' }).textContent()).includes('Выбрано: 2'));
  await pane.evaluate(node => { node.scrollTop = node.scrollHeight; });
  const original = page.getByRole('checkbox', { name: 'Выделить сообщение: Второе сообщение', exact: true });
  await original.waitFor(); assert.equal(await original.isChecked(), true);
  fs.mkdirSync('tmp/messenger-forward-qa', { recursive: true });
  fs.writeFileSync('tmp/messenger-forward-qa/selection-performance.json', JSON.stringify({ messages: 502, visibleMarks: marks, firstSelectionToPaintMs: elapsed, durations }, null, 2));
  console.log(`First selection, 502 messages: ${elapsed.toFixed(1)}ms to second animation frame; text DOM retained. ${JSON.stringify(durations)}`);
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
