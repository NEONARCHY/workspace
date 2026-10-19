const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser, page;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'Synthetic QA' } }));
  fs.mkdirSync('tmp/messenger-unread-entry', { recursive: true });
  for (const theme of process.env.QA_QUICK ? ['light'] : ['light', 'dark']) for (const width of process.env.QA_QUICK ? [1440] : [1440, 390, 320]) for (const mode of process.env.QA_MODE ? [process.env.QA_MODE] : ['mini', 'full']) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=${theme}&history=100&unread=20`);
    await page.evaluate(() => document.documentElement.classList.add('web-platform'));
    if (mode === 'mini') await page.locator('.floating-messenger-launcher').click();
    else await page.getByRole('button', { name: 'Мессенджер', exact: true }).click();
    const chat = page.getByRole('button', { name: /^Финансы и закупки/ });
    if (await chat.isVisible()) await chat.click();
    const pane = page.locator('.message-scroll');
    await page.locator('[data-message-row-id="qa-history-63"]').waitFor();
    await page.waitForFunction(() => {
      const pane = document.querySelector('.message-scroll');
      const row = document.querySelector('[data-message-row-id="qa-history-63"] .message-unread-divider');
      return pane && row && Math.abs(row.getBoundingClientRect().top - pane.getBoundingClientRect().top) < 2;
    });
    assert.equal(await page.getByRole('separator', { name: 'Непрочитанные сообщения', exact: true }).count(), 1);
    const initial = await pane.evaluate(node => node.scrollTop);
    await page.waitForTimeout(350);
    assert.ok(Math.abs(await pane.evaluate(node => node.scrollTop) - initial) < 2, 'mark-read must not jump to bottom');
    assert.equal(await page.locator('.message-unread-divider').count(), 1, 'read acknowledgement retains the boundary');
    const editor = page.getByRole('textbox', { name: 'Новое сообщение', exact: true });
    await editor.fill('Проверка satin border');
    const focus = await editor.evaluate(node => { const s = getComputedStyle(node); return { outline: s.outlineStyle, background: s.backgroundImage, border: s.borderTopWidth }; });
    assert.equal(focus.outline, 'none'); assert.equal(focus.border, '1px'); assert.ok(focus.background.includes('conic-gradient'), JSON.stringify(focus));
    if (mode === 'mini') {
      const input = await editor.boundingBox(); const send = await page.locator('.composer > .fui-Button:last-child').boundingBox();
      assert.ok(Math.abs(send.x - input.x - input.width - 6) <= 1, `6px input/send gap: ${JSON.stringify({ input, send })}`);
      await page.locator('.floating-messenger-panel').screenshot({ path: `tmp/messenger-unread-entry/${theme}-${width}.png` });
      await page.getByRole('button', { name: 'Открыть полный мессенджер', exact: true }).click();
      assert.equal(await editor.textContent(), 'Проверка satin border');
      // A mini/full handoff keeps the current history context, not a new entry.
      await page.waitForFunction(() => { const p = document.querySelector('.message-scroll'); const row = document.querySelector('[data-message-row-id="qa-history-63"] .message-unread-divider'); return p && row && Math.abs(row.getBoundingClientRect().top - p.getBoundingClientRect().top) < 2; });
    }
    await pane.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
    await editor.fill('Продолжение черновика');
    assert.equal(await pane.evaluate(node => node.scrollTop), 0, 'editing must preserve a history reader');
    // Closing/reopening the window keeps context; returning through the chat list
    // is a fresh entry, with no unread messages, and must open at latest.
    if (mode === 'mini') {
      await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      await page.locator('.floating-messenger-launcher').click();
    } else {
      await page.getByRole('button', { name: 'Задачи', exact: true }).click();
      await page.getByRole('button', { name: 'Мессенджер', exact: true }).click();
    }
    if (mode === 'mini') {
      await page.getByRole('button', { name: 'К списку чатов', exact: true }).click();
      await page.getByRole('button', { name: /^Финансы и закупки/ }).click();
      await page.waitForFunction(() => { const p = document.querySelector('.message-scroll'); return p && p.scrollHeight - p.clientHeight - p.scrollTop < 2; });
      assert.equal(await page.locator('.message-unread-divider').count(), 0, 'read conversation has no stale unread divider');
    } else assert.equal(await pane.evaluate(node => node.scrollTop), 0, 'page hide/reveal retains history context');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`PASS ${theme} ${width} ${mode}: first unread, read reset, composer, history, reopen`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=dark&history=100&unread=20');
  await page.locator('.floating-messenger-launcher').click();
  await page.getByRole('button', { name: 'Открыть полный мессенджер', exact: true }).click();
  await page.waitForFunction(() => { const p = document.querySelector('.message-scroll'); const row = document.querySelector('[data-message-row-id="qa-history-63"] .message-unread-divider'); return p && row && Math.abs(row.getBoundingClientRect().top - p.getBoundingClientRect().top) < 2; });
  await page.emulateMedia({ forcedColors: 'active' });
  const forcedEditor = page.getByRole('textbox', { name: 'Новое сообщение', exact: true });
  await forcedEditor.focus();
  assert.equal(await forcedEditor.evaluate(node => getComputedStyle(node).outlineWidth), '2px');
  assert.equal(await page.locator('.message-unread-divider').evaluate(node => getComputedStyle(node, '::before').borderTopStyle), 'solid');
  console.log('PASS expand from chat list preserves unread entry; forced-color editor focus');
  assert.deepEqual(errors, []);
  await browser.close();
})().catch(async error => {
  console.error(error);
  if (page) {
    console.error(await page.evaluate(() => { const p = document.querySelector('.message-scroll'); const row = document.querySelector('[data-message-row-id="qa-history-63"]'); return { url: location.href, pane: p && { top: p.scrollTop, height: p.clientHeight, total: p.scrollHeight, y: p.getBoundingClientRect().top }, rowY: row?.getBoundingClientRect().top }; }));
    await page.screenshot({ path: 'tmp/messenger-unread-entry/failure.png' });
  }
  await browser?.close(); process.exitCode = 1;
});
