// Real workflow components, synthetic records only. No business server writes.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve('tmp/mobile-workflows');
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
      // Fixture intercepts all API calls, including intentional save failures.
      await context.route('**/api/**', route => { throw new Error(`API escaped QA fixture: ${route.request().url()}`); });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const shot = async suffix => {
        await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().endTime)).map(animation => animation.finished.catch(() => {}))));
        await page.screenshot({ path: path.join(output, `${width}x${height}-${suffix}.png`) });
      };
      const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Document X overflow');
      const bounds = async selector => {
        const box = await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} X bounds`);
        return box;
      };
      let sharedEdge;
      const edges = [];
      const aligned = async (...selectors) => {
        if (!touch && width > 1023) return;
        for (const selector of selectors) {
          const box = await bounds(selector);
          sharedEdge ??= { left: box.x, right: box.x + box.width };
          edges.push({ selector, left: box.x, right: box.x + box.width });
          assert.ok(Math.abs(box.x - sharedEdge.left) <= 1 && Math.abs(box.x + box.width - sharedEdge.right) <= 1, `Unaligned ${selector}: ${JSON.stringify(edges.at(-1))} versus ${JSON.stringify(sharedEdge)}`);
        }
      };
      let formIndex = 0;
      const formViewport = async (surface, footer, input, save) => {
        await input.fill('Тестовый черновик — сохранить при повороте');
        if (touch) assert.equal(await input.evaluate(el => getComputedStyle(el).fontSize), '16px', 'Touch input size');
        await bounds(surface);
        if (touch || width <= 1023) {
          await page.evaluate(() => { visualViewport.shortHeight = 420; visualViewport.offsetTop = 60; visualViewport.dispatchEvent(new Event('resize')); });
          await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--ws-browser-height') === '420px');
          const box = await bounds(footer);
          assert.ok(box.y >= 60 && box.y + box.height <= 481, `${footer} keyboard bounds`);
        }
        await page.setViewportSize({ width: height, height: width });
        assert.equal(await input.inputValue(), 'Тестовый черновик — сохранить при повороте');
        await page.setViewportSize({ width,height });
        await page.evaluate(() => { visualViewport.shortHeight = null; visualViewport.offsetTop = 0; visualViewport.dispatchEvent(new Event('resize')); });
        await save.scrollIntoViewIfNeeded();
        await shot(`form-${++formIndex}`);
        assert.ok(await page.locator(surface).evaluate(el => el.contains(document.activeElement)), 'Form focus escaped after rotation');
        await page.keyboard.press('Escape');
        await page.locator(surface).waitFor({ state: 'hidden' });
      };
      try {
        await page.goto('http://127.0.0.1:5173/qa/mobile-workflows.html');
        await page.locator('.project-hub-project').first().waitFor();
        await noOverflow();
        await bounds('.project-hub-canvas');
        assert.equal(await page.locator('.project-hub-project').count(), 2);
        await aligned('.project-hub-header', '.project-hub-layout');
        if (width <= 700) await aligned('.project-hub-index', '.project-hub-canvas');
        await shot('projects');
        console.log('Checked projects', width);
        await page.getByRole('button', { name: 'Новый проект', exact: true }).click();
        await formViewport('.project-hub-dialog', '.project-hub-dialog-footer', page.locator('.project-hub-dialog').getByRole('textbox', { name: 'Название проекта', exact: true }), page.getByRole('button', { name: 'Сохранить проект', exact: true }));
        await page.getByRole('button', { name: 'Бюджет и расходы', exact: true }).click();
        await page.getByRole('button', { name: 'Добавить статью', exact: true }).click();
        const articleInput = page.locator('.project-budget-dialog').getByRole('textbox', { name: 'Название статьи', exact: true });
        await articleInput.fill('Тестовая статья с сохранением при ошибке');
        await page.getByRole('button', { name: 'Сохранить статью', exact: true }).click();
        await page.locator('.project-budget-dialog [role="alert"]').waitFor();
        assert.equal(await articleInput.inputValue(), 'Тестовая статья с сохранением при ошибке');
        await bounds('.project-budget-table');
        await formViewport('.project-budget-dialog', '.project-budget-dialog > footer', articleInput, page.getByRole('button', { name: 'Сохранить статью', exact: true }));
        await page.getByRole('button', { name: 'Из документов с ИИ', exact: true }).click();
        await bounds('.project-import-dialog');
        await page.locator('.project-import-dialog input[type="file"]').setInputFiles({ name: 'synthetic-mobile.txt', mimeType: 'text/plain', buffer: Buffer.from('Only synthetic QA content') });
        await page.locator('.project-import-file').waitFor();
        await shot('import');
        await page.keyboard.press('Escape');
        await page.locator('.project-import-dialog').waitFor({ state: 'hidden' });
        await page.locator('.project-hub-workstream-card').first().click();
        const taskBoard = page.locator('.project-hub-task-board');
        await bounds('.project-hub-task-board');
        assert.equal(await taskBoard.locator('.project-hub-task-lane').count(), 5);
        await taskBoard.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        assert.ok(await taskBoard.evaluate(el => el.scrollLeft > 0));
        await noOverflow();
        await page.getByRole('button', { name: 'Проектные', exact: true }).click();
        await page.locator('.project-hub-funding-card').first().waitFor();
        const fundingBoard = page.locator('.project-hub-funding-board');
        await bounds('.project-hub-funding-board');
        assert.equal(await fundingBoard.locator('.project-hub-funding-lane').count(), 4);
        await fundingBoard.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        assert.ok(await fundingBoard.evaluate(el => el.scrollWidth <= el.clientWidth + 1 || el.scrollLeft > 0));
        assert.equal(await page.locator('.project-hub-funding-card').count(), 24);
        await aligned('.project-hub-header', '.project-hub-funding-layout');
        if (width <= 700) await aligned('.project-hub-funding-board', '.project-hub-funding-detail');
        await shot('funding');
        console.log('Checked funding', width);
        await page.getByRole('button', { name: 'Новая проектная заявка', exact: true }).click();
        await formViewport('.project-hub-dialog', '.project-hub-dialog-footer', page.locator('.project-hub-dialog').getByRole('textbox', { name: 'Название', exact: true }), page.locator('.project-hub-dialog').getByRole('button', { name: 'Отправить на согласование', exact: true }));
        await page.getByRole('button', { name: 'Оплаты', exact: true }).click();
        await page.locator('.approval-board-card').first().waitFor();
        await noOverflow();
        await bounds('.approval-kanban');
        await aligned('.approvals-toolbar', '.approval-commandbar', '.approval-kanban');
        await shot('payments');
        console.log('Checked payments', width);
        await page.locator('.approval-card-open').first().click();
        await bounds('.approval-detail-panel');
        await page.getByRole('button', { name: 'Файлы', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.locator('.approval-detail-panel').waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Список', exact: true }).click();
        assert.equal(await page.locator('.approval-record-list .process-record-row').count(), 12);
        await noOverflow();
        await aligned('.approval-record-list');
        await shot('payment-list');
        await page.getByRole('button', { name: 'Новая заявка', exact: true }).click();
        await formViewport('.approval-create-panel', '.record-composer-footer', page.getByRole('textbox', { name: /Название заявки/ }), page.getByRole('button', { name: 'Отправить по маршруту', exact: true }));
        await page.getByRole('button', { name: 'Поездки', exact: true }).click();
        await page.locator('.trip-board-card').first().waitFor();
        await noOverflow();
        await bounds('.trip-kanban');
        await aligned('.workflow-hero-header', '.trip-overview', '.trip-kanban');
        await shot('trips');
        console.log('Checked trips', width);
        if (touch) {
          const grip = page.locator('.trip-board-card .spatial-grip').first();
          assert.ok(await grip.evaluate(el => getComputedStyle(el).pointerEvents !== 'none'));
          const box = await grip.boundingBox();
          assert.ok(box.width >= 48 && box.height >= 48);
          await page.locator('.trip-board-card').first().dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 1, isPrimary: true, clientX: 40, clientY: 400, button: 0 });
          await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', pointerId: 1, clientX: 100, clientY: 420 })));
          assert.equal(await page.locator('.spatial-drag-preview').count(), 0);
          await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch', pointerId: 1 })));
        }
        await page.locator('.trip-board-card .approval-card-open').first().click();
        await bounds('.trip-dialog.context-record-dialog');
        await page.getByRole('button', { name: 'Закрыть карточку поездки', exact: true }).click();
        await page.getByRole('button', { name: 'Список', exact: true }).click();
        assert.equal(await page.locator('.trip-list-item').count(), 12);
        await noOverflow();
        await aligned('.trip-list');
        await page.getByRole('button', { name: 'Новая командировка', exact: true }).click();
        await formViewport('.record-composer-dialog', '.record-composer-footer', page.getByRole('textbox', { name: 'Цель поездки', exact: true }), page.getByRole('button', { name: 'Сохранить', exact: true }));
        await page.getByRole('button', { name: 'Календарь', exact: true }).click();
        await page.getByRole('grid').waitFor();
        await noOverflow();
        await bounds('.calendar-board');
        await aligned('.calendar-toolbar', '.calendar-board', '.calendar-side');
        assert.equal(await page.locator('.calendar-day-agenda .calendar-agenda-card').count(), 5);
        await shot('calendar-grid');
        if (width <= 700) {
          assert.equal(await page.locator('.calendar-day-events:visible').count(), 0);
          await page.getByRole('button', { name: 'События выбранного дня · 5', exact: true }).click();
          assert.ok(await page.locator('.calendar-side').evaluate(el => el === document.activeElement));
        }
        await shot('calendar');
        await page.locator('.calendar-agenda-card').first().click();
        await bounds('.calendar-detail');
        await page.getByRole('button', { name: 'К событиям дня', exact: true }).click();
        await page.getByRole('button', { name: 'Новое событие', exact: true }).click();
        await formViewport('.record-composer-dialog', '.record-composer-footer', page.getByRole('textbox', { name: /Название/ }).first(), page.getByRole('button', { name: /^Создать/ }).first());
        assert.deepEqual(errors, [], 'Page errors');
        report.push({ width,height,touch, result: 'passed', edges, keyboard: 'synthetic VisualViewport; not OS keyboard' });
        console.log('PASS', width,height);
      } catch (error) {
        await shot('failure');
        console.log(await page.locator('button:visible').allTextContents());
        console.log(await page.locator('input:visible').evaluateAll(inputs => inputs.map(el => ({ label: el.getAttribute('aria-label'), placeholder: el.placeholder, id: el.id }))));
        throw error;
      } finally { await context.close(); }
    }
  } finally { fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report,null,2)); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
