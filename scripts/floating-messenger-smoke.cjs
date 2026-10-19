const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { detail: 'QA: no business requests' } }));
  const dir = 'tmp/floating-messenger-qa'; fs.mkdirSync(dir, { recursive: true });
  for (const theme of ['light', 'dark']) for (const width of [1440, 1024, 640, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=${theme}`);
    await page.evaluate(() => { document.documentElement.classList.add('web-platform'); localStorage.removeItem('ws:mini-messenger-position:aziza'); });
    const launcher = page.locator('.floating-messenger-launcher');
    await launcher.waitFor();
    assert.equal(await launcher.getAttribute('data-unread'), 'true');
    await launcher.click();
    const panel = page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true });
    await panel.waitFor();
    assert.equal(await launcher.locator('.floating-messenger-badge').textContent(), '4', 'opening list must not mark read');
    let box = await panel.boundingBox();
    assert.ok(box.x >= 15 && box.y >= 15 && box.x + box.width <= width - 15 && box.y + box.height <= 885, JSON.stringify(box));
    await panel.getByRole('button', { name: /^Финансы и закупки/ }).click();
    const editor = panel.getByRole('textbox', { name: 'Новое сообщение', exact: true });
    await editor.fill('Черновик мини-окна');
    assert.equal(await launcher.locator('.floating-messenger-badge').textContent(), '1');
    await panel.screenshot({ path: `${dir}/${theme}-${width}-chat.png` });
    const node = await editor.elementHandle();
    await panel.getByRole('button', { name: 'Свернуть мини-мессенджер' }).click();
    await page.getByRole('button', { name: 'Проекты', exact: true }).click();
    await launcher.click();
    assert.equal(await editor.textContent(), 'Черновик мини-окна');
    assert.equal(await node.evaluate(element => element.isConnected), true);
    // The button is the collapsed window, not a second control underneath it.
    assert.equal(await launcher.isVisible(), false);
    await panel.getByRole('button', { name: 'Свернуть мини-мессенджер' }).click();
    await launcher.waitFor({ state: 'visible' });
    // Drag uses pointer capture and must not open the window.
    const start = await launcher.boundingBox();
    await page.mouse.move(start.x + 24, start.y + 24); await page.mouse.down();
    await page.mouse.move(50, 100, { steps: 12 }); await page.mouse.up();
    assert.equal(await launcher.getAttribute('aria-expanded'), 'false');
    const moved = await launcher.boundingBox();
    assert.ok(Math.abs(moved.x - start.x) > 20);
    await launcher.click();
    await panel.waitFor();
    box = await panel.boundingBox();
    assert.ok(box.x >= 15 && box.y >= 15 && box.x + box.width <= width - 15, JSON.stringify(box));
    await panel.getByRole('button', { name: 'Вернуть кнопку в правый нижний угол' }).click();
    // A file stays attached through the mini → full transition, with the same editor node.
    await panel.locator('input[type=file]').setInputFiles({ name: 'qa-note.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic QA') });
    const review = page.getByRole('dialog', { name: 'Отправка вложений' });
    await review.waitFor();
    await review.getByRole('button', { name: 'Вернуться в чат' }).click();
    await panel.getByRole('button', { name: 'Открыть полный мессенджер' }).click();
    const full = page.getByRole('region', { name: 'Раздел мессенджера', exact: true });
    await full.waitFor();
    assert.equal(await launcher.isVisible(), false, 'launcher must not cover the full messenger');
    assert.equal(await full.evaluate(element => getComputedStyle(element.parentElement).filter), 'none');
    assert.equal(await node.evaluate(element => element.isConnected), true);
    assert.equal(await full.locator('.messenger-view').count(), 1);
    assert.equal(await full.getByRole('textbox', { name: 'Новое сообщение' }).textContent(), 'Черновик мини-окна');
    assert.ok((await full.textContent()).includes('qa-note.txt'));
    if (width === 1440) await full.screenshot({ path: `${dir}/${theme}-full.png` });
    if (theme === 'light' && width === 1440) {
      await full.getByRole('textbox', { name: 'Новое сообщение' }).press('Enter');
      await page.waitForFunction(() => JSON.parse(document.querySelector('[data-sent]').getAttribute('data-sent')).length === 1);
      const sent = JSON.parse(await page.locator('[data-sent]').getAttribute('data-sent'));
      assert.deepEqual(sent[0], { body: 'Черновик мини-окна', files: ['qa-note.txt'] });
      // The launcher returns only after leaving the full messenger section.
      await page.getByRole('button', { name: 'Проекты', exact: true }).click();
      await launcher.waitFor({ state: 'visible' });
      await launcher.click();
      await panel.waitFor();
      await editor.fill('Ошибка сети'); await editor.press('Enter');
      await panel.getByRole('alert').filter({ hasText: 'Тестовая ошибка отправки' }).waitFor();
      assert.equal(await editor.textContent(), 'Ошибка сети');
      await editor.fill('Отправка из мини-окна'); await editor.press('Enter');
      await page.waitForFunction(() => JSON.parse(document.querySelector('[data-sent]').getAttribute('data-sent')).length === 2);
      await panel.locator('[data-message-id="qa-original"]').click({ button: 'right' });
      await page.getByRole('button', { name: 'Переслать', exact: true }).click();
      const forwarding = page.getByRole('dialog', { name: 'Переслать сообщение', exact: true });
      await forwarding.waitFor();
      await forwarding.getByRole('button', { name: 'Отмена', exact: true }).click();
    }
    // Minimize full page by navigation: no offscreen hidden reader consumes unread.
    await page.getByRole('button', { name: 'Задачи', exact: true }).click();
    if (await launcher.getAttribute('aria-expanded') !== 'true') await launcher.click();
    await page.getByRole('button', { name: 'Прочитать все в тесте' }).click();
    assert.equal(await launcher.locator('.floating-messenger-badge').count(), 0);
    assert.equal(await launcher.getAttribute('data-unread'), null);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await launcher.locator('.floating-messenger-icon').evaluate(element => getComputedStyle(element).animationName), 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await panel.getByRole('button', { name: 'Свернуть мини-мессенджер' }).click();
    await launcher.waitFor({ state: 'visible' });
    await launcher.focus(); await launcher.press('Alt+ArrowLeft');
    const saved = await launcher.boundingBox();
    await page.reload();
    await launcher.waitFor();
    const restored = await launcher.boundingBox();
    assert.ok(Math.abs(saved.x - restored.x) < 2, JSON.stringify({ saved, restored }));
  }
  assert.deepEqual(errors, []);
  await browser.close();
  console.log('Floating messenger: 8 theme/viewport cases passed; unread, drag, persisted position, shared editor/files, navigation, full page and reduced motion.');
})().catch(async error => {
  console.error(error);
  const page = browser?.contexts()[0]?.pages()[0];
  if (page) await page.screenshot({ path: 'tmp/floating-messenger-qa/failure.png' }).catch(() => undefined);
  await browser?.close(); process.exit(1);
});
