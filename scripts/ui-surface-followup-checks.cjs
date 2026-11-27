const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page, section, { output, phase, width, theme, geometry }) => {
  const root = page.locator(section.root).first();
  if (section.id === 'calendar') {
    const toggle = root.getByRole('button', { name: /^Фильтры/ });
    await toggle.click();
    await root.locator('.calendar-filter-fields').waitFor();
    await page.locator('#workspace-content').focus();
    await root.locator('.calendar-filters').screenshot({ path: path.join(output, phase, `filters-expanded-${theme}-${width}.png`) });
    if (phase === 'after') {
      const surfaces = await root.locator('.calendar-filters, .calendar-filter-fields .fui-Combobox, .calendar-filter-fields .workspace-search-field, .calendar-filter-fields .ws-date-time-trigger').evaluateAll(nodes => nodes.map(node => ({ fill: getComputedStyle(node).backgroundColor, border: getComputedStyle(node).borderTopWidth })));
      assert.equal(surfaces.length, 5, 'all four filter controls are checked');
      assert.equal(surfaces[0].fill, 'rgba(0, 0, 0, 0)', 'no shared filter backing');
      surfaces.slice(1).forEach(surface => { assert.notEqual(surface.fill, 'rgba(0, 0, 0, 0)', 'each control has its own fill'); assert.equal(surface.border, '0px', 'control has no decorative frame'); });
      const button = await toggle.boundingBox();
      const frame = await root.locator('.calendar-filters').boundingBox();
      const create = await root.getByRole('button', { name: 'Новое событие', exact: true }).boundingBox();
      assert(button.x >= frame.x && create.x + create.width <= frame.x + frame.width + 1, 'filter actions fit the calendar frame');
      assert(Math.abs(button.height - create.height) <= 1, 'filter actions share a height');
      if (width >= 1024) assert(button.width < 220, 'filter toggle is compact');
      const field = root.getByRole('textbox', { name: 'Поиск событий' });
      if (width >= 1024) assert((await field.boundingBox()).width > 150, 'event search has enough room');
      await field.fill('нет-такого-события');
      assert.equal(await root.locator('.calendar-event-pill').count(), 0, 'search remains effective');
      await root.locator('.calendar-filters').getByRole('button', { name: 'Сбросить фильтры' }).click();
      assert(await root.locator('.calendar-event-pill').count() > 0, 'reset restores events');
    }
    await toggle.click();
  }
  if (phase !== 'after') return;
  assert(geometry.pageOverflow <= 1, section.id + ' fits viewport');
  if (section.id === 'overview') {
    const flow = root.getByRole('group', { name: 'Задачи по статусам' }).locator('button');
    assert.equal(await flow.count(), 4);
    for (const button of await flow.all()) {
      assert.equal(await button.evaluate(node => getComputedStyle(node).borderTopWidth), '0px', 'status tile has no frame');
      await button.hover();
      assert.equal(await button.evaluate(node => getComputedStyle(node).borderTopWidth), '0px', 'hover adds no frame');
    }
    const gradients = await root.locator('.team-dash-metric').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).backgroundImage));
    assert(gradients.length >= 4 && gradients.every(fill => fill.includes('linear-gradient')), 'action cards retain gradients');
    assert(new Set(gradients).size >= 3, 'semantic card colours differ');
    await page.keyboard.press('Tab'); await flow.first().focus();
    assert.equal(await flow.first().evaluate(node => getComputedStyle(node).outlineWidth), '2px', 'status keyboard focus remains visible');
    await root.locator('.team-dash-metric').first().focus();
    assert.equal(await root.locator('.team-dash-metric').first().evaluate(node => getComputedStyle(node).outlineWidth), '2px', 'metric keyboard focus remains visible');
    await page.emulateMedia({ forcedColors: 'active' });
    assert.equal(await root.locator('.team-dash-metric').first().evaluate(node => getComputedStyle(node).backgroundImage), 'none', 'high contrast replaces semantic gradients');
    await page.emulateMedia({ forcedColors: 'none' });
  }
  if (section.id === 'grants' && width === 1440) {
    const filters = await root.locator('.grants-filters').boundingBox();
    const count = await root.locator('.grants-count').boundingBox();
    assert(count.x >= filters.x + filters.width + 8, 'count sits to the right of grant filters');
    assert(Math.abs(count.y + count.height / 2 - filters.y - filters.height / 2) <= 1, 'count aligns with navigation');
  }
};
