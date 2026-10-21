const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const output = path.resolve('tmp/hisobot-activity-draft');
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
        await page.goto(`http://127.0.0.1:5178/qa/hisobot-activity-draft.html?theme=${theme}`);
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await page.evaluate(() => document.fonts.ready);
        // Presence is opacity-animated; inspect the settled surface, not a fade-in frame.
        await page.waitForTimeout(350);
        const box = await dialog.boundingBox();
        assert(box.x >= 0 && box.x + box.width <= width + 1, `dialog horizontal bounds ${theme}/${width}`);
        assert(box.y >= 0 && box.y + box.height <= height + 1, `dialog vertical bounds ${theme}/${width}`);
        await page.screenshot({ path: path.join(output, `${theme}-${width}-prompt.png`) });
        const input = page.getByRole('textbox', { name: 'Готовый текст — можно редактировать сразу' });
        const edited = `${await input.inputValue()}\n\nРучное дополнение к отчёту.`;
        await input.fill(edited);
        await page.getByRole('button', { name: 'Скопировать', exact: true }).click();
        await page.getByText('Текст скопирован. Отчёт ещё не отправлен.').waitFor();
        assert.equal(await page.evaluate(() => globalThis.__hisobotCopiedText), edited);
        await page.getByRole('button', { name: 'Открыть в AI Hisobot' }).click();
        const editor = page.getByRole('textbox', { name: 'Опишите выполненные задачи одним текстовым сообщением:' });
        await editor.waitFor();
        await page.waitForFunction(expected => document.querySelector('#hisobot-report-text')?.value === expected, edited);
        const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
        assert(pageWidth <= width + 1, `page overflow ${theme}/${width}: ${pageWidth}`);
        await page.screenshot({ path: path.join(output, `${theme}-${width}-editor.png`) });
        assert(await page.getByRole('button', { name: 'Отправить отчёт', exact: true }).isEnabled());
        await page.getByRole('button', { name: 'Отправить отчёт', exact: true }).click();
        await page.getByText('Отчёт принят. Напоминания в Telegram и Workspace прекращены.').waitFor();
        assert.equal(await page.locator('#hisobot-report-text').inputValue(), edited);
        await page.close();
        console.log(`PASS ${theme} ${width}x${height}: automatic prompt, edit/copy/handoff, explicit submission, bounds`);
      }
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
