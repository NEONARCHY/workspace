const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page, options) => {
  const { width, theme, output, phase } = options;
  const bar = page.locator('.pinned-message-bar');
  const rect = await bar.boundingBox();
  assert(rect.height <= 64 && rect.width <= width, 'compact pinned message bar');
  assert.match(await bar.innerText(), /Материалы региональной встречи/);
  await bar.screenshot({ path: path.join(output, phase, `pinned-bar-${theme}-${width}.png`) });
  await bar.locator('.pinned-message-preview').click();
  const revealed = page.locator('[data-message-id="qa-pin-old"]');
  assert(await revealed.isVisible(), 'pinned preview reveals source message');
  assert.match(await bar.innerText(), /План следующей недели/);
  await bar.screenshot({ path: path.join(output, phase, `pinned-bar-previous-${theme}-${width}.png`) });
  await bar.locator('.pinned-message-preview').click();
  assert.match(await bar.innerText(), /Материалы региональной встречи/);
  await bar.getByRole('button', { name: 'Закреплено: 2', exact: true }).click();
  const history = page.locator('.pinned-history-header');
  await history.waitFor();
  assert.equal(await page.locator('.message-scroll [data-message-id]').count(), 2, 'pin mode renders both pinned messages');
  assert.equal(await page.locator('.message-scroll [data-message-id="qa-pin-own"]').count(), 0, 'unpinned messages stay out of pinned view');
  assert(!await page.locator('.composer').isVisible(), 'pinned view has no composer');
  assert(await history.getByRole('button', { name: 'Вернуться к переписке' }).evaluate(node => node === document.activeElement), 'focus enters pinned view');
  await page.screenshot({ path: path.join(output, phase, `pinned-history-${theme}-${width}.png`) });
  await history.getByRole('button', { name: 'Вернуться к переписке' }).click();
  assert(await bar.locator('.pinned-message-trigger').evaluate(node => node === document.activeElement), 'back restores focus to pin button');
  for (const id of ['qa-pin-own', 'qa-pin-foreign']) {
    const message = page.locator(`[data-message-id="${id}"]`);
    await message.click({ button: 'right' });
    const menu = page.locator('.message-context-menu');
    await menu.getByRole('button', { name: 'Закрепить', exact: true }).click();
    await page.waitForFunction(id => document.querySelector(`[data-message-id="${id}"]`)?.classList.contains('message-pinned'), id);
    if (id.endsWith('foreign')) {
      await message.click({ button: 'right' });
      assert.equal(await menu.getByRole('button', { name: /^Удалить/ }).count(), 0, 'pin does not grant deleting foreign messages');
      assert.equal(await menu.getByRole('button', { name: /^Редактировать/ }).count(), 0, 'pin does not grant editing foreign messages');
      await page.keyboard.press('Escape');
    }
  }
  assert.match(await bar.innerText(), /Сообщение коллеги для закрепления/);
  await bar.getByRole('button', { name: 'Закреплено: 4', exact: true }).click();
  assert.equal(await page.locator('.message-scroll [data-message-id]').count(), 4, 'adding pins does not replace earlier pins');
  await page.locator('[data-message-id="qa-pin-foreign"]').click({ button: 'right' });
  const menu = page.locator('.message-context-menu');
  assert(await menu.getByRole('button', { name: 'Копировать', exact: true }).isVisible(), 'pinned view keeps context menu');
  assert(await menu.getByRole('button', { name: 'Переслать', exact: true }).isVisible(), 'pinned view keeps forwarding');
  assert.equal(await menu.getByRole('button', { name: /^Удалить/ }).count(), 0, 'pin view does not grant deletion');
  await page.screenshot({ path: path.join(output, phase, `pinned-menu-${theme}-${width}.png`) });
  await page.locator('.message-context-menu').getByRole('button', { name: 'Снять закреп для всех', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-message-id="qa-pin-foreign"]'));
  assert.equal(await page.locator('.message-scroll [data-message-id]').count(), 3, 'unpin removes just one item from pinned view');
  await page.screenshot({ path: path.join(output, phase, `pinned-history-three-${theme}-${width}.png`) });
  await history.getByRole('button', { name: 'Вернуться к переписке' }).click();
  assert(await page.locator('[data-message-id="qa-pin-foreign"]').isVisible(), 'unpin keeps original message in ordinary chat');
  await require('./ui-messenger-layer-checks.cjs')(page, options);
};
