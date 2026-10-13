// Synthetic shell QA only. All API calls intercepted; no organisation data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function exercise(browser, engine) {
  const results = [];
  const out = path.resolve(process.env.QA_THEME === 'dark' ? 'tmp/dark-theme/shell' : 'tmp/mobile-browser');
  await fs.mkdir(out, { recursive: true });
  for (const [width, height, touch] of [[320, 700, true], [360, 800, true], [390, 844, true], [768, 1024, true], [1024, 768, true], [1180, 820, true], [1440, 900, false]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
    const page = await context.newPage(); const errors = []; const requests = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/v1/**', async route => {
      const request = route.request(); requests.push(request.method());
      assert.equal(request.method(), 'GET', 'no mutation allowed');
      await route.fulfill({ json: request.url().includes('/workday/me') ? { status: 'not_started', schedule: { userId: 'mobile-qa', startsAt: '09:00:00', endsAt: '18:00:00' }, session: null, absenceKind: null, asOf: '2026-10-13T09:00:00Z' } : [] });
    });
    try {
      await page.goto('http://127.0.0.1:5173/qa/mobile-browser.html' + (process.env.QA_THEME === 'dark' ? '?theme=dark' : ''));
      if (width === 390) await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('button', { name: 'Начать работу', exact: true }).waitFor();
      const compact = width < 1440;
      const draft = page.locator('textarea[aria-label="Черновик"]');
      await draft.fill('Несохранённый ввод');
      const shell = await page.locator('.app-shell').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth, bounds: el.getBoundingClientRect().toJSON() }));
      assert(shell.scrollWidth <= shell.width + 1, JSON.stringify(shell));
      const header = await page.locator('.global-bar').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
      assert(header.scrollWidth <= header.width + 1, JSON.stringify(header));
      await page.screenshot({ path: path.join(out, `${engine}-${width}x${height}-shell.png`) });
      if (compact) {
        const trigger = page.getByRole('button', { name: 'Открыть меню', exact: true });
        assert(await trigger.isVisible());
        await trigger.click();
        const menu = page.getByRole('dialog', { name: 'Меню разделов' }); await menu.waitFor();
        if (width === 390) {
          for (let tab = 0; tab < 24; tab++) {
            await page.keyboard.press('Tab');
            assert(await page.evaluate(() => !!document.activeElement?.closest('.browser-navigation-dialog')), 'Tab stays in the modal menu');
          }
        }
        const box = await menu.boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, JSON.stringify(box));
        assert.equal(await menu.getByRole('button', { name: /Ещё/ }).count(), 0);
        const targets = await menu.locator('.rail-action,.rail-toggle,.rail-profile').evaluateAll(elements => elements.filter(e => e.getClientRects().length).map(e => ({ label: e.textContent, width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height })));
        assert(targets.every(t => t.width >= 48 && t.height >= 48), JSON.stringify(targets));
        await menu.getByRole('button', { name: 'Настройки', exact: true }).scrollIntoViewIfNeeded();
        assert(await menu.getByRole('button', { name: 'Настройки', exact: true }).isVisible());
        await page.screenshot({ path: path.join(out, `${engine}-${width}x${height}-menu-bottom.png`) });
        await menu.getByRole('button', { name: 'ИИ-модули', exact: true }).click();
        await menu.getByRole('button', { name: 'AI Hisobot', exact: true }).waitFor();
        await menu.getByRole('button', { name: 'AI Hisobot', exact: true }).click();
        await menu.waitFor({ state: 'hidden' });
        assert.equal(await draft.inputValue(), 'Несохранённый ввод');
        await trigger.click(); await menu.waitFor();
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.matches('.browser-menu-trigger'), undefined, { timeout: 3000 });
        assert(await trigger.evaluate(el => el === document.activeElement), 'focus must return to hamburger');
        await trigger.click(); await menu.waitFor();
        if (width === 390) {
          await page.mouse.click(width - 2, height / 2);
          await menu.waitFor({ state: 'hidden' });
          await trigger.click(); await menu.waitFor();
        }
        await page.setViewportSize({ width: height, height: width });
        assert.equal(await draft.inputValue(), 'Несохранённый ввод');
        await page.keyboard.press('Escape');
        await page.setViewportSize({ width, height: 360 });
        await trigger.click(); await menu.waitFor();
        const shortBox = await menu.boundingBox();
        assert(shortBox.y + shortBox.height <= 361, JSON.stringify(shortBox));
        await menu.getByRole('button', { name: 'Настройки', exact: true }).click();
        await menu.waitFor({ state: 'hidden' });
      } else {
        assert.equal(await page.getByRole('button', { name: 'Открыть меню', exact: true }).count(), 0);
        assert(await page.getByRole('complementary', { name: 'Основная навигация' }).isVisible());
      }
      assert.deepEqual(errors, []);
      results.push({ engine, width, height, touch, compact, shell, header, requests: requests.length, errors });
    } catch (error) {
      await page.screenshot({ path: path.join(out, `${engine}-${width}x${height}-failure.png`) });
      console.error('Fixture state:', (await page.locator('body').innerText()).slice(-2500), errors);
      throw error;
    } finally { await context.close(); }
  }
  return results;
}

async function main() {
  const results = [];
  const chromiumBrowser = await chromium.launch({ channel: 'msedge', headless: true });
  try { results.push(...await exercise(chromiumBrowser, 'chromium')); } finally { await chromiumBrowser.close(); }
  let webkitBrowser;
  try { webkitBrowser = await webkit.launch({ headless: true }); }
  catch (error) { console.log('WebKit runtime unavailable:', error.message.split('\n')[0]); }
  if (webkitBrowser) { try { results.push(...await exercise(webkitBrowser, 'webkit')); } finally { await webkitBrowser.close(); } }
  await fs.writeFile(path.resolve(process.env.QA_THEME === 'dark' ? 'tmp/dark-theme/shell/report.json' : 'tmp/mobile-browser/report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
