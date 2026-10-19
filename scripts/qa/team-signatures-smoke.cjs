// Real renderer, only synthetic responses; no production traffic or writes.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const output = 'tmp/team-signatures-qa';
mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let fail = false;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/api/v1/')) {
      assert.equal(route.request().method(), 'GET');
      if (url.pathname.endsWith('/signature-inbox')) {
        if (fail) return route.fulfill({ status: 503, json: { detail: 'Тестовая ошибка загрузки' } });
        const offset = Number(url.searchParams.get('offset'));
        return route.fulfill({ json: { totalCount: 25, pendingReviewCount: 25, readyCount: 0, sentCount: 0, signedCount: 0,
          letters: Array.from({ length: offset ? 5 : 20 }, (_, i) => ({ id: `qa-${offset + i}`, subject: `Письмо партнёрам · ${offset + i + 1}`, recipientOrganization: 'Тестовая организация', createdByName: 'Каримова Азиза Баходировна', workflowKind: i % 2 ? 'sign_only' : 'delivery' })),
        } });
      }
      return route.fulfill({ status: 503, json: { detail: 'Изолированная проверка: другие данные отключены' } });
    }
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  try {
    for (const [name, width, height, scale] of [
      ['desktop', 1640, 1000, 1], ['compact', 1024, 768, 1], ['mobile', 390, 844, 1],
      ['zoom200', 1440, 1000, 2], ['dark', 1440, 1000, 1], ['forced', 1024, 768, 1],
    ]) {
      await page.setViewportSize({ width: Math.floor(width / scale), height: Math.floor(height / scale) });
      await page.emulateMedia({ forcedColors: name === 'forced' ? 'active' : 'none', reducedMotion: 'reduce' });
      await page.goto(`http://127.0.0.1:5187/qa/team-signatures.html${name === 'dark' ? '?dark' : ''}`);
      const tile = page.getByRole('button', { name: /Письма на подпись.*25/ });
      await tile.waitFor();
      assert.equal(await page.locator('.team-dash-metric').count(), 6);
      await tile.focus(); await page.keyboard.press('Enter');
      const list = page.getByRole('region', { name: 'Список писем на подпись' });
      const geometry = await list.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
      assert(geometry.height <= 330 && geometry.scroll > geometry.height);
      await list.focus(); await page.keyboard.press('End');
      await page.waitForFunction(() => document.querySelector('.team-dash-signature-list').scrollTop > 0);
      await page.getByRole('button', { name: 'Далее', exact: true }).click();
      await page.getByRole('button', { name: /Письмо партнёрам · 21 / }).click();
      assert.equal(await page.getByLabel('Выбранное письмо').textContent(), 'qa-20');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await tile.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
      console.log(`${name}: six metrics, keyboard, scrolling, paging and selection passed`);
    }
    fail = true;
    await page.reload();
    await page.getByRole('button', { name: /Письма на подпись.*не удалось загрузить/ }).click();
    await page.getByText('Тестовая ошибка загрузки', { exact: true }).waitFor();
    fail = false;
    await page.getByRole('button', { name: 'Повторить загрузку писем' }).click();
    await page.getByRole('button', { name: /Письма на подпись.*25/ }).waitFor();
    assert.deepEqual(errors, []);
    console.log('error/retry passed; no browser exceptions');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
