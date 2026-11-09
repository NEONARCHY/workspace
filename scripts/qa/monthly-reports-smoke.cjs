// All business requests are mocked. No live employee or payroll data is touched.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { mkdirSync, readFileSync } = require('node:fs');
const origin = process.env.MONTHLY_REPORT_QA_ORIGIN || 'http://127.0.0.1:5193';
const output = 'tmp/monthly-reports-qa';
mkdirSync(output, { recursive: true });
const month = '2026-11-01';
const template = readFileSync('apps/api/src/yuksalish_api/hr_assets/monthly-report-template.docx');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let uploaded = false;
  let approved = false;
  let rejectUpload = true;
  let posts = 0;
  const snapshot = () => {
    const report = { id: 'qa-report', month, userId: 'qa-owner', revision: 1, comment: 'Результаты QA', submittedAt: '2026-11-25T10:00:00Z', files: [{ id: 'qa-file', name: 'QA-monthly-report.docx', size: 15 }] };
    const cycle = { month, reminderOn: '2026-11-25', total: 30, submitted: uploaded ? 1 : 0, authorizedAt: approved ? '2026-11-30T10:00:00Z' : null, authorizedByName: approved ? 'Тестовый первый заместитель' : null, comment: '', canSubmit: !approved,
      members: Array.from({ length: 30 }, (_, index) => ({ userId: `qa-${index}`, name: `Тестовый сотрудник ${index + 1}`, department: 'Синтетический отдел Центрального аппарата', report: index === 0 && uploaded ? report : null })) };
    return { today: '2026-11-25', activeMonth: month, dashboardVisible: true, canReview: true, canAuthorize: true, canConfigure: false, reminderMonth: uploaded ? null : month, payrollNotice: null, payrollNoticeId: null, cycles: [cycle], reports: uploaded ? [report] : [] };
  };
  await page.route('**/*', async route => {
    const request = route.request();
    if (!request.url().startsWith(origin)) return route.abort();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (path.endsWith('/template')) return route.fulfill({ body: template, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    if (path.endsWith('/submit')) {
      posts++;
      assert.equal(request.method(), 'POST');
      assert.match(request.headers()['content-type'], /^multipart\/form-data;/);
      assert.match(request.postData(), /QA-monthly-report\.docx/);
      assert.match(request.postData(), /2026-11-01/);
      if (rejectUpload) { rejectUpload = false; return route.fulfill({ status: 503, json: { detail: 'Тестовая ошибка загрузки. Повторите отправку.' } }); }
      uploaded = true;
      return route.fulfill({ json: snapshot().reports[0] });
    }
    if (path.endsWith('/authorize')) {
      posts++;
      assert.equal(request.method(), 'POST');
      approved = true;
      return route.fulfill({ json: snapshot().cycles[0] });
    }
    assert.equal(path, '/api/v1/monthly-reports');
    assert.equal(request.method(), 'GET');
    return route.fulfill({ json: snapshot() });
  });
  try {
    for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'compact', width: 1024, height: 768 }, { name: 'phone', width: 390, height: 844 }, { name: 'zoom200', width: 512, height: 384 }, { name: 'dark', width: 1280, height: 800, dark: true }]) {
      uploaded = false; approved = false;
      await page.setViewportSize(size);
      await page.goto(`${origin}/qa/monthly-reports.html${size.dark ? '?dark' : ''}`);
      const trigger = page.getByRole('button', { name: /Ойлик ҳисоботлар/ });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Ойлик ҳисоботлар' });
      await dialog.waitFor();
      await page.waitForTimeout(350);
      const geometry = await dialog.evaluate(element => {
        const r = element.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth };
      });
      assert(geometry.left >= 0 && geometry.top >= 0 && geometry.right <= geometry.width + 1 && geometry.bottom <= geometry.height + 1, JSON.stringify(geometry));
      assert(geometry.scroll <= geometry.width + 1);
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Скачать шаблон отчёта' }).click();
      assert.equal((await download).suggestedFilename(), 'oylik-hisobot.docx');
      if (size.name === 'desktop') {
        await dialog.getByLabel('Файлы отчёта', { exact: true }).setInputFiles({ name: 'QA-monthly-report.docx', mimeType: 'application/octet-stream', buffer: Buffer.from('Synthetic report') });
        await dialog.getByRole('button', { name: 'Отправить отчёт', exact: true }).click();
        await dialog.getByRole('alert').filter({ hasText: 'Тестовая ошибка загрузки' }).waitFor();
        await dialog.getByText('QA-monthly-report.docx · 1 КБ').waitFor();
        await dialog.getByRole('button', { name: 'Отправить отчёт', exact: true }).click();
        await dialog.getByText('Отчёт отправлен. Предыдущие версии сохранены в истории.').waitFor();
        await dialog.getByRole('button', { name: 'Разрешить начисление заработной платы', exact: true }).click();
        await dialog.getByRole('button', { name: /Подтвердить разрешение за/ }).click();
        await dialog.getByText(/Начисление заработной платы разрешено/).waitFor();
      }
      await dialog.getByRole('button', { name: 'Вернуться в рабочее пространство' }).scrollIntoViewIfNeeded();
      assert(await dialog.getByRole('button', { name: 'Вернуться в рабочее пространство' }).evaluate(element => {
        const control = element.getBoundingClientRect();
        const surface = element.closest('[role="dialog"]').getBoundingClientRect();
        return control.bottom <= surface.bottom && control.top >= surface.top;
      }), 'Footer action extends beyond the dialog surface');
      await page.screenshot({ path: `${output}/${size.name}.png`, fullPage: true });
      await dialog.getByRole('button', { name: 'Вернуться в рабочее пространство' }).click();
      await dialog.waitFor({ state: 'hidden' });
      await page.waitForTimeout(350);
      assert(await trigger.evaluate(element => element === document.activeElement), 'Focus did not return to the dashboard block: ' + await page.evaluate(() => JSON.stringify({ lifecycle: document.documentElement.dataset, active: document.activeElement?.outerHTML.slice(0,350), dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map(e=>({hidden:e.getAttribute('aria-hidden'),name:e.getAttribute('aria-label')})) })));
      console.log(`${size.name}: template, modal geometry, scrolling and focus passed`);
    }
    assert.equal(posts, 3, 'Only two upload attempts and one payroll decision are allowed');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
