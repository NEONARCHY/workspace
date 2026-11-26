const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const output = path.resolve(process.env.HISOBOT_QA_OUTPUT || 'tmp/hisobot-activity-draft');
    const origin = process.env.HISOBOT_QA_ORIGIN || 'http://127.0.0.1:5186';
    const before = process.argv.includes('--before');
    await fs.mkdir(output, { recursive: true });
    const errors = [];
    for (const theme of ['light', 'dark']) {
      for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [320, 640]]) {
        const page = await browser.newPage({ viewport: { width, height } });
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          const OriginalDate = Date;
          const epoch = OriginalDate.parse('2026-10-21T12:41:00Z');
          globalThis.Date = class extends OriginalDate {
            constructor(...args) { super(...(args.length ? args : [epoch])); }
            static now() { return epoch; }
          };
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            writeText: async text => { globalThis.__hisobotCopiedText = text; },
          } });
        });
        await page.goto(`${origin}/qa/hisobot-activity-draft.html?theme=${theme}`);
        const prompt = before ? page.getByRole('dialog') : page.getByRole('region', { name: 'Черновик ежедневного отчёта' });
        await prompt.waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Presence is opacity-animated; inspect the settled surface, not a fade-in frame.
        await page.waitForTimeout(350);
        const box = await prompt.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width + 1, `dialog horizontal bounds ${theme}/${width}`);
        assert(box.y >= 0 && box.y + box.height <= height + 1, `dialog vertical bounds ${theme}/${width}`);
        await page.screenshot({ path: path.join(output, `${theme}-${width}-prompt.png`) });
        if (before) { await page.close(); continue; }
        assert.equal(await page.getByRole('dialog').count(), 0, 'no modal or focus trap');
        assert(box.width <= 360 && box.height < height / 2, 'compact nonmodal offer');
        for (const bounds of await prompt.getByRole('button').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent || node.getAttribute('aria-label'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })))) assert(bounds.width >= 44 && bounds.height >= 44, `touch targets at least 44px: ${JSON.stringify(bounds)}`);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await prompt.evaluate(node => node.getAnimations({ subtree: true }).length), 0, 'reduced motion');
        await page.emulateMedia({ forcedColors: 'active' });
        assert.equal(await prompt.evaluate(node => getComputedStyle(node).borderTopWidth), '1px', 'system-colour boundary');
        await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
        await prompt.screenshot({ path: path.join(output, `${theme}-${width}-notice.png`) });
        const contentBounds = await page.locator('#workspace-content').boundingBox();
        await page.locator('#workspace-content').click({ position: { x: 12, y: contentBounds.height - 12 } });
        await page.getByRole('button', { name: 'Закрыть уведомление AI Hisobot' }).click();
        assert.deepEqual(await page.locator('#workspace-content').boundingBox(), contentBounds, 'notice never changes page geometry');
        await page.reload();
        await page.getByRole('button', { name: 'Главная', exact: true }).waitFor();
        assert.equal(await prompt.count(), 0, 'dismissal survives reload');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.getByRole('button', { name: 'Открыть AI Hisobot' }).click();
        const editor = page.getByRole('textbox', { name: 'Опишите выполненные задачи одним текстовым сообщением:' });
        await editor.waitFor();
        await page.waitForFunction(() => document.querySelector('#hisobot-report-text')?.value.includes('Подготовлен'));
        const edited = `${await editor.inputValue()}\n\nРучное дополнение к отчёту.`;
        await editor.fill(edited);
        await page.getByRole('button', { name: 'Скопировать', exact: true }).click();
        await page.getByText('Текст скопирован. Отчёт ещё не отправлен.').waitFor();
        assert.equal(await page.evaluate(() => globalThis.__hisobotCopiedText), edited);
        const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(pageWidth <= width + 1, `page overflow ${theme}/${width}: ${pageWidth}`);
        await page.screenshot({ path: path.join(output, `${theme}-${width}-editor.png`) });
        assert(await page.getByRole('button', { name: 'Отправить отчёт', exact: true }).isEnabled());
        await page.getByRole('button', { name: 'Отправить отчёт', exact: true }).click();
        await page.getByText('Отчёт принят. Напоминания в Telegram и Workspace прекращены.').waitFor();
        assert.equal(await page.locator('#hisobot-report-text').inputValue(), edited);
        await page.close();
        console.log(`PASS ${theme} ${width}x${height}: nonmodal notice, dismissal/reload, edit/copy/handoff, explicit submission, bounds`);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
