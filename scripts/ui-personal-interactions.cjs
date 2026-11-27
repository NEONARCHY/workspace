const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page, section, options) => {
  const { phase, width, theme, output } = options;
  const root = page.locator(section.root);
  const closeName = section.id === 'profile' ? 'Закрыть профиль' : section.id === 'settings' ? 'Закрыть' : 'Закрыть поддержку';
  const close = root.getByRole('button', { name: closeName, exact: true });
  const checkFocus = async () => {
    await close.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
    assert(await close.evaluate(node => node === document.activeElement), section.id + ': keyboard focus remains in dialog');
    assert.equal(await close.evaluate(node => getComputedStyle(node).outlineStyle), 'solid', section.id + ': visible keyboard focus');
  };
  await checkFocus();
  if (width === 320 || width === 1440) {
    if (section.id === 'profile') {
      const nav = root.getByRole('navigation', { name: 'Навигация по профилю' });
      for (const name of ['Награды', 'Достижения', 'Обзор']) {
        const button = nav.getByRole('button', { name, exact: true });
        await button.click(); assert.equal(await button.getAttribute('aria-pressed'), 'true');
      }
      await root.getByRole('button', { name: 'Как это работает', exact: true }).click();
      const guide = page.locator('.recognition-guide-dialog'); await guide.waitFor();
      await guide.getByRole('button', { name: 'Вернуться к профилю', exact: true }).click();
      await guide.waitFor({ state: 'hidden' });
      await page.waitForFunction(() => document.activeElement?.textContent.includes('Как это работает'));
    } else if (section.id === 'settings') {
      const selectSection = async (key, name) => {
        const compact = root.getByRole('combobox', { name: 'Раздел настроек', exact: true });
        if (await compact.isVisible()) { await compact.click(); await page.getByRole('option', { name, exact: true }).click(); }
        else await root.getByRole('navigation', { name: 'Разделы настроек' }).getByRole('button', { name, exact: true }).click();
      };
      await selectSection('security', 'Защита и пароль');
      const password = root.locator('#account-page-security').getByLabel(/^Новый пароль/);
      await password.fill('QA-only-unsaved-password');
      await selectSection('sessions', 'Устройства');
      await root.getByRole('button', { name: 'Выйти', exact: true }).click();
      const confirm = root.getByRole('group', { name: 'Подтверждение завершения сеанса' });
      await confirm.waitFor(); await confirm.getByRole('button', { name: 'Отмена', exact: true }).click();
      assert(!await confirm.count(), 'settings: session revocation can be cancelled');
      await selectSection('security', 'Защита и пароль');
      assert.equal(await password.inputValue(), 'QA-only-unsaved-password', 'settings: unsaved form survives navigation');
      await root.screenshot({ path: path.join(output, phase, `settings-security-${theme}-${width}.png`) });
      await selectSection('profile', 'Личные данные');
    } else {
      const rows = root.locator('.support-request-card');
      assert.equal(await rows.count(), 15, 'support: first batch mounts 15 of 45 requests');
      await root.locator('.support-request-stream').evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForFunction(() => document.querySelectorAll('.support-request-card').length >= 30);
      const search = root.getByRole('textbox', { name: 'Поиск обращений', exact: true });
      await search.fill('· 45'); await page.waitForFunction(() => document.querySelectorAll('.support-request-card').length === 1);
      assert.match(await rows.innerText(), /45/, 'support: search includes requests beyond mounted window');
      await search.fill(''); await page.waitForFunction(() => document.querySelectorAll('.support-request-card').length === 15);
      await rows.nth(0).click();
      const reply = root.getByRole('textbox', { name: 'Комментарий сотруднику', exact: true });
      await reply.fill('Черновик ответа первому сотруднику');
      if (width <= 700) {
        assert(!await root.locator('.support-request-list').isVisible(), 'support: phone detail has its own screen');
        await root.getByRole('button', { name: 'Все обращения', exact: true }).click();
      }
      await rows.nth(1).click();
      assert.equal(await reply.inputValue(), '', 'support: reply does not leak into a different request');
      await reply.fill('Черновик второго ответа');
      if (width <= 700) await root.getByRole('button', { name: 'Все обращения', exact: true }).click();
      await rows.nth(0).click();
      assert.equal(await reply.inputValue(), 'Черновик ответа первому сотруднику', 'support: draft restored for its request');
      await root.getByRole('button', { name: 'Отправить комментарий', exact: true }).click();
      await root.getByRole('alert').waitFor();
      assert.equal(await reply.inputValue(), 'Черновик ответа первому сотруднику', 'support: failed write preserves reply');
      await root.screenshot({ path: path.join(output, phase, `support-thread-${theme}-${width}.png`) });
      if (theme === 'dark') await require('./ui-personal-support-checks.cjs')(page, options);
    }
  }
  if (width === 320) {
    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    assert(await root.evaluate(node => node.scrollWidth - node.clientWidth <= 1), section.id + ': high-contrast geometry');
    await checkFocus();
    await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'reduce' });
  }
};
