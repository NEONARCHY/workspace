const assert = require('node:assert/strict');
module.exports = async (page, section, options) => {
  const { phase, width } = options;
  const root = page.locator(section.root);
  const metrics = await root.evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, right: innerWidth - r.right, width: r.width, height: r.height, overflow: node.scrollWidth - node.clientWidth, supportRows: node.querySelectorAll('.support-request-card').length }; });
  if (phase === 'after') {
    assert(metrics.overflow <= 1, section.id + ': no horizontal overflow');
    assert(Math.abs(metrics.x - metrics.right) <= 1, section.id + ': symmetric dialog margins ' + JSON.stringify(metrics));
    if (width <= 700) assert.equal(Math.round(metrics.x), 12, section.id + ': shared 12px phone inset');
    const launcher = page.locator('.floating-messenger-launcher');
    if (await launcher.count()) assert.equal(await launcher.evaluate(node => getComputedStyle(node).visibility), 'hidden', 'background messenger stays behind modal');
    await require('./ui-personal-interactions.cjs')(page, section, options);
    if (section.id === 'settings') {
      metrics.fields = await root.locator('.account-section .fui-Dropdown__button, .account-section .birthday-day-trigger').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().width).map(node => ({ fill: getComputedStyle(node).backgroundColor, image: getComputedStyle(node).backgroundImage, section: getComputedStyle(node.closest('.account-section')).backgroundColor })));
      assert(metrics.fields.length >= 3 && metrics.fields.every(field => field.image === 'none' && field.fill !== field.section && field.fill !== 'rgba(0, 0, 0, 0)'), 'settings: painted language/day/month fields have distinct filled surfaces');
    }
    if (section.id === 'profile') {
      const collisions = await root.locator('.employee-profile-overview > article').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect()).flatMap((r, i, a) => a.slice(i + 1).filter(s => r.left < s.right - 1 && r.right > s.left + 1 && r.top < s.bottom - 1 && r.bottom > s.top + 1)).length);
      assert.equal(collisions, 0, 'profile: summary cards do not overlap');
    }
  }
  await root.getByRole('button', { name: section.id === 'profile' ? 'Закрыть профиль' : section.id === 'settings' ? 'Закрыть' : 'Закрыть поддержку', exact: true }).click();
  await root.waitFor({ state: 'hidden' });
  return metrics;
};
