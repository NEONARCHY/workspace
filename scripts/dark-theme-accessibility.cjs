// Measured text contrast on real components. Automated checks complement, not
// replace, screenshots: gradients, images and physical assistive tech need review.
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const output = path.resolve('tmp/dark-theme/accessibility');
fs.mkdirSync(output, { recursive: true });
const report = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      await context.route('**/api/**', route => { throw new Error('API escaped fixture: ' + route.request().url()); });
      await context.route('**/__qa/axe.js', route => route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') }));
      const page = await context.newPage();
      const audit = async name => {
        await page.waitForTimeout(250);
        await page.addScriptTag({ url: '/__qa/axe.js' });
        const result = await page.evaluate(async () => {
          const { violations, incomplete, passes } = await window.axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } });
          const compact = items => items.map(item => ({ id: item.id, impact: item.impact, nodes: item.nodes.map(node => ({ target: node.target, html: node.html, failureSummary: node.failureSummary, checks: [...node.any, ...node.all, ...node.none].map(check => ({ id: check.id, data: check.data })) })) }));
          return { violations: compact(violations), incomplete: compact(incomplete), passes: passes.length };
        });
        report.push({ name: `${width}-${name}`, ...result });
        fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
        console.log(width, name, 'violations:', result.violations.flatMap(item => item.nodes).length, 'manual review:', result.incomplete.flatMap(item => item.nodes).length);
      };
      await page.goto('http://127.0.0.1:5173/qa/mobile-secondary.html?theme=dark&recognition');
      for (const section of ['home', 'team', 'feed', 'tasks', 'employees', 'notifications', 'hr', 'members', 'referent', 'hisobot', 'bots', 'incoming', 'zoom', 'absences', 'components']) {
        await page.getByLabel('QA раздел').selectOption(section); await audit(section);
      }
      await page.getByRole('button', { name: 'Профиль', exact: true }).click();
      await page.locator('.employee-profile-dialog').waitFor(); await audit('profile');
      await page.getByRole('button', { name: 'Награды', exact: true }).click(); await audit('rewards');
      await page.getByRole('button', { name: 'Достижения', exact: true }).click(); await audit('achievements');
      await page.getByRole('button', { name: 'Закрыть профиль', exact: true }).click();
      await page.getByRole('button', { name: 'Настройки', exact: true }).click(); await audit('settings');
      await page.goto('http://127.0.0.1:5173/qa/mobile-workflows.html?theme=dark');
      for (const name of ['Проекты', 'Проектные', 'Оплаты', 'Поездки', 'Календарь']) { await page.getByRole('button', { name, exact: true }).click(); await audit(name); }
      await page.goto('http://127.0.0.1:5173/qa/mobile-domains.html?theme=dark'); await audit('messenger');
      await context.close();
    }
    assert.equal(report.flatMap(item => item.violations.flatMap(rule => rule.nodes)).length, 0, 'Confirmed colour contrast violations: see report.json');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
