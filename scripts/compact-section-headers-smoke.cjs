// Local synthetic fixtures only: no real accounts, API writes or deployments.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const output = 'tmp/compact-section-headers';
  fs.mkdirSync(output, { recursive: true });
  const report = [];
  for (const theme of ['light', 'dark']) for (const width of [320, 390, 600, 601, 768, 1024, 1366, 1440]) {
    const compact = width <= 1366 && width !== 1440;
    const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: compact, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Synthetic layout QA' } }));
    await page.goto(`http://127.0.0.1:5178/qa/page-canvas.html?section=headers&theme=${theme}`);
    await page.getByRole('heading', { name: 'Заявки на оплату', exact: true }).waitFor();
    const rows = await page.locator('.qa-header-matrix header').evaluateAll(headers => headers.map(header => {
      const box = header.getBoundingClientRect(), style = getComputedStyle(header);
      return { title: header.querySelector('h1').textContent, height: box.height, minHeight: style.minHeight,
        paddingTop: style.paddingTop, paddingBottom: style.paddingBottom,
        buttons: [...header.querySelectorAll('button')].map(button => {
          const b = button.getBoundingClientRect();
          return { label: button.textContent, height: b.height, width: b.width,
            contained: b.left >= box.left - 1 && b.right <= box.right + 1 && b.top >= box.top - 1 && b.bottom <= box.bottom + 1 };
        }),
        descriptionHidden: [...header.querySelectorAll('p')].every(p => getComputedStyle(p).display === 'none'),
        artHidden: [...header.querySelectorAll('.ws-section-header-art')].every(art => getComputedStyle(art).display === 'none'),
      };
    }));
    assert.equal(rows.length, 11);
    for (const row of rows) {
      if (compact) {
        assert.equal(row.minHeight, '0px', JSON.stringify({ width, row }));
        assert.ok(row.descriptionHidden && row.artHidden, JSON.stringify({ width, row }));
        assert.ok(row.height <= (width <= 600 ? 230 : 180), JSON.stringify({ width, row }));
        for (const button of row.buttons) assert.ok(button.height >= 44 && button.width >= 44 && button.contained, JSON.stringify({ width, row, button }));
      } else if (!['Входящие письма', 'Аналитика опросов'].includes(row.title)) {
        assert.equal(row.minHeight, '116px');
        assert.ok(!row.artHidden && !row.descriptionHidden);
      }
    }
    for (const button of await page.locator('.qa-header-matrix button').all()) {
      const label = await button.textContent();
      await button.click();
      assert.equal(await page.locator('[data-header-result]').textContent(), label);
      await button.focus();
      assert.ok(await button.evaluate(node => document.activeElement === node), `Keyboard focus: ${label}`);
    }
    assert.ok(await page.locator('.app-content').evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.locator('.app-content').evaluate(node => { node.scrollTop = 0; });
    await page.screenshot({ path: `${output}/${theme}-${width}-headers.png`, fullPage: true });
    if (theme === 'dark' && [390, 768, 1440].includes(width)) {
      for (const [index, header] of (await page.locator('.qa-header-matrix header').all()).entries()) {
        await header.screenshot({ path: `${output}/${theme}-${width}-header-${index}.png` });
      }
    }
    await page.goto(`http://127.0.0.1:5178/qa/topbar-context.html?theme=${theme}&assistant`);
    const trigger = page.locator('.section-jump-trigger');
    await trigger.waitFor({ state: 'attached' });
    assert.equal(await trigger.isVisible(), width > 600, `Global section search at ${width}`);
    if (width > 600) {
      await trigger.click();
      await page.getByRole('dialog').filter({ has: page.getByRole('textbox') }).waitFor();
      await page.keyboard.press('Escape');
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${theme}-${width}-topbar.png` });
    report.push({ theme, width, rows, searchVisible: width > 600 });
    await context.close();
    console.log(`${theme} ${width}px: 11 header layouts/actions and phone search rule passed`);
  }
  for (const width of [390, 768]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, hasTouch: true, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Synthetic QA only' } }));
    for (const section of ['payments', 'trips', 'letters', 'survey', 'zoom']) {
      await page.goto(`http://127.0.0.1:5178/qa/page-canvas.html?section=${section}&theme=dark`);
      const header = page.locator('.app-content').locator('.ws-section-header, .edo-incoming-header, .survey-heading').first();
      await header.getByRole('heading').first().waitFor();
      const geometry = await header.evaluate(node => ({ min: getComputedStyle(node).minHeight,
        width: node.clientWidth, scrollWidth: node.scrollWidth,
        buttons: [...node.querySelectorAll('button')].filter(button => getComputedStyle(button).display !== 'none').map(button => ({ label: button.textContent, height: button.getBoundingClientRect().height })) }));
      assert.equal(geometry.min, '0px', JSON.stringify({ width, section, geometry }));
      assert.ok(geometry.scrollWidth <= geometry.width + 1, JSON.stringify({ width, section, geometry }));
      for (const button of geometry.buttons) assert.ok(button.height >= 44, JSON.stringify({ width, section, button }));
      await header.screenshot({ path: `${output}/real-${section}-${width}.png` });
      report.push({ width, section, geometry });
    }
    await context.close();
  }
  const landscape = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const landscapePage = await landscape.newPage();
  await landscapePage.goto('http://127.0.0.1:5178/qa/topbar-context.html?theme=dark');
  await landscapePage.locator('.section-jump-trigger').waitFor({ state: 'attached' });
  assert.equal(await landscapePage.locator('.section-jump-trigger').isVisible(), false, 'Landscape phone search');
  await landscape.close();
  fs.writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
