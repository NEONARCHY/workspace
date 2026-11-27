const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async (page, { output, phase, width, theme, geometry }) => {
  const group = page.getByRole('group', { name: 'Участие в исходящих письмах' });
  const mine = group.getByRole('button', { name: 'Мои', exact: true });
  const all = group.getByRole('button', { name: 'Все', exact: true });
  const row = page.locator('.ai-referent-row').first();
  const snapshot = () => group.evaluate(node => {
    const box = element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return { x: r.x, y: r.y, width: r.width, height: r.height, radius: parseFloat(s.borderRadius) }; };
    return { group: box(node), buttons: [...node.querySelectorAll('button')].map(box) };
  });
  const initial = await snapshot();
  await group.screenshot({ path: path.join(output, phase, `participation-${theme}-${width}.png`) });
  assert.equal(await mine.getAttribute('aria-pressed'), 'true');
  const response = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/ai-referent/letters') && url.searchParams.get('participation') === 'all';
  });
  await all.click(); await response; await row.waitFor();
  assert.equal(await all.getAttribute('aria-pressed'), 'true');
  assert.equal(await mine.getAttribute('aria-pressed'), 'false');
  await group.screenshot({ path: path.join(output, phase, `participation-all-${theme}-${width}.png`) });
  const selected = await snapshot();
  if (phase === 'after') {
    assert(geometry.pageOverflow <= 1, 'outgoing registry fits the viewport');
    if (width <= 480) assert((await page.locator('.ai-referent-outgoing-toolbar').boundingBox()).height <= 120, 'phone toolbar stays compact');
    if (width === 1440) {
      const layout = await page.locator('.ai-referent-outgoing-toolbar').evaluate(node => [...node.children].map(child => { const r = child.getBoundingClientRect(); return { center: r.y + r.height / 2, bottom: r.bottom }; }));
      assert(layout.length === 3 && Math.max(...layout.map(r => r.center)) - Math.min(...layout.map(r => r.center)) <= 1, 'participation, search and status filters share a single row');
      const search = page.getByRole('textbox', { name: 'Поиск исходящих писем' });
      await search.focus();
      assert((await search.boundingBox()).width > 100, 'search remains usable in the compact row');
    }
    for (const state of [initial, selected]) {
      assert(state.group.radius >= 10, 'rounded participation surface');
      assert.equal(state.buttons[0].width, state.buttons[1].width, 'equal segment widths');
      for (const button of state.buttons) {
        assert(button.height >= (width <= 720 ? 44 : 36), 'comfortable control height');
        assert(button.x >= state.group.x + 3 && button.x + button.width <= state.group.x + state.group.width - 3, 'segments have breathing room');
        assert(button.radius >= 8, 'rounded segments');
      }
    }
    const borderWidths = () => row.evaluate(node => { const s = getComputedStyle(node); return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth]; });
    assert.deepEqual(await borderWidths(), ['0px', '0px', '0px', '0px'], 'letter has no decorative outline');
    await row.hover();
    assert.deepEqual(await borderWidths(), ['0px', '0px', '0px', '0px'], 'hover adds no frame');
    await page.keyboard.press('Tab'); await row.focus();
    const focus = await row.evaluate(node => { const s = getComputedStyle(node); return { visible: node.matches(':focus-visible'), width: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
    assert(focus.visible && focus.width >= 2 && focus.style !== 'none', 'keyboard focus remains visible: ' + JSON.stringify({ theme, width, focus }));
    await page.emulateMedia({ forcedColors: 'active' });
    assert.notEqual(await all.evaluate(node => getComputedStyle(node).outlineStyle), 'none', 'high contrast selection remains visible');
    await page.emulateMedia({ forcedColors: 'none' });
  }
  return { initial, selected, count: await page.locator('.ai-referent-row').count() };
};
