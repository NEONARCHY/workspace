// Synthetic full-page portal: no live account or API mutations.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  fs.mkdirSync('tmp/messenger-page-canvas', { recursive: true });
  for (const theme of ['light', 'dark']) for (const width of [1440, 1024, 640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=${theme}`);
    await page.evaluate(() => document.documentElement.classList.add('web-platform'));
    await page.getByRole('button', { name: 'Мессенджер', exact: true }).click();
    const full = page.getByRole('region', { name: 'Раздел мессенджера', exact: true });
    await full.waitFor();
    await full.locator('.chat-row').first().click();
    await page.waitForTimeout(400);
    const geometry = await full.evaluate(node => {
      const root = node.querySelector('.messenger-view'), style = getComputedStyle(root), bounds = root.getBoundingClientRect();
      const panes = [...root.children].filter(child => child.matches('.list-pane, .conversation-pane') && child.getClientRects().length)
        .map(child => ({ rect: child.getBoundingClientRect().toJSON(), radius: getComputedStyle(child).borderTopLeftRadius }));
      return { fill: style.backgroundColor, image: style.backgroundImage,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft], bounds: bounds.toJSON(),
        panes, overflow: root.scrollWidth > root.clientWidth + 1 };
    });
    assert.equal(geometry.fill, 'rgba(0, 0, 0, 0)'); assert.equal(geometry.image, 'none');
    assert.deepEqual(geometry.padding, ['0px', '0px', '0px', '0px']);
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.panes.length > 0);
    // Preserve the existing geometry: desktop has rounded paired panes;
    // the established <=760px single-pane layout is intentionally edge-to-edge.
    assert.ok(geometry.panes.every(pane => width > 760 ? parseFloat(pane.radius) >= 20 : pane.radius === '0px'), JSON.stringify({ theme, width, geometry }));
    assert.ok(Math.abs(geometry.panes[0].rect.left - geometry.bounds.left) < 1, JSON.stringify(geometry));
    assert.ok(Math.abs(geometry.panes.at(-1).rect.right - geometry.bounds.right) < 1, JSON.stringify(geometry));
    assert.ok(geometry.panes.every(pane => Math.abs(pane.rect.top - geometry.bounds.top) < 1
      && Math.abs(pane.rect.bottom - geometry.bounds.bottom) < 1), JSON.stringify(geometry));
    await page.screenshot({ path: `tmp/messenger-page-canvas/${theme}-${width}.png` });
    // The same mounted messenger still returns to the rounded mini window.
    await page.locator('.floating-messenger-launcher').click();
    const mini = page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true });
    await mini.waitFor();
    assert.equal(await mini.evaluate(node => getComputedStyle(node).borderTopLeftRadius), '22px');
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Full messenger: transparent root, zero outer padding, rounded panes fill bounds, no overflow, mini handoff in both themes at 4 widths passed.');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
