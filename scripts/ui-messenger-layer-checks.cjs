const assert = require('node:assert/strict');
const path = require('node:path');

// Run with the full-page messenger open on synthetic QA data.
module.exports = async function checkMessengerLayers(page, options = {}) {
  const messenger = page.locator('.floating-messenger-elevation.is-full-page:not([hidden])');
  await messenger.waitFor();
  const messengerProvider = page.locator('body > .fui-FluentProvider:has(> .floating-messenger-root)');
  assert.equal(await messengerProvider.evaluate(el => getComputedStyle(el).zIndex), '1', 'full-page messenger stays at the page layer');
  const button = page.locator('.color-theme-toggle');
  if (await button.isVisible()) {
    await button.hover();
    const tip = page.getByRole('tooltip', { name: /Включить .+ тему/ });
    await tip.waitFor({ state: 'visible' });
    await assertTopmost(tip, 'theme tooltip');
    if (options.output) await page.screenshot({ path: path.join(options.output, options.phase, `tooltip-${options.theme}-${options.width}.png`) });
  }
  await page.mouse.move(0, 0);
  await page.locator('.workspace-identity-menu').click();
  const menu = page.locator('.identity-popover').filter({ visible: true });
  await menu.waitFor({ state: 'visible' });
  await assertTopmost(menu, 'identity menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  assert(!await page.locator('html').getAttribute('data-workspace-tab-focus'), 'pointer input does not enable focus rings');
  await page.keyboard.press('Shift');
  assert(!await page.locator('html').getAttribute('data-workspace-tab-focus'), 'Shift alone does not enable focus rings');
  // Start inside the conversation, rather than tabbing out of the last portal
  // into browser chrome (which intentionally clears modality on window blur).
  await page.locator('.pinned-message-trigger').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), 'true', 'Tab enables focus traversal rings');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('html').getAttribute('data-workspace-tab-focus'), 'true', 'Shift+Tab retains focus traversal rings');
  await page.keyboard.press('Meta');
  assert(!await page.locator('html').getAttribute('data-workspace-tab-focus'), 'Win clears focus rings');
};

async function assertTopmost(locator, name) {
  const hit = await locator.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(top && (top === el || el.contains(top)));
  });
  assert(hit, `${name} must paint above messenger`);
}
