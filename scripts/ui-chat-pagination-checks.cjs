const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (page, { output, width, theme }) => {
  const root = page.locator('.messenger-view'), list = root.locator('.chat-list');
  const rows = list.locator('.chat-list-item'), search = root.getByRole('textbox', { name: 'Поиск чатов и сообщений', exact: true });
  const back = root.locator('.compact-back');
  const navigate = async label => {
    const target = page.getByRole('button', { name: label, exact: true }).or(page.getByRole('menuitem', { name: label, exact: true }));
    if (!await target.isVisible()) {
      const menu = page.getByRole('button', { name: 'Открыть меню', exact: true }); if (await menu.count()) await menu.click();
      if (!await target.isVisible()) await page.getByRole('button', { name: /^Ещё,/ }).click();
    }
    await target.focus(); await target.press('Enter');
  };
  const count = async expected => {
    await page.waitForFunction(expected => document.querySelectorAll('.messenger-view .chat-list-item').length === expected, expected);
    assert.equal(await rows.count(), expected);
  };
  const scrollBatch = async expected => {
    await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await count(expected);
  };
  await count(15);
  await list.locator('.chat-row').first().click();
  const composer = root.getByRole('textbox', { name: 'Новое сообщение', exact: true });
  const draft = 'Черновик сохранён после освобождения списка'; await composer.fill(draft);
  if (await back.isVisible()) await back.click();
  await scrollBatch(30);
  await page.screenshot({ path: path.join(output, 'after', `messenger-loaded-30-${theme}-${width}.png`) });
  await scrollBatch(45);
  await search.fill('Переписка group 099'); await count(1);
  assert.equal(await rows.first().getAttribute('data-chat-id'), 'qa-paged-group-99');
  await search.fill(''); await count(15);
  await root.getByRole('button', { name: 'Чаты задач', exact: true }).click(); await count(15); await scrollBatch(30);
  for (const folder of ['Чаты проектов', 'Чаты поездок']) {
    await root.getByRole('button', { name: /^Ещё/ }).click();
    await page.getByRole('menuitem', { name: new RegExp(folder) }).click();
    await count(15); await scrollBatch(30);
  }
  await navigate('Главная'); await count(0);
  await navigate('Мессенджер'); await count(15);
  if (await back.isVisible()) await back.click();
  await list.locator('.chat-row').first().click(); assert.equal(await composer.innerText(), draft);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow');
  await page.screenshot({ path: path.join(output, 'after', `messenger-returned-15-${theme}-${width}.png`) });
};
