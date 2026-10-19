// Synthetic fixtures only; no live messages or account mutations.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
const settle = page => page.evaluate(() => Promise.all(document.getAnimations()
  .filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const theme of ['light', 'dark']) for (const width of [1440, 640, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=messenger-forward&theme=${theme}&history=30`);
    const pane = page.getByLabel('Переписка', { exact: true });
    await pane.waitFor(); await pane.evaluate(node => { node.scrollTop = 0; }); await settle(page);
    const own = page.locator('[data-message-id="qa-history-1"]');
    const geometry = () => own.evaluate(node => {
      const content = node.querySelector('.message-content'), rect = content.getBoundingClientRect(), row = node.getBoundingClientRect();
      return { x: rect.x, right: rect.right, top: rect.top, width: rect.width, height: rect.height, rowRight: row.right };
    });
    const before = await geometry();
    assert.ok(Math.abs(before.right - before.rowRight) < 1, 'normal outgoing bubble has no selection rail');
    await own.click({ button: 'right' }); await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    await settle(page); const selected = await geometry();
    assert.ok(Math.abs(before.x - selected.x - 36) < 1, 'selection opens exactly 36px');
    assert.deepEqual([selected.top, selected.width, selected.height], [before.top, before.width, before.height], 'no text rewrap or vertical shift');
    const mark = own.locator('..').locator('.message-select');
    const circle = await mark.boundingBox();
    assert.ok(circle.x > selected.right && circle.width === circle.height, 'circle remains on the right');
    // Inspect the real reverse CSS transition halfway through its timeline.
    const middle = await own.evaluate(node => {
      node.parentElement.querySelector('.message-select').click();
      return new Promise(resolve => requestAnimationFrame(() => {
        const content = node.querySelector('.message-content');
        const animation = content.getAnimations().find(item => item.transitionProperty === 'translate');
        if (!animation) return resolve(null);
        animation.pause(); animation.currentTime = 110;
        const x = content.getBoundingClientRect().x; animation.finish(); resolve(x);
      }));
    });
    assert.ok(middle > selected.x && middle < before.x, `rail closes progressively: ${middle}`);
    await settle(page); assert.deepEqual(await geometry(), before, 'normal spacing is restored');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await own.click({ button: 'right' }); await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    assert.equal(await own.locator('.message-content').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    await pane.focus(); await page.keyboard.press('Escape');
    assert.deepEqual(await geometry(), before, 'reduced motion restores spacing immediately');
    await page.close(); console.log(`Selection rail ${theme} ${width}px: normal/selected/reverse midpoint/reduced motion passed`);
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=${theme}`);
    await page.locator('.floating-messenger-launcher').click();
    const panel = page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true });
    await panel.getByRole('button', { name: /^Финансы и закупки/ }).click();
    const editor = panel.getByRole('textbox', { name: 'Новое сообщение', exact: true });
    await editor.fill('Длинное сообщение для проверки плавного освобождения места справа без переноса текста. '.repeat(3));
    await editor.press('Enter');
    const own = panel.locator('.message.own').last(); await own.waitFor(); await settle(page);
    const content = own.locator('.message-content');
    const before = await content.boundingBox();
    const row = await own.boundingBox();
    assert.ok(Math.abs(before.x + before.width - row.x - row.width) < 1, 'mini normal rail is absent');
    await own.click({ button: 'right' }); await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    await settle(page); const after = await content.boundingBox();
    assert.ok(Math.abs(before.x - after.x - 36) < 1 && after.x >= row.x, 'mini selection uses existing clearance without clipping');
    assert.deepEqual([after.y, after.width, after.height], [before.y, before.width, before.height]);
    await panel.getByRole('button', { name: 'Отменить выделение', exact: true }).click(); await settle(page);
    assert.deepEqual(await content.boundingBox(), before, 'mini spacing returns after cancellation');
    await panel.screenshot({ path: `tmp/messenger-selection-rail-${theme}.png` });
    await page.close(); console.log(`Mini selection rail ${theme}: long bubble, no clipping/rewrap, restoration passed`);
  }
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
