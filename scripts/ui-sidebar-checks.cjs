const assert = require('node:assert/strict');
const path = require('node:path');

exports.installProbe = () => {
  window.sidebarProbe = { observers: 0, observations: 0, callbacks: 0, disconnects: 0, reads: 0 };
  const Native = window.ResizeObserver;
  window.ResizeObserver = class extends Native {
    constructor(callback) {
      const targets = new Set();
      super((entries, observer) => { if (targets.size) window.sidebarProbe.callbacks++; callback(entries, observer); });
      this.targets = targets;
    }
    observe(target, options) {
      if (target.closest?.('.app-rail')) {
        if (!this.targets.size) window.sidebarProbe.observers++;
        window.sidebarProbe.observations++; this.targets.add(target);
      }
      return super.observe(target, options);
    }
    disconnect() { if (this.targets.size) window.sidebarProbe.disconnects++; this.targets.clear(); return super.disconnect(); }
  };
  for (const property of ['offsetTop', 'offsetLeft', 'offsetWidth', 'offsetHeight']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, property);
    Object.defineProperty(HTMLElement.prototype, property, { ...descriptor, get() {
      if (this.closest('.app-rail')) window.sidebarProbe.reads++;
      return descriptor.get.call(this);
    } });
  }
};

exports.check = async (page, { output, phase, width, height, theme }) => {
  const rail = page.locator('.app-rail'), after = phase === 'after';
  const settle = () => page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 400)); });
  const capture = async name => { await settle(); await page.screenshot({ path: path.join(output, phase, `${name}-${theme}-${width}.png`) }); };
  const open = async () => {
    await settle();
    if (!await rail.isVisible()) await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await rail.waitFor({ state: 'visible' });
  };
  const navigate = async label => {
    await open();
    const target = rail.getByRole('button', { name: label, exact: true });
    if (await target.isVisible()) await target.click();
    else { await rail.getByRole('button', { name: /^Ещё,/ }).click(); await page.getByRole('complementary', { name: 'Другие разделы' }).getByRole('button', { name: label, exact: true }).click(); }
    await settle();
  };
  await open();
  const expand = rail.getByRole('button', { name: 'Развернуть меню', exact: true }); if (await expand.isVisible()) await expand.click();
  await page.evaluate(() => { for (const key in window.sidebarProbe) window.sidebarProbe[key] = 0; });
  for (const label of ['Задачи', 'Мессенджер', 'Задачи', 'Мессенджер']) await navigate(label);
  const metrics = await page.evaluate(() => ({ ...window.sidebarProbe }));
  await open(); await capture('sidebar-expanded');
  const labelRects = () => rail.locator('.rail-action > .rail-label').evaluateAll(nodes => nodes.filter(node => node.getClientRects().length).map(node => ({ text: node.textContent, x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })));
  const before = await labelRects();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await rail.getByRole('button', { name: 'Задачи', exact: true }).click();
  await open(); await settle();
  if (after) {
    assert.deepEqual(await labelRects(), before, 'selection keeps labels stationary');
    assert.equal(await rail.locator('.sliding-segmented-indicator').count(), 0, 'sidebar selection needs no measured travelling surface');
    const frames = await rail.evaluate(node => [node, ...node.querySelectorAll('.rail-action, .rail-profile')].filter(item => {
      const style = getComputedStyle(item); return parseFloat(style.borderTopWidth) > 0 || style.boxShadow.includes('inset');
    }).map(item => item.className));
    assert.deepEqual(frames, [], 'sidebar surfaces have no decorative frames');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (after) assert.equal(await rail.locator('.rail-action').first().evaluate(node => getComputedStyle(node, '::before').transitionDuration), '0s', 'reduced motion disables selection fade');
  await rail.getByRole('button', { name: 'ИИ-модули', exact: true }).click();
  await rail.getByRole('button', { name: 'AI Referent', exact: true }).click();
  await open();
  if (await rail.getByRole('button', { name: 'ИИ-модули', exact: true }).getAttribute('aria-expanded') !== 'true') await rail.getByRole('button', { name: 'ИИ-модули', exact: true }).click();
  await capture('sidebar-ai');
  assert.equal(await rail.getByRole('button', { name: 'ИИ-модули', exact: true }).getAttribute('aria-expanded'), 'true');
  assert.equal(await rail.getByRole('button', { name: 'AI Referent', exact: true }).getAttribute('aria-current'), 'page');
  await rail.getByRole('button', { name: 'ИИ-модули', exact: true }).click();
  await rail.getByRole('button', { name: 'Изменить порядок меню', exact: true }).click();
  await rail.getByRole('button', { name: 'Отмена', exact: true }).click();
  if (width >= 1024) {
    await rail.getByRole('button', { name: 'Свернуть меню', exact: true }).click(); await capture('sidebar-collapsed');
    if (after) assert.equal(await rail.getByRole('button', { name: 'Перейти на Главную', exact: true }).isVisible(), false, 'collapsed rail has no invisible logo target');
    await rail.getByRole('button', { name: 'Развернуть меню', exact: true }).click();
    await page.setViewportSize({ width, height: 600 }); await settle();
    const more = rail.getByRole('button', { name: /^Ещё,/ }); await more.click();
    const drawer = page.getByRole('complementary', { name: 'Другие разделы' });
    await drawer.waitFor(); await capture('sidebar-more');
    await more.press('Escape'); assert(await more.evaluate(node => node === document.activeElement));
    await page.setViewportSize({ width, height });
  } else {
    await rail.getByRole('button', { name: 'Закрыть меню', exact: true }).click(); await capture('sidebar-collapsed');
    await open();
  }
  if (after) {
    await navigate('Задачи'); await open();
    const logo = rail.getByRole('button', { name: 'Перейти на Главную', exact: true });
    const bounds = await logo.boundingBox();
    assert(bounds.height >= 44 && bounds.width >= 44, 'logo has a usable hit target');
    await page.keyboard.press('Tab'); await logo.focus();
    assert.equal(await logo.evaluate(node => getComputedStyle(node).outlineWidth), '2px', 'logo retains keyboard focus');
    await logo.press('Enter');
    await page.locator('.personal-home').waitFor();
    if (width < 1024) assert.equal(await rail.isVisible(), false, 'logo closes the mobile menu');
    await open();
  }
  await page.emulateMedia({ forcedColors: 'active' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'navigation has no page overflow');
  if (after) {
    const first = rail.locator('.rail-action').first(); await first.focus(); await first.press('Tab');
    assert(await page.evaluate(() => Boolean(document.activeElement?.closest('.app-rail')) && getComputedStyle(document.activeElement).outlineStyle !== 'none'), 'keyboard focus remains visible in high contrast');
  }
  await page.emulateMedia({ forcedColors: 'none' });
  return metrics;
};
