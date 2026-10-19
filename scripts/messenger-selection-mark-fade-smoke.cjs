// Synthetic fixtures only: inspect real browser transitions, never live data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
let browser;
const settle = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
async function midpoint(button) {
  return button.evaluate(button => {
    button.click();
    return new Promise(resolve => requestAnimationFrame(() => {
      const pane = document.querySelector('.message-scroll');
      const content = [...pane.querySelectorAll('.message.own > .message-content')].at(-1);
      const mark = content.closest('.message-row').querySelector('.message-select');
      const row = content.closest('.message');
      getComputedStyle(row, '::before').opacity; // Resolve pseudo-element styles before inspecting its transition.
      const animations = [...new Set([...row.getAnimations({ subtree: true }), ...mark.getAnimations()])];
      for (const animation of animations) { animation.pause(); animation.currentTime = 110; }
      const css = getComputedStyle(mark);
      const result = { rowClass: row.className, washContent: getComputedStyle(row, '::before').content, opacity: Number(css.opacity), wash: Number(getComputedStyle(row, '::before').opacity), translate: parseFloat(getComputedStyle(content).translate),
        pointer: css.pointerEvents, hidden: mark.getAttribute('aria-hidden'), inert: mark.inert,
        transitions: animations.map(a => a.transitionProperty) };
      for (const animation of animations) animation.finish();
      resolve(result);
    }));
  });
}
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const mini of [false, true]) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 900 } });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=${mini ? 'floating-messenger' : 'messenger-forward'}&theme=${theme}`);
    if (mini) {
      await page.locator('.floating-messenger-launcher').click();
      await page.getByRole('button', { name: /^Финансы и закупки/ }).click();
      const editor = page.getByRole('textbox', { name: 'Новое сообщение', exact: true });
      await editor.fill('Сообщение для синхронной анимации отметок'); await editor.press('Enter');
    }
    const own = page.locator('.message.own').last(); await own.waitFor(); await settle(page);
    await own.click({ button: 'right' });
    const enter = await midpoint(page.getByRole('button', { name: 'Выделить', exact: true }));
    assert.ok(enter.transitions.includes('opacity') && enter.transitions.includes('translate'), JSON.stringify(enter));
    assert.ok(enter.opacity > 0 && enter.opacity < 1, 'mark fades in, not a sudden reveal');
    assert.ok(Math.abs(enter.opacity + enter.translate / 36) < .02, 'same timing and easing as opening rail');
    assert.ok(Math.abs(enter.wash - enter.opacity) < .02 && enter.wash > 0 && enter.wash < 1, `wash fades in synchronously with marks: ${JSON.stringify(enter)}`);
    await settle(page);
    const ownMark = own.locator('..').locator('.message-select');
    const other = page.locator('.message:not(.own)').first().locator('..').locator('.message-select');
    await other.check(); await settle(page);
    const individual = await midpoint(ownMark);
    assert.ok(individual.wash > 0 && individual.wash < 1 && individual.opacity === 1, 'individual deselection fades only its wash while selection mode stays open');
    await settle(page);
    await ownMark.check(); await settle(page);
    const leave = await midpoint(page.getByRole('button', { name: 'Отменить выделение', exact: true }));
    assert.ok(leave.opacity > 0 && leave.opacity < 1, 'mark remains painted while fading out');
    assert.ok(Math.abs(leave.opacity + leave.translate / 36) < .02, 'same timing and easing as closing rail');
    assert.ok(Math.abs(leave.wash - leave.opacity) < .02 && leave.wash > 0 && leave.wash < 1, 'wash fades out synchronously with marks');
    assert.equal(leave.hidden, 'true'); assert.equal(leave.inert, true); assert.equal(leave.pointer, 'none');
    assert.equal(await page.getByRole('checkbox').count(), 0, 'exiting controls are immediately inaccessible');
    await settle(page);
    assert.equal(await own.locator('..').locator('.message-select').evaluate(node => getComputedStyle(node).visibility), 'hidden');
    await own.click({ button: 'right' }); await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    await own.locator('..').locator('.message-select').uncheck(); await settle(page);
    assert.equal(await page.getByRole('checkbox').count(), 0, 'last deselection hides controls');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await own.click({ button: 'right' }); await page.getByRole('button', { name: 'Выделить', exact: true }).click();
    const mark = own.locator('..').locator('.message-select');
    assert.equal(await mark.evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    assert.equal(await own.evaluate(node => getComputedStyle(node, '::before').transitionDuration), '0s');
    await page.getByLabel('Переписка', { exact: true }).focus(); await page.keyboard.press('Escape');
    assert.equal(await mark.evaluate(node => getComputedStyle(node).visibility), 'hidden');
    await page.close(); console.log(`${mini ? 'Mini' : 'Full'} ${theme}: synchronized opacity/translate midpoints, immediate inert exit, last removal and reduced motion passed`);
  }
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
