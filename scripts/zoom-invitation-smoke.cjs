// Real production component, synthetic fixtures, no real meetings or messages.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('tmp/zoom-invitation');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ['edge', 'webkit']) {
    const browser = await (engine === 'edge' ? chromium.launch({ channel: 'msedge', headless: true }) : webkit.launch({ headless: true }));
    try {
      for (const width of [320, 390, 768, 1440]) for (const theme of ['light', 'dark']) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 1024 });
        await context.route('**/api/**', route => route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.QA_BASE_URL || 'http://127.0.0.1:5173'}/qa/zoom-invitation.html?theme=${theme}`);
        const card = page.locator('.zoom-invitation');
        try { await card.waitFor({ timeout: 60000 }); }
        catch (error) { console.error(errors, await page.locator('body').innerText()); await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
        await page.waitForTimeout(250);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const capture = async state => {
          await page.screenshot({ path: path.join(output, `${engine}-${width}-${theme}-${state}.png`), fullPage: true });
          const bounds = await card.boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'card overflow');
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflow');
          if (state !== 'forced-colors') {
            const audit = await page.evaluate(() => window.axe.run('.zoom-invitation', { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } }));
            assert.deepEqual(audit.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })), [], 'accessibility');
          }
        };
        await capture('pending');
        await page.getByRole('button', { name: /Участники/ }).focus();
        await page.keyboard.press('Enter');
        assert.equal(await page.getByRole('button', { name: /Участники/ }).getAttribute('aria-expanded'), 'true');
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: /Участники/ }).click();
        await page.waitForTimeout(250);
        assert(await page.locator('.zoom-invitation-people').evaluate(el => el.clientHeight <= 192 && el.scrollHeight > el.clientHeight), 'unbounded people');
        await capture('participants');
        await page.getByRole('button', { name: 'Принять', exact: true }).click();
        await page.getByText('Вы участвуете').waitFor();
        assert.equal(await page.getByRole('link', { name: 'Войти в Zoom' }).getAttribute('href'), 'https://zoom.us/j/123456789');
        await capture('accepted');
        await page.getByRole('button', { name: 'Отказаться', exact: true }).click();
        await page.getByRole('button', { name: 'Отказались', exact: true }).waitFor();
        await capture('declined');
        await page.getByRole('button', { name: 'cancelled', exact: true }).click();
        assert.equal(await card.getByRole('link').count(), 0);
        await capture('cancelled');
        await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
        await capture('forced-colors');
        assert.deepEqual(errors, []);
        report.push({ engine, width, theme, states: 6, errors });
        await context.close();
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: ${report.length * 6} visual/interaction states`);
})().catch(error => { console.error(error); process.exitCode = 1; });
