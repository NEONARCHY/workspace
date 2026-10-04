// Synthetic browser QA: every API call intercepted; no business data or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const employee = { userId: 'qa-person', name: 'Тестовый сотрудник', jobTitle: 'Специалист', period: '2026-10', timezone: 'Asia/Tashkent', percentage: 75, onTimeCount: 3, eligibleCount: 4, overdueCount: 1, awaitingReviewCount: 1, noDueDateCount: 2, returnedForRevisionCount: 1, excludedCount: 1, sampleSize: 4, methodologyVersion: 'EFF-2.0', trackingStartedAt: '2026-07-01T00:00:00Z', historyCompleteness: 'complete', smallSample: true,
  history: [{ period: '2026-07', percentage: 60, onTimeCount: 3, eligibleCount: 5, historyCompleteness: 'complete' }, { period: '2026-08', percentage: 80, onTimeCount: 4, eligibleCount: 5, historyCompleteness: 'complete' }, { period: '2026-09', percentage: null, onTimeCount: 0, eligibleCount: 0, historyCompleteness: 'unavailable' }, { period: '2026-10', percentage: 75, onTimeCount: 3, eligibleCount: 4, historyCompleteness: 'complete' }] };
const task = { id: 'qa-task', title: 'Подготовить материалы к презентации и согласовать итоговый отчёт', status: 'awaiting_review', dueAt: '2026-10-05T10:00:00Z', updatedAt: '2026-10-04T10:00:00Z', onTimeCount: 1, overdueCount: 0, excludedCount: 0, returnedForRevisionCount: 1 };
const personal = { employee, taskDetailsVisible: true, workload: { new: 1, inProgress: 2, awaitingReview: 1, completed: 3 }, recentTasks: [task], impactTasks: [task], impactTaskCount: 1 };
const profile = { person: { id: 'qa-person', name: employee.name, initials: 'ТС', role: 'employee', color: '#0091a8', jobTitle: employee.jobTitle }, departmentName: 'Тест', employmentDate: null, serviceYears: null, serviceMonths: null, serviceDays: null, activeTaskCount: 4, activeTaskCountVisible: true, rewards: [], rewardCatalog: [], achievements: [], canIssueReward: false, canManageSettings: false };

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = path.resolve('tmp/personal-efficiency');
  await fs.mkdir(out, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of [[1440, 900], [800, 700], [420, 760], [800, 450]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      const page = await context.newPage(); const errors = []; const methods = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/v1/**', async route => {
        methods.push(route.request().method());
        assert.equal(route.request().method(), 'GET', 'no real writes');
        const url = route.request().url();
        await route.fulfill({ json: url.includes('/profile/me/efficiency') ? personal : url.includes('/recognition/profiles/') ? profile : url.includes('/efficiency') ? { currentUserId: 'qa-person', employees: [employee] } : url.includes('/directory') ? { departments: [], positions: [], employees: [] } : [] });
      });
      await page.goto('http://127.0.0.1:5173/qa/personal-efficiency.html');
      const dropdown = page.getByRole('combobox', { name: 'Роль в задаче' });
      await dropdown.waitFor();
      for (const role of ['Я исполнитель', 'Я соисполнитель']) {
        await dropdown.click(); await page.getByRole('option', { name: role, exact: true }).click();
        const geometry = await dropdown.evaluate(el => {
          const button = el.querySelector('button') || el;
          return { text: button.textContent, whiteSpace: getComputedStyle(button).whiteSpace, width: button.clientWidth, scrollWidth: button.scrollWidth, height: button.clientHeight, scrollHeight: button.scrollHeight };
        });
        assert.equal(geometry.whiteSpace, 'nowrap');
        assert(geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
        assert(geometry.scrollHeight <= geometry.height + 1, JSON.stringify(geometry));
      }
      await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
      await page.getByRole('button', { name: 'Моя эффективность', exact: true }).click();
      await page.getByText('3 из 4 задач в расчёте', { exact: true }).waitFor();
      assert.equal(await page.getByRole('dialog').count(), 1, 'no nested profile dialog');
      const overflow = await page.locator('.personal-efficiency').evaluate(el => ({ width: el.clientWidth, scrollWidth: el.scrollWidth }));
      assert(overflow.scrollWidth <= overflow.width + 1, JSON.stringify(overflow));
      await page.screenshot({ path: path.join(out, `${width}x${height}-efficiency.png`) });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.getByRole('button', { name: 'Обновить мою эффективность' }).click();
      await page.getByText('3 из 4 задач в расчёте', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'К профилю' }).click();
      assert(await page.getByRole('button', { name: 'Моя эффективность', exact: true }).evaluate(el => el === document.activeElement), 'restores keyboard focus');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Пригласить сотрудника', exact: true }).click();
      const invite = page.getByRole('dialog', { name: 'Приглашение сотрудника' });
      await invite.waitFor();
      assert.equal(await invite.getByRole('heading', { name: 'Пригласить сотрудника' }).count(), 1);
      const bounds = await invite.boundingBox();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= height + 1, JSON.stringify(bounds));
      const section = await page.locator('#account-page-invite').evaluate(el => ({ border: getComputedStyle(el).borderWidth, background: getComputedStyle(el).backgroundColor }));
      assert.equal(section.border, '0px');
      await page.getByRole('button', { name: 'Создать приглашение' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, `${width}x${height}-invite.png`) });
      await page.keyboard.press('Escape');
      assert.deepEqual(errors, []);
      results.push({ width, height, overflow, invite: bounds, reads: methods.length, pageErrors: errors });
      await context.close();
    }
    await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
