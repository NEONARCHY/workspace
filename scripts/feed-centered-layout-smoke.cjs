// Synthetic local fixture only; never access real employees or mutate records.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Local QA only' } }));
  fs.mkdirSync('tmp/feed-centered-layout', { recursive: true });
  const rows = [];
  for (const theme of ['light', 'dark']) for (const width of [1920, 1440, 1024, 640, 320]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(`http://127.0.0.1:5178/qa/page-canvas.html?section=feed&theme=${theme}`);
    await page.getByRole('heading', { name: 'Новости команды' }).waitFor();
    const geometry = await page.locator('.feed-view').evaluate(feed => {
      const root = feed.getBoundingClientRect();
      const style = getComputedStyle(feed);
      const header = feed.querySelector('.ws-section-header').getBoundingClientRect();
      const main = feed.querySelector('.feed-main').getBoundingClientRect();
      const side = feed.querySelector('.feed-side').getBoundingClientRect();
      const left = root.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
      const right = root.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
      const owner = feed.closest('.app-content');
      return { leftGap: header.left - left, rightGap: right - header.right,
        headerLeft: header.left, headerRight: header.right, mainLeft: main.left,
        mainRight: main.right, sideLeft: side.left, sideRight: side.right,
        mainTop: main.top, sideTop: side.top, scrollWidth: owner.scrollWidth, clientWidth: owner.clientWidth };
    });
    assert.ok(Math.abs(geometry.leftGap - geometry.rightGap) <= 1, JSON.stringify({ theme, width, geometry }));
    assert.ok(Math.abs(geometry.mainLeft - geometry.headerLeft) <= 1, JSON.stringify({ theme, width, geometry }));
    assert.ok(Math.abs(geometry.sideRight - geometry.headerRight) <= 1, JSON.stringify({ theme, width, geometry }));
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, JSON.stringify({ theme, width, geometry }));
    if (width >= 1440) {
      assert.ok(geometry.sideLeft > geometry.mainRight, 'Desktop keeps two separate columns');
      assert.ok(Math.abs(geometry.mainTop - geometry.sideTop) <= 1, 'Desktop columns start on the same row');
    }
    await page.screenshot({ path: `tmp/feed-centered-layout/${theme}-${width}.png` });
    rows.push({ theme, width, ...geometry });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync('tmp/feed-centered-layout/report.json', JSON.stringify(rows, null, 2));
  console.log(`${rows.length} feed centering, alignment and overflow checks passed.`);
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
