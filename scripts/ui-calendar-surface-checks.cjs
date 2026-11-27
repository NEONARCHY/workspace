const assert = require('node:assert/strict');
module.exports = async (page, section, { width, geometry }) => {
  const root = page.locator(section.root).first();
  assert(geometry.pageOverflow <= 1, 'calendar fits the page');
  const surfaces = await root.locator('.calendar-day:not(.selected)').first().evaluate(node => {
    const s = getComputedStyle(node), board = getComputedStyle(node.closest('.calendar-board'));
    return { fill: s.backgroundColor, board: board.backgroundColor, radius: parseFloat(s.borderRadius), border: s.borderTopWidth };
  });
  assert.notEqual(surfaces.fill, surfaces.board, 'days have separate surfaces');
  assert.notEqual(surfaces.fill, 'rgba(0, 0, 0, 0)', 'day surface is visible');
  assert(surfaces.radius >= 8, 'day corners are rounded');
  assert.equal(surfaces.border, '0px', 'day uses a fill rather than a decorative frame');
  if (section.id === 'tasks') {
    const hero = await root.locator('.ws-section-header').boundingBox();
    const calendar = await root.locator('.task-calendar-embedded').boundingBox();
    assert(calendar.y - hero.y - hero.height >= 8, 'space below the task header');
  } else if (!await root.locator('.calendar-agenda-stream').isVisible()) {
    await root.locator('.calendar-day.selected').click();
  }
  const stream = page.locator('.calendar-agenda-stream:visible');
  const cards = stream.locator('.calendar-agenda-card');
  await page.waitForFunction(() => document.querySelector('.calendar-agenda-stream')?.querySelectorAll('.calendar-agenda-card').length === 10);
  assert.equal(await cards.count(), 10, 'first batch contains ten records');
  await stream.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await page.waitForFunction(() => document.querySelector('.calendar-agenda-stream')?.querySelectorAll('.calendar-agenda-card').length === 20);
  assert.equal(await cards.count(), 20, 'scroll reveals the next ten records');
  await page.keyboard.press('Tab'); await stream.focus();
  assert.equal(await stream.evaluate(node => getComputedStyle(node).outlineWidth), '2px', 'keyboard scroll rail remains visible');
  if (section.id === 'calendar' && width <= 720) {
    await page.getByRole('button', { name: 'Закрыть расписание', exact: true }).click();
    await page.getByRole('dialog', { name: 'Расписание выбранного дня' }).waitFor({ state: 'hidden' });
    await root.locator('.calendar-day.selected').click();
    await page.waitForFunction(() => document.querySelector('.calendar-agenda-stream')?.querySelectorAll('.calendar-agenda-card').length === 10);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  assert.equal(await root.locator('.calendar-day.selected').evaluate(node => getComputedStyle(node).outlineWidth), '2px', 'high contrast selection remains visible');
  await page.emulateMedia({ forcedColors: 'none' });
};
