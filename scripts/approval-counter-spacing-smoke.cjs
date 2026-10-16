const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const dir = 'tmp/approval-counter-spacing-qa'; fs.mkdirSync(dir, { recursive: true });
  const report = [];
  for (const theme of ['light', 'dark']) for (const view of ['payments', 'trips']) {
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=${view}&theme=${theme}`);
    await page.evaluate(() => document.body.classList.add('web-platform'));
    const root = view === 'payments' ? '.approval-commandbar' : '.trip-overview';
    const cells = view === 'payments' ? '.approval-metric' : '.ws2-process-focus, .ws2-process-metrics > div';
    await page.locator(root).waitFor();
    for (const width of [1440, 1024, 720, 390]) {
      await page.setViewportSize({ width, height: 900 }); await page.waitForTimeout(200);
      const geometry = await page.locator(root).evaluate((node, selector) => {
        const outer = node.getBoundingClientRect(), style = getComputedStyle(node);
        const items = [...node.querySelectorAll(selector)].map(cell => {
          const box = cell.getBoundingClientRect(); const css = getComputedStyle(cell);
          return { x: box.x, y: box.y, w: box.width, h: box.height, scroll: cell.scrollWidth, client: cell.clientWidth, p: [css.paddingTop, css.paddingRight, css.paddingBottom, css.paddingLeft] };
        });
        return { outer: { x: outer.x, y: outer.y, w: outer.width, h: outer.height }, p: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], items };
      }, cells);
      assert.equal(geometry.items.length, 4);
      assert.equal(new Set(geometry.p).size, 1, JSON.stringify(geometry));
      assert.ok(Math.max(...geometry.items.map(item => item.w)) - Math.min(...geometry.items.map(item => item.w)) < 1, JSON.stringify({ theme, view, width, geometry }));
      assert.ok(geometry.items.every(item => item.scroll <= item.client + 1 && item.x >= geometry.outer.x && item.x + item.w <= geometry.outer.x + geometry.outer.w + 1), JSON.stringify({ theme, view, width, geometry }));
      assert.ok(Math.max(...geometry.items.map(item => item.h)) - Math.min(...geometry.items.map(item => item.h)) < 1, JSON.stringify(geometry));
      report.push({ theme, view, width, geometry });
      const vertical = await page.evaluate(({ root, view }) => {
        const summary = document.querySelector(root).getBoundingClientRect();
        const header = document.querySelector(view === 'payments' ? '.approvals-toolbar' : '.workflow-hero-header').getBoundingClientRect();
        const toolbar = document.querySelector(view === 'payments' ? '.approval-view-toolbar' : '.trip-commandbar');
        const controls = [...toolbar.children].map(child => child.getBoundingClientRect());
        return { above: summary.top - header.bottom, below: Math.min(...controls.map(box => box.top)) - summary.bottom };
      }, { root, view });
      assert.ok(Math.abs(vertical.above - vertical.below) < 1, JSON.stringify({ theme, view, width, vertical }));
      report.push({ theme, view, width, vertical });
      await page.locator(root).screenshot({ path: `${dir}/${theme}-${view}-${width}.png` });
      if (width === 1440) await page.screenshot({ path: `${dir}/${theme}-${view}-full.png` });
    }
    await page.locator(root).getByRole('button').focus(); await page.keyboard.press('Enter');
    if (view === 'payments') assert.equal(await page.locator(root).getByRole('button').getAttribute('aria-pressed'), 'true');
  }
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  await page.locator('.trip-overview').screenshot({ path: `${dir}/system-colors.png` });
  assert.deepEqual(errors, []); fs.writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); console.log('Counter spacing: 16 theme/viewport geometry checks and keyboard actions passed.');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
