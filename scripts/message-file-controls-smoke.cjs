const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
let browser;
(async () => {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const dir = 'tmp/message-file-controls-qa'; fs.mkdirSync(dir, { recursive: true });
  const report = [];
  for (const theme of ['light', 'dark']) {
    const url = part => `http://127.0.0.1:5178/qa/detail-layout.html?view=controls&part=${part}&theme=${theme}`;
    await page.goto(url('send'));
    await page.getByRole('textbox', { name: 'Подпись к вложениям' }).waitFor();
    await page.waitForFunction(() => document.activeElement?.id === 'attachment-message-caption');
    await page.keyboard.press('Enter');
    await page.locator('output[data-sent="1"][data-closed="false"]').waitFor();
    await page.keyboard.type('Первая'); await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Вторая');
    assert.equal(await page.getByRole('textbox', { name: 'Подпись к вложениям' }).inputValue(), 'Первая\nВторая');
    await page.keyboard.press('Control+Enter');
    await page.locator('output[data-sent="2"]').waitFor();
    await page.screenshot({ path: `${dir}/${theme}-send.png` });
    await page.getByRole('button', { name: 'Закрыть отправку вложений', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.locator('output[data-closed="true"]').waitFor();
    await page.goto(url('pdf'));
    await page.getByRole('button', { name: 'Увеличить PDF' }).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Увеличить PDF"]').disabled);
    await page.locator('.file-viewer-pdf-page canvas').waitFor();
    await page.waitForTimeout(400);
    const scale = () => page.locator('.file-viewer-pdf-scale').innerText();
    const before = parseInt(await scale());
    await page.getByRole('region', { name: 'Страницы документа' }).hover();
    await page.mouse.wheel(0, 100); assert.equal(parseInt(await scale()), before);
    await page.keyboard.down('Control'); await page.mouse.wheel(0, -100);
    await page.waitForFunction(value => parseInt(document.querySelector('.file-viewer-pdf-scale').textContent) > value, before);
    await page.keyboard.up('Control');
    assert.equal(await page.evaluate(() => window.visualViewport.scale), 1);
    await page.screenshot({ path: `${dir}/${theme}-pdf.png` });
    await page.goto(url('calendar'));
    await page.locator('.calendar-preview-date dd').first().waitFor();
    for (const width of [1366, 1024, 720, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const facts = await page.locator('.calendar-preview-date dd').evaluateAll(nodes => nodes.map(node => {
        const range = document.createRange(); range.selectNodeContents(node);
        return { text: node.textContent, lines: range.getClientRects().length, width: node.clientWidth, scroll: node.scrollWidth };
      }));
      assert.ok(facts.every(fact => fact.lines === 1 && fact.scroll <= fact.width + 1), JSON.stringify({ theme, width, facts }));
      report.push({ theme, width, facts });
    }
    await page.setViewportSize({ width: 1366, height: 900 });
    await page.screenshot({ path: `${dir}/${theme}-calendar.png` });
    await page.goto(url('mention'));
    await page.getByRole('button', { name: /Упомянуть/ }).first().click();
    const picker = page.getByRole('region', { name: 'Упомянуть участников' });
    await picker.waitFor();
    const geometry = await picker.evaluate(node => {
      const buttons = [...node.querySelectorAll('.employee-scope-switch > button')].map(button => ({ height: button.getBoundingClientRect().height, wrap: getComputedStyle(button).whiteSpace, width: button.clientWidth, scroll: button.scrollWidth }));
      const scope = node.querySelector('.employee-scope-switch').getBoundingClientRect();
      const person = node.querySelector('.mention-person')?.getBoundingClientRect();
      return { buttons, gap: person ? person.top - scope.bottom : null };
    });
    assert.ok(geometry.buttons.every(button => button.height <= 30 && button.wrap === 'nowrap' && button.scroll <= button.width), JSON.stringify(geometry));
    assert.ok(geometry.gap >= 8, JSON.stringify(geometry)); report.push({ theme, geometry });
    await page.screenshot({ path: `${dir}/${theme}-mention.png` });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(`${dir}/report.json`, JSON.stringify(report, null, 2));
  await browser.close(); console.log('Message/file controls browser checks passed in both themes (send, wheel zoom, calendar 4 widths, mention spacing).');
})().catch(async error => { console.error(error); await browser?.close(); process.exit(1); });
