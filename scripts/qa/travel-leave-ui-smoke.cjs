// Runs real renderer components against synthetic, intercepted data only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdirSync } = require('node:fs');
const assert = require('node:assert/strict');
const output = 'tmp/travel-leave-audit/ui';
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:5176/qa/travel-leave-launch.html';

(async () => {
  mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const devtools = await page.context().newCDPSession(page);
  // Emulate browser zoom reflow (including portals), not CSS zoom, whose vw/vh
  // layout differs from Ctrl+Plus and can place fixed dialogs outside the screen.
  const viewport = async (width, height, scale = 1) => {
    const size = { width: Math.round(width / scale), height: Math.round(height / scale) };
    await page.setViewportSize(size);
    await devtools.send('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: scale, mobile: false });
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // The fixture itself blocks APIs; also prevent accidental external network access.
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort();
  });
  try {
    for (const [name, width, height, extra] of [
      ['desktop', 1440, 1000, ''], ['compact', 1024, 768, ''],
      ['mobile', 390, 844, ''], ['zoom', 1440, 1000, '&zoom'], ['dark', 1440, 1000, '&dark'],
    ]) {
      await viewport(width, height, name === 'zoom' ? 2 : 1);
      await page.goto(`${base}?mode=leaves${extra}`);
      await page.getByRole('heading', { name: 'Проверка кадровой службы' }).waitFor();
      await page.getByRole('textbox', { name: 'Номер приказа (без «-сон а/ф»)' }).fill('QA-10');
      const approve = page.getByRole('button', { name: 'Передать первому заместителю' });
      await approve.scrollIntoViewIfNeeded();
      assert(await approve.isVisible(), `${name}: HR footer unreachable`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: page overflow`);
      await page.screenshot({ path: `${output}/leaves-hr-${name}.png`, fullPage: true });
      await page.getByRole('button', { name: 'Исправить заявление' }).click();
      const text = page.getByRole('textbox', { name: 'Текст заявления' });
      assert((await text.inputValue()).includes('меҳнат'), `${name}: lost application text`);
      await text.fill('Синтетическая правка заявления для проверки ошибки');
      await page.getByRole('button', { name: 'Предпросмотр текста' }).click();
      assert(await page.getByRole('region', { name: 'Предпросмотр заявления' }).isVisible());
      await page.getByRole('button', { name: 'Сохранить исправления кадровика' }).click();
      await page.getByRole('alert').filter({ hasText: 'сохранение отключено' }).waitFor();
      assert((await text.inputValue()).includes('Синтетическая правка'), `${name}: lost text after failure`);
      console.log(`leaves ${name}: HR/footer/edit/preview/error preserve passed`);
    }
    await viewport(1440, 1000);
    await page.goto(`${base}?mode=team`);
    const workload = page.getByRole('region', { name: 'Нагрузка сотрудников' });
    await workload.waitFor();
    const bounds = await workload.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
    assert(bounds.height <= 330 && bounds.scroll > bounds.height, JSON.stringify(bounds));
    await workload.focus();
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('.team-dash-people').scrollTop > 0);
    await page.screenshot({ path: `${output}/team-workload.png`, fullPage: true });
    console.log('workload: internal scroll/keyboard passed');
    await page.goto(`${base}?mode=trips`);
    await page.getByRole('button', { name: 'Новая командировка' }).click();
    await page.getByRole('textbox', { name: 'Основание и мероприятие' }).fill('Hamkorlar bilan loyiha natijalarini muhokama qilish');
    await page.getByText('Посмотреть пример билдирги', { exact: true }).click();
    await page.getByRole('region', { name: 'Пример билдирги на поездку' }).waitFor();
    await page.screenshot({ path: `${output}/trip-composer.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Интерактивная карта поездок' }).click();
    await page.getByRole('button', { name: /К поездкам/ }).waitFor();
    await page.screenshot({ path: `${output}/trip-map.png`, fullPage: true });
    console.log('trips: composer/example/map passed');
    for (const [name, width, height, extra] of [
      ['compact', 1024, 768, ''], ['zoom', 1440, 1000, '&zoom'], ['dark', 1440, 1000, '&dark'],
    ]) {
      await viewport(width, height, name === 'zoom' ? 2 : 1);
      await page.goto(`${base}?mode=hr${extra}`);
      await page.getByRole('button', { name: 'Кадровая карточка', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Кадровая карточка' });
      await dialog.getByRole('button', { name: 'Сотрудник кадровой карточки' }).click();
      await page.getByRole('button', { name: /Тестовый Сотрудник 1 бош мутахассис/, exact: true }).click();
      const date = dialog.getByLabel('Дата приёма', { exact: true });
      assert.equal(await date.inputValue(), '', 'Do not invent employment date');
      await date.fill('2019-03-01');
      await dialog.getByPlaceholder('Например: подтверждено трудовой книжкой').fill('Синтетический приказ');
      const save = dialog.getByRole('button', { name: 'Сохранить карточку' });
      await save.scrollIntoViewIfNeeded();
      assert(await save.isEnabled(), `${name}: linked profile cannot be saved`);
      await save.click();
      await dialog.getByRole('alert').filter({ hasText: 'сохранение отключено' }).waitFor();
      assert.equal(await date.inputValue(), '2019-03-01', 'HR date lost after error');
      await page.screenshot({ path: `${output}/hr-profile-${name}.png`, fullPage: true });
      await page.keyboard.press('Escape');
      assert(await dialog.count() === 0);
      console.log(`HR ${name}: employee/date/footer/error preserve passed`);
    }
    assert.deepEqual(errors, [], 'browser exceptions');
  } catch (error) {
    console.error('Browser errors:', errors);
    console.error((await page.locator('body').innerText()).slice(0, 3000));
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
