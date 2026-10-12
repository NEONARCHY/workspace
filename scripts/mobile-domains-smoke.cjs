// Synthetic data, real renderer components, no business API mutations.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve('tmp/mobile-domains');
fs.mkdirSync(output, { recursive: true });
const cases = [[320,700,true],[390,844,true],[768,1024,true],[1024,768,true],[1180,820,true],[1440,900,false]];
const report = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width,height,touch] of cases) {
      const context = await browser.newContext({ viewport: { width,height }, hasTouch: touch, isMobile: touch, reducedMotion: width === 390 ? 'no-preference' : 'reduce' });
      await context.addInitScript(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, { offsetTop: 0, scale: 1, shortHeight: null });
        Object.defineProperty(viewport, 'height', { get: () => viewport.shortHeight ?? window.innerHeight });
        Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
      });
      await context.route('**/api/**', async route => {
        assert.equal(route.request().method(), 'GET', 'Unexpected business mutation');
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const shot = async suffix => page.screenshot({ path: path.join(output, `${width}x${height}-${suffix}.png`) });
      const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Document overflow');
      const visibleBounds = async selector => {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} width`);
        return box;
      };
      try {
        await page.goto('http://127.0.0.1:5173/qa/mobile-domains.html');
        await page.getByRole('heading', { name: 'Сообщения' }).waitFor();
        await noOverflow();
        if (width <= 800) await page.locator('.chat-row').first().click();
        const input = page.getByRole('textbox', { name: 'Новое сообщение' });
        await input.fill('Тестовый черновик — сохранить при возврате и повороте');
        if (width <= 800) {
          await page.getByRole('button', { name: 'Действия переписки', exact: true }).click();
          await page.getByRole('button', { name: 'Поиск в переписке', exact: true }).click();
          await page.getByRole('textbox', { name: 'Поиск в переписке', exact: true }).fill('Несуществующее сообщение');
          await page.getByRole('button', { name: 'Действия переписки', exact: true }).click();
          await page.getByRole('button', { name: 'Закрыть поиск', exact: true }).click();
          await page.locator('.message:visible').first().waitFor();
        }
        await visibleBounds('.composer');
        await visibleBounds('.composer-input');
        if (touch) {
          const actions = page.locator('.message:visible .browser-message-menu').first();
          await actions.click();
          await page.getByRole('button', { name: 'Ответить', exact: true }).waitFor();
          await page.getByRole('button', { name: /^Реакции ·/ }).count();
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('.message-context-menu'));
          assert.equal(await actions.evaluate(el => el === document.activeElement), true);
          if (width <= 800) {
            await page.getByRole('button', { name: 'К списку чатов' }).click();
            await page.waitForFunction(() => document.activeElement?.classList.contains('chat-row'));
            await page.locator('.browser-chat-menu').first().click();
            await page.getByRole('menuitem', { name: 'В архив', exact: true }).waitFor();
            await page.keyboard.press('Escape');
            await page.locator('.chat-row').first().click();
            assert.equal(await input.inputValue(), 'Тестовый черновик — сохранить при возврате и повороте');
          }
        } else assert.equal(await page.locator('.browser-message-menu:visible').count(), 0);
        await shot('chat');
        // Exercise the actual observer contract with a short/panned visual viewport.
        await page.evaluate(() => { window.visualViewport.shortHeight = 360; window.visualViewport.offsetTop = 60; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--ws-browser-height') === '360px');
        if (width <= 800) {
          const send = await page.getByRole('button', { name: 'Отправить сообщение' }).boundingBox();
          assert.ok(send && send.y + send.height <= 361, 'Send hidden by reduced viewport');
        }
        await page.evaluate(() => { window.visualViewport.shortHeight = null; window.visualViewport.offsetTop = 0; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.getByRole('button', { name: 'Задачи', exact: true }).click();
        await noOverflow();
        await visibleBounds('.task-records');
        assert.equal(await page.getByRole('columnheader').count(), 6);
        assert.equal(await page.locator('.task-record-table tbody tr').count(), 25);
        if (width <= 700) {
          const card = page.locator('.task-record-table tbody tr').first();
          assert.equal(await card.evaluate(el => getComputedStyle(el).display), 'grid');
          assert.equal(await card.getByRole('cell').count(), 6);
        }
        await page.getByRole('button', { name: 'Следующая страница: задачи' }).click();
        assert.equal(await page.locator('.task-record-table tbody tr').count(), 6);
        await shot('tasks');
        await page.getByRole('button', { name: 'Люди', exact: true }).click();
        await page.getByRole('checkbox', { name: 'Выбрать сотрудников на странице' }).check();
        assert.equal(await page.locator('.employee-record-table tbody tr[aria-selected=true]').count(), 25);
        await noOverflow();
        await visibleBounds('.employee-records');
        await shot('people');
        await page.getByRole('button', { name: 'Форма', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: 'Новая задача', exact: true });
        await dialog.waitFor();
        const title = dialog.getByRole('textbox', { name: /^Название/ });
        await title.fill('Тестовый черновик большой формы');
        await visibleBounds('.record-composer-dialog');
        await noOverflow();
        await page.evaluate(() => { window.visualViewport.shortHeight = 420; window.visualViewport.offsetTop = 80; window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--ws-browser-height') === '420px');
        const footer = await page.locator('.record-composer-footer').boundingBox();
        if (width < 1366 && touch) assert.ok(footer && footer.y >= 80 && footer.y + footer.height <= 501, 'Form footer hidden');
        await title.fill('Тестовый черновик большой формы');
        await page.setViewportSize({ width: height, height: width });
        assert.equal(await title.inputValue(), 'Тестовый черновик большой формы');
        await page.evaluate(() => { window.visualViewport.shortHeight = Math.min(420, window.innerHeight - 80); window.visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForFunction(() => Number.parseFloat(document.documentElement.style.getPropertyValue('--ws-browser-height')) <= window.innerHeight);
        await page.setViewportSize({ width, height });
        await page.evaluate(() => { window.visualViewport.shortHeight = null; window.visualViewport.offsetTop = 0; window.visualViewport.dispatchEvent(new Event('resize')); });
        await shot('form');
        await dialog.getByRole('button', { name: 'Добавить задачу', exact: true }).click();
        await dialog.getByRole('alert').filter({ hasText: 'Тестовая ошибка сохранения' }).waitFor();
        assert.equal(await title.inputValue(), 'Тестовый черновик большой формы');
        await dialog.getByRole('button', { name: 'Закрыть форму создания' }).click();
        assert.deepEqual(errors, []);
        report.push({ width,height,touch,pass: true });
        console.log(`PASS ${width}x${height} chat/tables/form`);
      } catch (error) {
        await shot('failure');
        console.error(await page.locator('body').innerText());
        throw error;
      } finally { await context.close(); }
    }
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report,null,2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
