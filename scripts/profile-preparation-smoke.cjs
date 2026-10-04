// Standalone synthetic fixture only, all API traffic intercepted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const profile = {
  person: { id: 'qa-person', name: 'Тестовый сотрудник', initials: 'ТС', role: 'employee', color: '#0091A8', jobTitle: 'Проверка первого открытия' },
  departmentName: 'Тест', employmentDate: null, serviceYears: null, serviceMonths: null, serviceDays: null,
  activeTaskCount: 3, activeTaskCountVisible: true, rewards: [], rewardCatalog: [], canIssueReward: false, canManageSettings: false,
  achievements: Array.from({ length: 160 }, (_, i) => ({ code: 'qa-' + i, title: 'Достижение ' + i,
    description: 'Тестовый критерий с длинным описанием для проверки одинаковой геометрии карточек.',
    category: 'category-' + i, tier: ['bronze', 'silver', 'gold', 'prism'][i % 4], iconKey: ['check', 'layers', 'mail', 'shield'][i % 4],
    progress: i < 80 ? 1 : 0, target: 1, unlocked: i < 80 })),
};
async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const eager = process.env.PROFILE_EAGER_REFERENCE === '1';
  const out = path.resolve(eager ? 'tmp/profile-preparation-eager' : 'tmp/profile-preparation');
  await fs.mkdir(out, { recursive: true });
  const results = [];
  try {
    for (const width of [1440, 1024, 640]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      if (eager) await context.addInitScript(() => { window.IntersectionObserver = undefined; });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let calls = 0;
      await page.route('**/api/v1/**', async route => {
        assert.equal(route.request().method(), 'GET', 'no business writes');
        calls++;
        await new Promise(resolve => setTimeout(resolve, 120));
        await route.fulfill({ json: route.request().url().includes('/recognition/profiles/') ? profile : {
          period: '2026-10', timezone: 'Asia/Tashkent', methodologyVersion: '1', trackingStartedAt: '2026-01-01', currentUserId: 'qa-person', employees: [],
        } });
      });
      await page.goto('http://127.0.0.1:5173/qa/profile-preparation.html');
      await page.getByRole('button', { name: 'Прогреть профиль' }).click();
      await page.locator('[data-prepared=true]').waitFor();
      await page.waitForTimeout(500);
      const beforeCalls = calls;
      await page.evaluate(() => {
        window.qaLongTasks = [];
        window.qaOpenedAt = performance.now();
        window.qaObserver = new PerformanceObserver(list => window.qaLongTasks.push(...list.getEntries().map(e => e.duration)));
        window.qaObserver.observe({ type: 'longtask', buffered: false });
      });
      await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
      await page.getByRole('heading', { name: 'Тестовый сотрудник' }).waitFor();
      const readyMs = await page.evaluate(() => performance.now() - window.qaOpenedAt);
      await page.waitForTimeout(600);
      assert.equal(calls, beforeCalls, 'prepared opening does not repeat data requests');
      assert.equal(await page.locator('.achievement-card').count(), 160);
      const preparedAtStart = await page.locator('.achievement-card:not(.recognition-is-preparing)').count();
      if (eager) assert.equal(preparedAtStart, 160);
      else assert(preparedAtStart < 40, 'offscreen effects are not all prepared at first opening');
      const geometry = await page.locator('.achievement-card').evaluateAll(cards => cards.map(c => [c.offsetWidth, c.offsetHeight]));
      await page.getByRole('button', { name: 'Достижения', exact: true }).click();
      await page.waitForTimeout(700);
      const card = page.locator('.achievement-card').first();
      assert(!(await card.getAttribute('class')).includes('recognition-is-preparing'));
      const before = await card.boundingBox();
      await card.hover(); await page.waitForTimeout(200);
      assert(await card.evaluate(c => +c.style.getPropertyValue('--recognition-active') > 0));
      await page.screenshot({ path: path.join(out, width + '-achievements.png') });
      const content = page.locator('.employee-profile-dialog .fui-DialogContent');
      await content.evaluate(c => { c.scrollTop = c.scrollHeight; });
      await page.waitForTimeout(600);
      assert(!(await page.locator('.achievement-card').last().getAttribute('class')).includes('recognition-is-preparing'));
      const afterGeometry = await page.locator('.achievement-card').evaluateAll(cards => cards.map(c => [c.offsetWidth, c.offsetHeight]));
      assert.deepEqual(afterGeometry, geometry, 'deferred layers preserve the scroll geometry');
      await content.evaluate(c => { c.scrollTop = 0; }); await page.waitForTimeout(100);
      await page.screenshot({ path: path.join(out, width + '.png') });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Достижения', exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(await card.evaluate(c => getComputedStyle(c).transform), 'none');
      await page.keyboard.press('Escape');
      await page.locator('.employee-profile-dialog').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
      await page.getByRole('heading', { name: 'Тестовый сотрудник' }).waitFor();
      assert.equal(calls, beforeCalls, 'reopening reuses prepared data');
      const longTasks = await page.evaluate(() => { window.qaObserver.disconnect(); return window.qaLongTasks; });
      assert.deepEqual(errors, []);
      results.push({ width, eager, readyMs, calls, preparedAtStart, total: 160, longTasks, cardBounds: before });
      await context.close();
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
