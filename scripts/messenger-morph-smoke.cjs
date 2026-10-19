const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  fs.mkdirSync('tmp/messenger-morph-qa', { recursive: true });
  for (const theme of ['light', 'dark']) for (const position of [{ x: 1, y: 1 }, { x: .1, y: .15 }]) {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`http://127.0.0.1:5178/qa/detail-layout.html?view=floating-messenger&theme=${theme}`);
    await page.evaluate(p => localStorage.setItem('ws:mini-messenger-position:aziza', JSON.stringify(p)), position);
    await page.reload();
    const button = page.locator('.floating-messenger-launcher');
    await button.waitFor();
    const origin = await button.boundingBox();
    await button.evaluate(node => node.click());
    const panel = page.getByRole('dialog', { name: 'Мини-мессенджер', exact: true });
    await panel.waitFor();
    assert.equal(await button.isVisible(), false);
    const initial = await panel.evaluate(node => {
      const animation = node.getAnimations().find(a => a.effect.getKeyframes().some(k => k.clipPath));
      if (!animation) throw new Error('Opening morph is missing');
      animation.pause(); animation.currentTime = 0;
      const elevation = node.parentElement;
      return { clip: getComputedStyle(node).clipPath, rect: node.getBoundingClientRect().toJSON(),
        filter: getComputedStyle(elevation).filter, ownShadow: getComputedStyle(node).boxShadow };
    });
    assert.ok(initial.filter.includes('drop-shadow'), 'elevation must exist from the first frame outside the reveal mask');
    assert.equal(initial.ownShadow, 'none', 'the clipped panel must not retain a shadow that pops in at the end');
    const values = initial.clip.match(/inset\(([^)]*)/)[1].split('round')[0].match(/[\d.-]+/g).map(Number);
    assert.ok(Math.abs(initial.rect.x + values[3] - origin.x) < 1);
    assert.ok(Math.abs(initial.rect.y + values[0] - origin.y) < 1);
    assert.ok(Math.abs(initial.rect.width - values[1] - values[3] - 48) < 1);
    assert.ok(Math.abs(initial.rect.height - values[0] - values[2] - 48) < 1);
    await panel.evaluate(node => { const a = node.getAnimations()[0]; a.currentTime = 110; });
    const sample = await panel.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const edges = getComputedStyle(node).clipPath.split('round')[0].match(/[\d.-]+/g).map(Number);
      return { x: Math.max(0, Math.floor(rect.left + edges[3] - 14)),
        y: Math.max(0, Math.floor(rect.top + edges[0] + (rect.height - edges[0] - edges[2]) / 2)), width: 8, height: 8 };
    });
    const withShadow = await page.screenshot({ clip: sample });
    await panel.evaluate(node => { node.parentElement.style.filter = 'none'; });
    const withoutShadow = await page.screenshot({ clip: sample });
    await panel.evaluate(node => { node.parentElement.style.removeProperty('filter'); });
    assert.equal(withShadow.equals(withoutShadow), false, 'shadow pixels must already exist outside the partially revealed window');
    await page.screenshot({ path: `tmp/messenger-morph-qa/${theme}-${position.x}-midpoint.png` });
    await panel.evaluate(node => node.getAnimations().forEach(a => a.finish()));
    const editor = panel.locator('.pane-search input');
    await editor.fill('Черновик поиска');
    await panel.getByRole('button', { name: 'Свернуть мини-мессенджер' }).evaluate(node => node.click());
    const closing = await panel.evaluate(node => { const a = node.getAnimations()[0]; a.pause(); a.currentTime = 130; return getComputedStyle(node).clipPath; });
    assert.notEqual(closing, 'none');
    assert.equal(await button.isVisible(), false);
    await panel.evaluate(node => node.getAnimations().forEach(a => a.finish()));
    await button.waitFor({ state: 'visible' });
    await button.click();
    assert.equal(await editor.inputValue(), 'Черновик поиска');
    // Changing accessibility preferences mid-flight must settle without trapping focus.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await panel.getByRole('button', { name: 'Свернуть мини-мессенджер' }).click();
    await button.waitFor({ state: 'visible' });
    await button.click();
    assert.equal(await panel.evaluate(node => node.getAnimations().length), 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  }
  assert.deepEqual(errors, []);
  console.log('Messenger morph: both themes, moved/default origins, shadow pixels during reveal, 48px initial clip, intermediate opening/closing, retained search and reduced motion passed.');
  await browser.close();
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
