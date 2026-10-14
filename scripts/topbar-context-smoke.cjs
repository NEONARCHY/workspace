// Production header/popovers, isolated synthetic providers. Never mutates live data.
const { chromium, webkit } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const output = path.resolve('tmp/topbar-context');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const report = [];
  for (const engine of ['edge', 'webkit']) {
    const browser = await (engine === 'edge' ? chromium.launch({ channel: 'msedge', headless: true }) : webkit.launch({ headless: true }));
    try {
      for (const width of [320,390,768,1024,1440]) for (const theme of ['light','dark']) {
        console.log(`Checking ${engine} ${width} ${theme}`);
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 1024 });
        await context.route('**/api/**', route => route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.QA_BASE_URL || 'http://127.0.0.1:5188'}/qa/topbar-context.html?theme=${theme}`);
        const currency = page.getByRole('button', { name: /Курсы валют: 1 USD — 12.*000/ });
        await currency.waitFor({ timeout: 60000 });
        await page.getByRole('button', { name: 'Начать работу', exact: true }).waitFor();
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const capture = async state => {
          await page.waitForTimeout(300);
          await page.screenshot({ path: path.join(output, `${engine}-${width}-${theme}-${state}.png`), fullPage: true });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page overflow');
          const workday = await page.locator('.workspace-workday-person .workday-control').boundingBox();
          const identity = await page.locator('.workspace-workday-person .workspace-identity').boundingBox();
          assert(workday && identity && workday.x + workday.width <= identity.x + 1 && Math.abs(workday.y - identity.y) < 10, 'workday immediately left of identity');
          assert(await page.evaluate(() => document.querySelector('main').getBoundingClientRect().top >= document.querySelector('.global-bar').getBoundingClientRect().bottom - 1), 'header overlaps content');
          const panel = page.locator('.topbar-context-surface:visible');
          if (await panel.count()) {
            const bounds = await panel.boundingBox();
            assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 901, 'popover overflow');
          }
          const audit = await page.evaluate(() => window.axe.run(document.querySelector('.topbar-context-surface') || document.querySelector('.topbar-insights'), { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } }));
          assert.deepEqual(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], 'accessibility');
        };
        await capture('header');
        await currency.click();
        await page.getByRole('dialog', { name: 'Курсы валют' }).waitFor();
        await page.getByRole('button', { name: /EUR Евро/ }).click();
        await page.getByRole('textbox', { name: 'Сумма в EUR' }).fill('2,5');
        assert.match(await page.locator('output').innerText(), /33.*750 UZS/);
        await capture('currency');
        await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Курсы валют' }).waitFor({ state: 'hidden' });
        await page.waitForFunction(el => document.activeElement === el, await currency.elementHandle());
        assert(await currency.evaluate(el => document.activeElement === el), 'currency focus not restored');
        await page.getByRole('button', { name: /Погода в Ташкенте: 13,3/ }).click();
        await page.getByRole('dialog', { name: 'Погода Узбекистана' }).waitFor();
        assert.equal(await page.getByRole('button', { name: /^Погода:/ }).count(), 13);
        await capture('regions');
        await page.getByRole('button', { name: 'Погода: Ташкентская область' }).click();
        await page.getByRole('button', { name: 'К списку областей' }).waitFor();
        assert(await page.getByRole('button', { name: 'К списку областей' }).evaluate(el => document.activeElement === el), 'detail focus');
        assert.equal(await page.locator('.context-panel-body:visible').evaluate(el => el.scrollTop), 0, 'detail starts at top');
        await capture('detail');
        await page.getByRole('button', { name: 'К списку областей' }).click();
        assert(await page.getByRole('button', { name: 'Погода: Ташкентская область' }).evaluate(el => document.activeElement === el), 'list focus');
        await page.keyboard.press('Escape');
        assert.deepEqual(errors, []);
        report.push({ engine, width, theme, states: 4, errors });
        await context.close();
      }
      for (const item of [
        { id: 'assistant-phone-light', width: 320, height: 740, theme: 'light', query: '&assistant' },
        { id: 'assistant-phone-dark', width: 390, height: 740, theme: 'dark', query: '&assistant' },
        { id: 'assistant-tablet', width: 768, height: 900, theme: 'dark', query: '&assistant' },
        { id: 'assistant-desktop', width: 1440, height: 900, theme: 'dark', query: '&assistant' },
        { id: 'short-reflow', width: 720, height: 480, theme: 'light', query: '' },
        { id: 'unavailable', width: 390, height: 600, theme: 'dark', query: '&state=error' },
        { id: 'cached', width: 390, height: 600, theme: 'light', query: '&state=stale' },
        { id: 'air-unavailable', width: 390, height: 600, theme: 'dark', query: '&state=air-unavailable' },
        { id: 'system-colors', width: 390, height: 740, theme: 'dark', query: '', system: true },
      ]) {
        console.log(`Checking ${engine} ${item.id}`);
        const context = await browser.newContext({ viewport: { width: item.width, height: item.height }, hasTouch: item.width < 1024,
          ...(item.system ? { forcedColors: 'active', reducedMotion: 'reduce' } : {}) });
        await context.route('**/api/**', route => route.abort());
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`${process.env.QA_BASE_URL || 'http://127.0.0.1:5188'}/qa/topbar-context.html?theme=${item.theme}${item.query}`);
        const trigger = page.getByRole('button', { name: /^Курсы валют:/ });
        await trigger.waitFor({ timeout: 60000 });
        await page.getByRole('button', { name: 'Начать работу', exact: true }).waitFor();
        await page.waitForTimeout(300);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'extra header overflow');
        await page.screenshot({ path: path.join(output, `${engine}-${item.id}-header.png`), fullPage: true });
        await (item.id === 'air-unavailable' ? page.getByRole('button', { name: /^Погода в Ташкенте:/ }) : trigger).click();
        await page.locator('.topbar-context-surface:visible').waitFor();
        if (item.id === 'unavailable') await page.getByRole('alert').waitFor();
        if (item.id === 'cached') await page.getByText('Показаны последние сохранённые курсы. Источник сейчас недоступен.').waitFor();
        if (item.id === 'air-unavailable') await page.getByText('Данные качества воздуха временно недоступны.').waitFor();
        await page.waitForTimeout(300);
        const bounds = await page.locator('.topbar-context-surface:visible').boundingBox();
        assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= item.width + 1 && bounds.y + bounds.height <= item.height + 1, 'extra panel overflow');
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const audit = await page.evaluate(() => window.axe.run(document.querySelector('.topbar-context-surface'), { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa'] } }));
        assert.deepEqual(audit.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })), [], 'extra accessibility');
        await page.screenshot({ path: path.join(output, `${engine}-${item.id}-panel.png`), fullPage: true });
        assert.deepEqual(errors, []);
        report.push({ engine, scenario: item.id, states: 2, errors });
        await context.close();
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`PASS: ${report.reduce((sum, item) => sum + item.states, 0)} header/popover states; 80 primary and 18 additional accessibility scans`);
})().catch(error => { console.error(error); process.exitCode = 1; });
