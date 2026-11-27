// Production shell on synthetic data. Workday POSTs are intercepted by the fixture.
const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page, section, { width, theme, geometry, output }) => {
  assert(geometry.pageOverflow <= 1, `${section.id}: page overflow`);
  const bar = page.locator('.global-bar'), search = bar.getByRole('textbox', { name: 'Перейти в раздел', exact: true });
  assert.equal(await search.isVisible(), width > 700);
  if (width > 700) {
    const bounds = await bar.locator('.section-jump-trigger').boundingBox();
    assert(bounds.width >= 180 && bounds.height === 44, 'readable command field');
    await search.fill('зада');
    await page.getByRole('dialog', { name: 'Перейти в раздел', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Найти раздел', exact: true }).inputValue(), 'зада');
    await page.getByRole('button', { name: 'Закрыть переход по разделам' }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Перейти в раздел');
  }
  for (const selector of ['.workspace-identity-menu .fui-Avatar', '.assistant-launcher > .gradient-orb, .assistant-launcher > .gradient-orb-fallback']) {
    const bounds = await bar.locator(selector).boundingBox(); assert.equal(bounds.width, 40); assert.equal(bounds.height, 40);
  }
  const icon = await bar.locator('.context-trigger > svg:first-child').first().boundingBox(); assert.equal(icon.width, 24); assert.equal(icon.height, 24);
  const header = page.locator(section.root + ' .ws-section-header');
  if (theme === 'light' && section.id === 'overview') {
    const colours = await header.locator('.team-dash-hero-summary :is(strong, span, svg)').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
    assert(colours.length > 0 && colours.every(colour => colour === 'rgb(255, 255, 255)'), 'white team summary');
  }
  const actions = header.locator('.fui-Button:not(:disabled)');
  for (const action of await actions.all()) {
    await page.mouse.move(width - 1, 0); await page.waitForTimeout(200);
    const normal = await action.evaluate(node => { const css = getComputedStyle(node); return { fill: css.backgroundColor, border: css.borderTopWidth, shadow: css.boxShadow, colour: css.color }; });
    assert.equal(normal.border, '0px'); assert.equal(normal.shadow, 'none'); assert.equal(normal.colour, 'rgb(255, 255, 255)');
    await action.hover(); await page.waitForTimeout(200);
    const hover = await action.evaluate(node => getComputedStyle(node).backgroundColor);
    assert.notEqual(normal.fill, hover, 'distinct hover fill');
    if (theme === 'light') { assert.equal(normal.fill, 'rgb(18, 63, 84)'); assert.equal(hover, 'rgb(24, 83, 103)'); }
    await page.mouse.move(width - 1, 0);
  }
  const trigger = bar.locator('.workday-control-mobile-trigger'); await trigger.scrollIntoViewIfNeeded(); await trigger.click();
  const menu = page.getByRole('dialog', { name: 'Рабочий день', exact: true });
  await menu.getByRole('button', { name: /^Начать (работу|снова)$/ }).click();
  await menu.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.workday-control-mobile-trigger')?.dataset.action === 'finish');
  await trigger.click();
  await menu.getByRole('button', { name: 'Завершить работу', exact: true }).waitFor();
  if (section.id === 'overview') await menu.screenshot({ path: path.join(output, 'after', `workday-${theme}-${width}.png`) });
  await menu.getByRole('button', { name: 'Завершить работу', exact: true }).click();
  await menu.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('.workday-control-mobile-trigger')?.title.startsWith('Начать снова'));
  await page.emulateMedia({ forcedColors: 'active' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'forced-colours overflow');
  await page.emulateMedia({ forcedColors: 'none' });
};
