const assert = require('node:assert/strict');
const path = require('node:path');
module.exports = async (page, { phase, width, theme, output, releaseVisibility, releaseAuthority }) => {
  const root = page.locator('.ai-referent-view');
  await root.waitFor();
  const tabs = root.locator('.ai-referent-register-tabs');
  const pendingTabs = await tabs.count();
  await page.screenshot({ path: path.join(output, phase, `pending-${theme}-${width}.png`) });
  if (phase === 'after') assert.equal(pendingTabs, 0, 'no incomplete register buttons while access is unresolved');
  assert.equal(await root.getByRole('button', { name: 'Новое письмо', exact: true }).count(), 0, 'no creation before authority is known');
  releaseVisibility();
  const incoming = root.locator('.ai-referent-register-tabs button').filter({ hasText: /^Входящие$/ });
  await incoming.waitFor({ state: 'attached' });
  const active = await incoming.getAttribute('aria-selected');
  assert.equal(active, 'true', 'first settled navigation selects the actual incoming register');
  await root.locator('.ai-incoming-table tbody tr').first().waitFor();
  await page.screenshot({ path: path.join(output, phase, `visibility-${theme}-${width}.png`) });
  releaseAuthority();
  await root.getByRole('button', { name: 'Новое письмо', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, phase, `ready-${theme}-${width}.png`) });
  const misplaced = await root.locator('.ai-referent-toolbar-actions').evaluateAll(nodes => nodes.filter(node => !node.closest('.ai-referent-register-tools')).length);
  assert.equal(misplaced, 0, 'register actions stay in their final toolbar');
  assert(await root.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'no initial-load overflow');
  if (phase === 'after' && width >= 1024) {
    await page.getByRole('button', { name: /^Курсы валют: 1 USD/ }).click();
    const rates = page.getByRole('dialog', { name: 'Курсы валют', exact: true });
    const pound = rates.getByRole('button', { name: /GBP Фунт стерлингов/ });
    assert.equal(await rates.getByRole('button', { name: /CNY|Юань/ }).count(), 0);
    await pound.click();
    await page.getByRole('textbox', { name: 'Сумма в GBP', exact: true }).fill('2,5');
    assert.equal((await rates.locator('output').innerText()).replace(/\s/g, ''), '40000UZS');
    await page.screenshot({ path: path.join(output, phase, `gbp-${theme}-${width}.png`) });
    await rates.getByRole('button', { name: 'Закрыть курсы валют' }).click();
  }
  return { pendingTabs, active, misplaced };
};
