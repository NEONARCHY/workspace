const assert = require('node:assert/strict');

module.exports = async (page, section, { width, theme, geometry }) => {
  assert(geometry.pageOverflow <= 1 && geometry.overflow <= 1, `${section}/${width}: horizontal overflow`);
  if (width <= 430) {
    assert(Math.abs(geometry.x - 12) <= 1, `${section}: left gutter ${geometry.x}`);
    assert(Math.abs(width - geometry.width - geometry.x - 12) <= 1, `${section}: right gutter`);
  }
  const root = page.locator({ access: '.module-access-management', departments: '.department-management', sidebar: '.sidebar-visibility-management' }[section]);
  if (section === 'sidebar') {
    const footer = await page.locator('.sidebar-visibility-management > footer').evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, height: node.parentElement.getBoundingClientRect().height, max: getComputedStyle(node.parentElement).maxHeight, parentMax: getComputedStyle(node.parentElement.parentElement).maxHeight, scrollMax: getComputedStyle(node.previousElementSibling).minHeight, display: getComputedStyle(node.parentElement).display }));
    assert(footer.bottom <= (await page.evaluate(() => innerHeight)) - 8, JSON.stringify(footer));
  }
  const badTargets = await root.locator('button, .fui-Input, .fui-Checkbox').evaluateAll(nodes => nodes.filter(node => {
    const r = node.getBoundingClientRect();
    return r.width && r.height && (r.height < 43.5 || node.tagName === 'BUTTON' && r.width < 43.5);
  }).map(node => ({ text: node.textContent, height: node.getBoundingClientRect().height })));
  assert.deepEqual(badTargets, [], `small targets ${section}/${width}`);
  const framed = await root.locator('.sidebar-visibility-list > .fui-Checkbox, .sidebar-visibility-explanation, .department-tree, .department-editor, .department-icon-options button, .assistant-regional-access, .access-matrix-row').evaluateAll(nodes => nodes.filter(node => parseFloat(getComputedStyle(node).borderTopWidth) > 0 || getComputedStyle(node).boxShadow.includes('inset')).map(node => node.className));
  assert.deepEqual(framed, [], `decorative frames ${section}/${width}`);
  await page.keyboard.press('Shift');
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), null);
  await page.keyboard.press('Meta');
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), null);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), 'true');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), 'true');
  await page.mouse.click(geometry.x + 20, geometry.y + 20);
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), null);
  if (width !== 1440 || theme !== 'dark') return;
  if (section === 'access') {
    await page.getByRole('textbox', { name: 'Поиск модулей' }).fill('Задачи');
    assert.equal(await page.getByRole('table').getByRole('row').count(), 2);
    await page.getByRole('textbox', { name: 'Поиск модулей' }).fill('');
    await page.route('**/directory/access-rules/role/employee/tasks', async route => {
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: 'Синтетический отказ в изменении прав' }) });
    });
    const checkbox = page.getByRole('checkbox', { name: 'Задачи: Просмотр', exact: true });
    await checkbox.click();
    await page.getByRole('checkbox', { name: 'Главная: Просмотр', exact: true }).isDisabled().then(value => assert(value));
    await page.getByRole('alert').filter({ hasText: 'Синтетический отказ' }).waitFor();
    assert(await checkbox.isChecked());
  } else if (section === 'departments') {
    assert.equal(await page.locator('.department-member-row').count(), 25);
    const query = page.getByRole('textbox', { name: 'Поиск сотрудников для отдела' });
    await query.fill('Малика Нурова 119');
    const distant = page.getByRole('checkbox', { name: 'Добавить Малика Нурова 119', exact: true });
    await distant.check();
    await query.fill('');
    assert.equal(await page.locator('.department-member-row').count(), 25);
    await query.fill('Малика Нурова 119');
    assert(await distant.isChecked());
    await page.route('**/directory/departments/qa-central', route => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'Синтетический отказ сохранения отдела' }) }));
    await page.getByRole('textbox', { name: 'Название отдела', exact: true }).fill('Несохранённое название');
    await page.getByRole('button', { name: 'Сохранить сведения', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Синтетический отказ' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Название отдела', exact: true }).inputValue(), 'Несохранённое название');
  } else {
    const checkbox = page.getByRole('checkbox', { name: 'Задачи', exact: true });
    await checkbox.uncheck();
    await page.getByRole('textbox', { name: 'Найти раздел меню' }).fill('Лента');
    assert.equal(await checkbox.count(), 0);
    await page.getByRole('textbox', { name: 'Найти раздел меню' }).fill('');
    assert(!(await checkbox.isChecked()));
    let attempts = 0;
    await page.route('**/directory/employees/qa-staff-0/sidebar', async route => {
      if (route.request().method() === 'GET') return route.fallback();
      const body = route.request().postDataJSON();
      assert.equal(body.revision, 4);
      attempts++;
      await route.fulfill({ status: attempts === 1 ? 409 : 200, contentType: 'application/json', body: JSON.stringify(attempts === 1 ? { detail: 'Синтетический конфликт меню' } : { userId: 'qa-staff-0', hiddenKeys: body.hiddenKeys, revision: 5 }) });
    });
    await page.getByRole('button', { name: 'Сохранить меню', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Синтетический конфликт' }).waitFor();
    assert(!(await checkbox.isChecked()));
    await page.getByRole('button', { name: 'Сохранить меню', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Меню сохранено' }).waitFor();
    assert.equal(attempts, 2);
    assert(await page.getByRole('button', { name: 'Сохранить меню', exact: true }).isDisabled());
  }
};
