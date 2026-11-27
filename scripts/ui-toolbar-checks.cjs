// Exercise real controls on synthetic data, including portals and narrow scroll areas.
const assert = require('node:assert/strict');
module.exports = async (page, section, { width, geometry }) => {
  assert(geometry.pageOverflow <= 1, `${section.id}: page overflow`);
  const root = page.locator(section.root);
  if (section.id === 'referent') {
    const bar = root.locator('.ai-referent-register-bar'), tools = bar.locator('.ai-referent-register-tools');
    const choose = async (key, label) => {
      if (width <= 1120) await bar.getByLabel('Раздел AI Referent', { exact: true }).selectOption(key);
      else await bar.getByRole('tab', { name: label, exact: true }).click();
    };
    assert.equal(await tools.getByRole('button', { name: 'Excel-журнал', exact: true }).count(), 1);
    assert.equal(await tools.getByRole('button', { name: 'Обновить', exact: true }).count(), 1);
    const rows = await bar.evaluate(node => {
      const nav = node.querySelector('.ai-referent-register-tabs').getBoundingClientRect();
      const select = node.querySelector('.ai-referent-register-select').getBoundingClientRect();
      const tools = node.querySelector('.ai-referent-register-tools').getBoundingClientRect();
      const visible = nav.height ? nav : select;
      return { navY: visible.y, toolsY: tools.y, navHeight: visible.height, toolsHeight: tools.height, gap: tools.x - visible.right };
    });
    assert(Math.abs(rows.navY - rows.toolsY) <= 1 && Math.abs(rows.navHeight - rows.toolsHeight) <= 1, `register groups aligned: ${JSON.stringify(rows)}`);
    assert(rows.gap >= 7, 'register actions separated from navigation');
    await tools.getByRole('button', { name: 'Обновить', exact: true }).click();
    await choose('outgoing', 'Исходящие'); await root.locator('.ai-referent-row').first().waitFor();
    assert.equal(await tools.getByRole('button').count(), 1, 'incoming actions removed on tab switch');
    assert.equal(await root.getByRole('group', { name: 'Фильтр писем', exact: true }).count(), 1);
    await choose('archive', 'Архив и журналы'); await root.locator('.ai-referent-archive-page').waitFor();
    assert.equal(await tools.getByRole('button', { name: 'Обновить', exact: true }).count(), 1);
    await choose('telegram', 'Мой Telegram'); await root.locator('.ai-referent-telegram-page').waitFor();
    assert.equal(await tools.getByRole('button').count(), 0, 'unmounted register releases its actions');
    await choose('incoming', 'Входящие'); await root.locator('.ai-incoming-table tbody tr').first().waitFor();
  } else {
    const toolbar = root.locator('.workspace-queue-toolbar'), controls = toolbar.locator('.workspace-queue-controls');
    const layout = await toolbar.evaluate(node => {
      const controls = node.querySelector('.workspace-queue-controls');
      const filters = controls.querySelector('.workspace-queue-filters');
      const mode = controls.firstElementChild, search = node.querySelector('.workspace-search');
      const rect = element => { const box = element.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right }; };
      return { controls: rect(controls), filters: rect(filters), mode: rect(mode), search: rect(search), width: node.clientWidth,
        natural: filters.scrollWidth + mode.getBoundingClientRect().width + 12 };
    });
    if (geometry.root.width > 480) assert(Math.abs(layout.mode.y + layout.mode.height / 2 - layout.filters.y - layout.filters.height / 2) <= 1, `${section.id}: mode and filters share a row ${JSON.stringify(layout)}`);
    if (layout.natural + 192 <= layout.width) assert(Math.abs(layout.search.y - layout.controls.y) <= 1, `${section.id}: search joins the row when space permits`);
    const filters = controls.locator('.workspace-queue-filters'), buttons = filters.getByRole('button');
    const first = buttons.first(), last = buttons.last();
    await last.scrollIntoViewIfNeeded(); await last.click(); assert.equal(await last.getAttribute('aria-pressed'), 'true');
    await first.scrollIntoViewIfNeeded(); await first.click(); assert.equal(await first.getAttribute('aria-pressed'), 'true');
    const search = toolbar.getByRole('textbox').or(toolbar.getByRole('searchbox'));
    await search.fill('несуществующий-qa-запрос');
    const records = '.record-row, tbody tr, .project-card, .process-record-row, .approval-board-card, .trip-board-card, .kanban-card';
    await page.waitForFunction(({ root, records }) => !document.querySelector(root).querySelector(records), { root: section.root, records });
    await search.fill(''); await search.blur();
    await page.waitForFunction(({ root, records }) => Boolean(document.querySelector(root).querySelector(records)), { root: section.root, records });
    if (section.id !== 'tasks' && section.id !== 'grants') {
      await controls.getByRole('button', { name: 'Список', exact: true }).click();
      await root.locator('tbody tr, .process-record-row, .trip-list-item').first().waitFor();
      await controls.getByRole('button', { name: 'Канбан', exact: true }).click();
    }
  }
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section.id}: interaction overflow`);
  await page.emulateMedia({ forcedColors: 'active' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section.id}: high-contrast overflow`);
  await page.emulateMedia({ forcedColors: 'none' });
};
