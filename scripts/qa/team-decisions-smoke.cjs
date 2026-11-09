// Synthetic renderer checks. Every API request is intercepted; external traffic is blocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const origin = process.env.TEAM_DECISION_QA_ORIGIN || 'http://127.0.0.1:5192';
const output = 'tmp/team-decisions-qa';
mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let letter;
  let failDecision = false;
  let writes = 0;
  const registry = letters => ({ totalCount: letters.length, pendingReviewCount: letters.length,
    readyCount: 0, sentCount: 0, signedCount: 0, letters });
  const leave = {
    id: 'qa-leave', requesterUserId: 'qa-author', applicationText: 'Тестовое заявление на отпуск.',
    requestedStartsOn: '2030-11-10', requestedEndsOn: '2030-11-30',
    startsOn: '2030-11-10', endsOn: '2030-11-30', workYearStartsOn: '2029-11-10', workYearEndsOn: '2030-11-09',
    calendarDays: 21, paidDays: 21, tenureAdditionalDays: 0, organizationEmploymentDate: '2024-01-01',
    returnOn: '2030-12-01', orderNumber: 'QA-1', orderYear: 2030, status: 'pending_deputy',
    statusLabel: 'На утверждении первого заместителя', canRevise: false, canReviewHr: false,
    canReviewDeputy: true, canWithdraw: false, hasOrder: false, actions: [],
    createdAt: '2030-11-01T06:00:00Z', updatedAt: '2030-11-01T06:00:00Z',
  };
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.includes('/api/v1/')) return url.origin === origin ? route.continue() : route.abort();
    if (path.endsWith('/signature-inbox')) return route.fulfill({ json: registry(letter.availableActions.length ? [letter] : []) });
    if (path.endsWith('/visibility')) return route.fulfill({ json: { incomingMode: 'none', canViewJournals: false, canManageVisibility: false, revision: 1 } });
    if (path.endsWith('/authority')) return route.fulfill({ json: { writable: true, mode: 'online', detail: '', leaseUntil: null } });
    if (path.endsWith('/reviewers')) return route.fulfill({ json: { revision: 1, reviewers: [], runtimes: [], updatedAt: '2030-01-01T00:00:00Z' } });
    if (path.endsWith('/letters/qa-letter/actions')) {
      assert.equal(request.method(), 'POST');
      assert.equal(request.postDataJSON().action, 'approve');
      writes += 1;
      if (failDecision) return route.fulfill({ status: 409, json: { detail: 'Тестовая ошибка решения: документ изменился' } });
      letter = { ...letter, revision: letter.revision + 1, status: 'queued', availableActions: [] };
      return route.fulfill({ json: letter });
    }
    assert.equal(request.method(), 'GET');
    if (path.endsWith('/letters/qa-letter')) return route.fulfill({ json: letter });
    if (path.endsWith('/letters')) return route.fulfill({ json: registry([letter]) });
    if (path.includes('/home/approval-inbox/')) return route.fulfill({ json: { enabled: true, items: [{ id: leave.id, title: 'Заявление на отпуск', requesterName: 'Тестовый сотрудник', startsOn: leave.startsOn, endsOn: leave.endsOn }] } });
    if (path.endsWith('/leave-requests/context')) return route.fulfill({ json: { hrUserId: 'qa-hr', deputyUserId: 'qa-reviewer', canConfigureSignature: false, signatureReady: true, tenureRules: [], canEditTenureRules: false } });
    if (path.endsWith('/leave-requests')) return route.fulfill({ json: [leave] });
    return route.fulfill({ json: path.endsWith('/incoming') ? registry([]) : [] });
  });
  try {
    for (const [name, width, height, dark, scale] of [
      ['desktop', 1440, 1000, false, 1], ['compact', 1024, 768, false, 1],
      ['phone', 390, 760, false, 1], ['zoom200', 1024, 768, false, 2],
      ['dark', 1440, 1000, true, 1],
    ]) {
      for (const kind of ['letters', 'leaves']) {
        letter = {
          id: 'qa-letter', subject: 'Тестовое письмо для согласования в обзоре команды',
          recipientOrganization: 'Тестовая организация', recipientAddress: 'Тестовая канцелярия',
          route: 'exat', note: '', status: 'pending_review', workflowKind: 'delivery', source: 'workspace',
          createdByUserId: 'qa-author', createdByName: 'Тестовый сотрудник', reviewerUserId: 'qa-reviewer',
          reviewerName: 'Тестовый руководитель', revision: 2, attachments: [], events: [], canEdit: false,
          availableActions: ['approve', 'return_for_revision'],
          createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z',
        };
        await page.setViewportSize({ width: Math.floor(width / scale), height: Math.floor(height / scale) });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(`${origin}/qa/team-decisions.html?kind=${kind}${dark ? '&dark' : ''}`);
        const metric = page.getByRole('button', { name: kind === 'letters' ? /Письма на подпись/ : /Отпуска на согласование/ });
        await metric.focus(); await page.keyboard.press('Enter');
        const queue = page.getByRole('dialog');
        await queue.getByRole('button', { name: kind === 'letters' ? /Тестовое письмо/ : /Заявление на отпуск/ }).click();
        const dialog = page.getByRole('dialog', { name: kind === 'letters' ? /Тестовое письмо/ : 'Согласование отпуска' });
        await dialog.waitFor();
        assert.equal(await page.getByRole('dialog').count(), 1);
        if (kind === 'letters') {
          assert.equal(await page.locator('.ai-referent-header').count(), 0);
          await dialog.getByRole('button', { name: 'Согласовать', exact: true }).scrollIntoViewIfNeeded();
          if (name === 'desktop') {
            failDecision = true;
            await dialog.getByRole('button', { name: 'Согласовать', exact: true }).click();
            await dialog.getByRole('alert').filter({ hasText: 'Тестовая ошибка решения' }).waitFor();
            failDecision = false;
            await dialog.getByRole('button', { name: 'Согласовать', exact: true }).click();
            await dialog.getByRole('button', { name: 'Согласовать', exact: true }).waitFor({ state: 'detached' });
          }
        } else {
          await dialog.getByRole('button', { name: 'Утвердить и подписать приказ' }).scrollIntoViewIfNeeded();
        }
        const rect = await dialog.boundingBox();
        const viewport = page.viewportSize();
        assert(rect && rect.width <= viewport.width && rect.height <= viewport.height, `${name}/${kind}: dialog fits`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: `${output}/${name}-${kind}.png`, fullPage: true });
        await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction(() => document.activeElement?.classList.contains('team-dash-metric'));
        assert.equal(await page.locator('.team-dashboard').count(), 1);
        console.log(`${name}/${kind}: in-place decision, reachable actions, focus and geometry passed`);
      }
    }
    assert.equal(writes, 2);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
