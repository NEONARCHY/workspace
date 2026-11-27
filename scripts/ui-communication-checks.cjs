// Production App interactions on synthetic API data; actual writes stay blocked.
const assert = require('node:assert/strict');
module.exports = async function checkCommunication(page, section, { width, geometry }) {
  const root = page.locator(section.root);
  assert(geometry.pageOverflow <= 1, `${section.id}: page overflow`);
  if (geometry.hero) {
    assert(Math.abs(geometry.hero.x - geometry.root.x) <= 1 && Math.abs(geometry.hero.right - geometry.root.right) <= 1,
      `${section.id}: shared header edges ${JSON.stringify(geometry)}`);
  }
  const frames = await root.evaluate(element => [...element.querySelectorAll('.ws-section-header, .ai-referent-summary > button, .ai-incoming-table-wrap, .project-overview, .project-column, .list-pane, .conversation-pane')].filter(node => {
    const style = getComputedStyle(node);
    return parseFloat(style.borderTopWidth) > 0 || style.boxShadow.includes('inset') || style.backgroundImage.includes('conic-gradient');
  }).map(node => node.className));
  assert.deepEqual(frames, [], `${section.id}: no decorative panel frames`);
  if (section.id === 'referent') {
    assert.equal(await root.locator('.ai-referent-register-tabs').isVisible(), width > 1120);
    assert.equal(await root.getByLabel('Раздел AI Referent', { exact: true }).isVisible(), width <= 1120);
    const select = async value => {
      if (width <= 1120) await root.getByLabel('Раздел AI Referent', { exact: true }).selectOption(value);
      else await root.getByRole('tab', { name: value === 'outgoing' ? 'Исходящие' : 'Входящие', exact: true }).click();
    };
    const rows = root.locator('.ai-incoming-table tbody tr');
    const query = root.getByRole('textbox', { name: 'Поиск входящих писем', exact: true });
    await query.fill('несуществующий-qa-запрос'); await root.getByRole('heading', { name: 'По этому запросу писем нет' }).waitFor();
    await query.fill(''); await rows.first().waitFor(); assert.equal(await rows.count(), 100);
    const paging = root.getByRole('group', { name: 'Страницы входящих писем' });
    await paging.getByRole('button', { name: 'Далее', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.ai-incoming-table tbody tr').length === 20);
    await paging.getByRole('button', { name: 'Назад', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.ai-incoming-table tbody tr').length === 100);
    await select('outgoing'); await root.locator('.ai-referent-row').first().waitFor();
    await select('incoming'); await rows.first().waitFor();
  } else if (section.id === 'messenger') {
    const list = root.locator('.chat-list'), search = root.getByRole('textbox', { name: 'Поиск чатов и сообщений', exact: true });
    const count = await list.locator('.chat-row').count();
    await search.fill('несуществующий-qa-запрос'); await root.getByText('Чаты не найдены', { exact: true }).waitFor();
    await search.fill(''); assert.equal(await list.locator('.chat-row').count(), count);
    await list.getByRole('button', { name: /^Финансы и закупки/ }).click();
    const composer = root.getByRole('textbox', { name: 'Новое сообщение', exact: true });
    const draft = 'Черновик для проверки сохранения контекста'; await composer.fill(draft);
    const back = root.locator('.compact-back'); if (await back.isVisible()) await back.click();
    await list.getByRole('button', { name: /^Азиза Каримова/ }).click();
    if (await back.isVisible()) await back.click();
    await list.getByRole('button', { name: /^Финансы и закупки/ }).click(); assert.equal(await composer.innerText(), draft);
    await composer.fill(''); if (await back.isVisible()) await back.click();
    await root.locator('.chat-buckets').getByRole('button', { name: 'Чаты задач', exact: true }).click();
    await root.locator('.chat-buckets').getByRole('button', { name: /^Чаты \d/ }).click();
  } else {
    const overlappingMetrics = await root.locator('.project-overview').evaluate(element => {
      const labels = [...element.querySelectorAll('span')].map(node => node.getBoundingClientRect());
      return labels.some((a, i) => labels.slice(i + 1).some(b => Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1));
    });
    assert.equal(overlappingMetrics, false, 'project summary labels do not overlap');
    const firstCard = root.locator('.project-card .spatial-card-open').first();
    await firstCard.scrollIntoViewIfNeeded();
    assert(await firstCard.evaluate(node => {
      const bounds = node.getBoundingClientRect(), clip = node.closest('.project-stack').getBoundingClientRect();
      return Math.min(bounds.bottom, clip.bottom, innerHeight) - Math.max(bounds.top, clip.top, 0) > 40;
    }), 'project card remains reachable in a short viewport');
    await root.evaluate(node => { node.scrollTop = 0; });
    const query = root.getByRole('textbox', { name: 'Поиск проектов', exact: true });
    await query.fill('REG-41'); assert.equal(await root.locator('.project-card').count(), 1);
    await root.getByRole('button', { name: 'Список', exact: true }).click(); assert.equal(await root.locator('.process-record-row').count(), 1);
    await query.fill(''); await root.getByRole('group', { name: 'Фильтр проектов' }).getByRole('button', { name: /^Все/ }).click(); assert.equal(await root.locator('.process-record-row').count(), 18);
    await root.getByRole('button', { name: 'Канбан', exact: true }).click(); assert.equal(await root.locator('.project-card').count(), 18);
    await root.getByRole('button', { name: 'Новый проект', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.getByRole('textbox', { name: 'Код проекта', exact: true }).fill('QA-DRAFT');
    await dialog.getByRole('textbox', { name: 'Название проекта', exact: true }).fill('Черновик без отправки');
    await dialog.getByRole('button', { name: 'Сохранить', exact: true }).click(); await dialog.getByRole('alert').waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: 'Название проекта', exact: true }).inputValue(), 'Черновик без отправки');
    await dialog.getByRole('button', { name: 'Отмена', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section.id}: forced colours overflow`);
  await page.emulateMedia({ forcedColors: 'none' });
};
