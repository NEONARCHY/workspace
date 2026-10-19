// Local synthetic fixture only; never contact TEST or send business mutations.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Local layout QA: no server' } }));
  fs.mkdirSync('tmp/page-scroll-gutters', { recursive: true });
  const rows = [];
  for (const theme of ['light', 'dark']) for (const width of (process.env.QA_WIDTH ? [Number(process.env.QA_WIDTH)] : [1440, 1024, 640, 320])) {
    const cases = [...Array.from({ length: 16 }, (_, sample) => ({ section: 'samples', sample })),
      ...['notifications', 'calendar', 'payments', 'messenger', 'zoom', 'trips', 'tasks', 'letters', 'team'].map(section => ({ section }))];
    const beforeCount = rows.length;
    for (const test of cases) {
      if (process.env.QA_CASE && test.section !== process.env.QA_CASE) continue;
      if (process.env.QA_VERBOSE) console.log(theme, width, test.section, test.sample ?? 'real');
      await page.setViewportSize({ width, height: 768 });
      if (test.section === 'samples' && test.sample > 0) {
        await page.locator('[data-page-scroll-end]').evaluateAll(nodes => nodes.forEach(node => node.remove()));
        await page.locator('.app-content').evaluate(node => { node.scrollTop = 0; });
        await page.getByLabel('Макет раздела').selectOption(String(test.sample));
      } else {
        await page.goto(`http://127.0.0.1:5178/qa/page-canvas.html?theme=${theme}&section=${test.section}&sample=${test.sample ?? 0}`, { waitUntil: 'domcontentloaded' });
      }
      const main = page.locator('.app-content');
      await main.locator(':scope > *').first().waitFor();
      await page.waitForTimeout(100);
      const geometry = await main.evaluate(node => {
        const root = node.firstElementChild;
        const box = node.getBoundingClientRect(), content = root.getBoundingClientRect();
        const style = getComputedStyle(node), childStyle = getComputedStyle(root);
        return { right: innerWidth - content.right, scrollEdge: innerWidth - box.right,
          inset: node.offsetWidth - node.clientWidth, padding: parseFloat(style.paddingRight),
          rootPadding: childStyle.paddingRight, rootMargin: childStyle.marginRight,
          rootOverflow: childStyle.overflowY, pageOverflow: style.overflowY,
          width: node.clientWidth, scrollWidth: node.scrollWidth,
          className: root.className };
      });
      assert.ok(Math.abs(geometry.right - 20) <= 1, JSON.stringify({ theme, width, ...test, geometry }));
      assert.ok(Math.abs(geometry.scrollEdge - (width >= 1024 ? 4 : 12)) <= 1, JSON.stringify({ width, ...test, geometry }));
      assert.equal(geometry.rootOverflow, 'visible', JSON.stringify({ ...test, geometry }));
      assert.equal(geometry.pageOverflow, 'auto');
      assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify({ ...test, geometry }));
      if (test.section === 'team' && width !== 320) await page.screenshot({ path: `tmp/page-scroll-gutters/${theme}-${width}-team.png` });
      // Force page overflow without changing business data or inner list sizing.
      await main.evaluate(node => {
        const sentinel = document.createElement('button');
        sentinel.dataset.pageScrollEnd = 'true'; sentinel.textContent = 'Конец страницы · QA';
        // Roots retain their viewport height while their visible contents may
        // extend beyond it. Put the sentinel after that real overflow, not on it.
        const root = node.firstElementChild;
        const gap = Math.max(1200, root.scrollHeight - root.clientHeight + 100);
        sentinel.style.cssText = `display:block;margin-top:${gap}px;width:100%;min-height:44px;`;
        node.append(sentinel);
      });
      await main.focus(); await page.keyboard.press('PageDown'); await page.waitForTimeout(100);
      assert.ok(await main.evaluate(node => node.scrollTop > 0), `Keyboard scroll: ${test.section}`);
      await main.evaluate(node => { node.scrollTop = node.scrollHeight; });
      const end = await page.locator('[data-page-scroll-end]').boundingBox();
      assert.ok(end.y + end.height <= 769 && end.y >= 0, JSON.stringify({ test, width, end }));
      rows.push({ theme, width, ...test, ...geometry });
    }
    console.log(`Page scroll rails: ${theme}, ${width}px, ${rows.length - beforeCount} layouts passed.`);
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync('tmp/page-scroll-gutters/report.json', JSON.stringify(rows, null, 2));
  await browser.close();
  console.log(`${rows.length} page geometry/keyboard checks passed; real component views and all root classes, both themes.`);
})().catch(async error => {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: 'tmp/page-scroll-gutters/failure.png' }).catch(() => undefined);
  await browser?.close(); process.exit(1);
});
