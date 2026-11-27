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
  await bar.getByRole('button', { name: 'Закреплено: 2', exact: true }).click();
  await page.locator('.pinned-message-panel').waitFor();
  await bar.getByRole('button', { name: 'Закреплено: 2', exact: true }).click();
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
  await page.locator('[data-message-id="qa-pin-foreign"]').click({ button: 'right' });
  await page.locator('.message-context-menu').getByRole('button', { name: 'Снять закреп для всех', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[data-message-id="qa-pin-foreign"]')?.classList.contains('message-pinned'));
  await require('./ui-messenger-layer-checks.cjs')(page, options);
};
