const assert = require('node:assert/strict');
module.exports = async (page, { setSupportMode }) => {
  const size = page.viewportSize();
  const root = page.locator('.support-dialog');
  const reopen = async mode => {
    await root.getByRole('button', { name: 'Закрыть поддержку', exact: true }).click();
    await root.waitFor({ state: 'hidden' });
    setSupportMode(mode);
    await page.setViewportSize({ width: 1440, height: 960 });
    const action = page.getByRole('menuitem', { name: /^(Обращения|Поддержка)$/ }).or(page.locator('.identity-popover-actions').getByRole('button', { name: /^(Обращения|Поддержка)$/ }));
    if (!await action.isVisible()) await page.locator('.workspace-identity-menu').click();
    await action.click();
    await root.waitFor(); await root.locator(mode === 'support' ? '.support-workspace.is-personal' : '.support-workspace.is-inbox').waitFor();
    await page.setViewportSize(size);
  };
  await reopen('support');
  const subject = root.getByPlaceholder('Коротко о главном');
  const body = root.getByPlaceholder('Что произошло или что можно улучшить?');
  await subject.fill('Черновик нового обращения'); await body.fill('Подробное описание, которое не должно исчезнуть.');
  if (size.width <= 700) {
    await root.getByRole('button', { name: 'Моя история', exact: true }).click();
    assert(!await root.locator('.support-composer').isVisible(), 'support: history is a separate phone screen');
    await root.getByRole('button', { name: 'Новое обращение', exact: true }).click();
    assert.equal(await subject.inputValue(), 'Черновик нового обращения', 'support: composer draft survives phone navigation');
  }
  await root.getByRole('button', { name: 'Отправить обращение', exact: true }).click();
  await root.getByRole('alert').waitFor();
  assert.equal(await body.inputValue(), 'Подробное описание, которое не должно исчезнуть.', 'support: failed create preserves input');
  await reopen('inbox');
  await page.waitForFunction(() => document.querySelectorAll('.support-request-card').length === 15);
};
