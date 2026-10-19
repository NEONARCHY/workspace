// Synthetic fixture only: no account, network sends or message mutations.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const width of [1440, 640, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    await page.goto(`${process.env.QA_BASE_URL || 'http://127.0.0.1:5178'}/qa/detail-layout.html?view=messenger-forward&theme=dark&history=30`);
    const pane = page.getByLabel('Переписка', { exact: true });
    await pane.waitFor();
    await pane.evaluate(node => { node.scrollTop = 0; });
    const first = page.locator('[data-message-id="qa-history-0"]');
    await first.waitFor();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
    const geometry = () => pane.evaluate(node => ({ top: node.getBoundingClientRect().top, height: node.clientHeight, scroll: node.scrollTop,
      first: node.querySelector('[data-message-id="qa-history-0"]').getBoundingClientRect().top }));
    const before = await geometry();
    await first.click({ button: 'right' });
    await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    assert.deepEqual(await geometry(), before, 'selection toolbar must not shift history');
    const toolbar = page.getByRole('region', { name: 'Выделенные сообщения' });
    const toolbarBounds = await toolbar.boundingBox();
    assert.ok(toolbarBounds.x >= 0 && toolbarBounds.x + toolbarBounds.width <= width + 1);
    for (const button of await toolbar.getByRole('button').all()) {
      const rect = await button.boundingBox();
      assert.ok(rect.x >= toolbarBounds.x && rect.x + rect.width <= toolbarBounds.x + toolbarBounds.width + 1, 'toolbar controls fit');
    }
    await page.getByRole('button', { name: 'Отменить выделение', exact: true }).click();
    const bounds = await pane.boundingBox();
    const centers = await pane.evaluate(node => [...node.querySelectorAll('.message[data-message-id]')].slice(0, 4).map(row => {
      const rect = row.getBoundingClientRect(); return (rect.top + rect.bottom) / 2;
    }));
    const x = bounds.x + 8; // Empty space, deliberately outside every bubble.
    await page.mouse.move(x, centers[0]); await page.mouse.down();
    await page.mouse.move(x, centers[2], { steps: 10 });
    await page.waitForFunction(() => document.querySelector('.message-selection-toolbar')?.textContent.includes('Выбрано: 3'));
    await page.mouse.move(x, centers[0], { steps: 10 });
    await page.waitForFunction(() => document.querySelector('.message-selection-toolbar')?.textContent.includes('Выбрано: 1'));
    await page.mouse.up();
    assert.deepEqual(await geometry(), before, 'painting must retain history coordinates');
    // A fresh pass through the already selected third row removes it.
    await page.mouse.move(x, centers[2]); await page.mouse.down();
    await page.mouse.move(x + 7, centers[2]); await page.mouse.up();
    await toolbar.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('checkbox').count(), 0, 'last painted deselection exits the mode');
    await first.click({ button: 'right' });
    await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    const mark = page.getByRole('checkbox').first();
    await mark.uncheck();
    await toolbar.waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('checkbox').count(), 0, 'last checkbox deselection exits the mode');
    await first.click({ button: 'right' });
    await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    const secondMark = page.getByRole('checkbox').nth(1);
    await secondMark.check(); assert.equal(await secondMark.isChecked(), true, 'checkbox click toggles only once');
    await pane.focus(); await page.keyboard.press('Escape');
    assert.equal(await toolbar.isVisible(), false);
    // A click in blank space does not start selection.
    await page.mouse.click(x, centers[0]); assert.equal(await toolbar.isVisible(), false);
    // Touch gestures are left to native scrolling.
    await pane.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 9, isPrimary: true, button: 0, buttons: 1, clientX: x, clientY: centers[0] });
    await pane.dispatchEvent('pointermove', { pointerType: 'touch', pointerId: 9, isPrimary: true, buttons: 1, clientX: x, clientY: centers[2] });
    assert.equal(await toolbar.isVisible(), false);
    await page.mouse.move(x, centers[0]); await page.mouse.down();
    await page.mouse.move(x, bounds.y + bounds.height - 5, { steps: 5 });
    await page.waitForFunction(() => document.querySelector('.message-scroll').scrollTop > 0);
    await page.mouse.up();
    assert.equal(await pane.getAttribute('data-paint-selecting'), null, 'pointer release stops edge autoscroll');
    const stopped = await pane.evaluate(node => node.scrollTop);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await pane.evaluate(node => node.scrollTop), stopped);
    await page.getByRole('button', { name: 'Отменить выделение', exact: true }).click();
    await page.close();
    console.log(`Paint selection ${width}px: stable layout, blank-space sweep, reversal, repeated pass, checkbox, Escape, touch passed`);
  }
  for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
    await page.goto(`${process.env.QA_BASE_URL || 'http://127.0.0.1:5178'}/qa/detail-layout.html?view=floating-messenger&theme=${theme}`);
    await page.locator('.floating-messenger-launcher').click();
    const panel = page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true });
    await panel.getByRole('button', { name: /^Финансы и закупки/ }).click();
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
    const pane = panel.getByLabel('Переписка', { exact: true });
    const before = await pane.boundingBox();
    await panel.locator('.message[data-message-id]').first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    assert.deepEqual(await pane.boundingBox(), before, 'mini selection must not shift history');
    const region = panel.getByRole('region', { name: 'Выделенные сообщения' });
    const box = await region.boundingBox();
    for (const button of await region.getByRole('button').all()) {
      const rect = await button.boundingBox();
      assert.ok(rect.x >= box.x && rect.x + rect.width <= box.x + box.width + 1, 'mini controls fit');
    }
    const selected = panel.getByRole('checkbox', { checked: true });
    if (theme === 'light') await selected.press('Space'); else await selected.uncheck();
    await region.waitFor({ state: 'hidden' });
    assert.equal(await panel.getByRole('checkbox').count(), 0, 'last mini selection clears its controls');
    assert.deepEqual(await pane.boundingBox(), before, 'leaving mini selection retains geometry');
    await panel.locator('.message[data-message-id]').first().click({ button: 'right' });
    await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    await pane.focus(); await page.keyboard.press('Escape');
    assert.equal(await region.isVisible(), false);
    await page.close();
    console.log(`Mini selection ${theme}: stable viewport, toolbar fit and Escape passed`);
  }
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
