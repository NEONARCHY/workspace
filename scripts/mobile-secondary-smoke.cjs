// Real remaining screens. Synthetic data; all API writes are intercepted.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve(process.env.QA_THEME === 'dark' ? 'tmp/dark-theme/secondary' : 'tmp/mobile-secondary');
const { inspect } = require('./dark-theme-smoke.cjs');
const audits = [];
fs.mkdirSync(output, { recursive: true });
const cases = [[320,700,true],[390,844,true],[768,1024,true],[1024,768,true],[1180,820,true],[1440,900,false]];
const report = [];
(async () => {
  for (const engine of ['edge', 'webkit']) {
    const browser = await (engine === 'edge' ? chromium.launch({ channel: 'msedge', headless: true }) : webkit.launch({ headless: true }));
    try {
      for (const [width,height,touch] of cases) {
        if (process.env.QA_WIDTH && width !== Number(process.env.QA_WIDTH)) continue;
        const context = await browser.newContext({ viewport: { width,height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
        await context.addInitScript(() => {
          const viewport = new EventTarget();
          Object.assign(viewport, { offsetTop: 0, scale: 1, shortHeight: null });
          Object.defineProperty(viewport, 'height', { get: () => viewport.shortHeight ?? innerHeight });
          Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
        });
        await context.route('**/api/**', route => { throw new Error('API escaped QA fixture: ' + route.request().url()); });
        const page = await context.newPage(), errors = [];
        page.setDefaultTimeout(15000);
        page.on('pageerror', e => { errors.push(e.message); console.error('page error: '+e.message); });
        const shot = async suffix => {
          const name = engine + '-' + width + '-' + suffix;
          await page.screenshot({ path: path.join(output, name + '.png') });
          if (process.env.QA_THEME === 'dark') {
            audits.push(await inspect(page, name));
            fs.writeFileSync(path.join(output, 'visual-audit.json'), JSON.stringify(audits, null, 2));
          }
        };
        const bounds = async selector => {
          const box = await page.locator(selector).first().boundingBox();
          assert(box && box.x >= -1 && box.x + box.width <= width + 1, selector + ' X bounds ' + JSON.stringify(box));
          return box;
        };
        const overflow = async () => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'document X overflow');
        const choose = async value => { await page.getByLabel('QA раздел').selectOption(value); await page.waitForTimeout(200); };
        const compact = width <= 1023 || touch && width <= 1366;
        const form = async (surface, footer, input) => {
          await input.fill('Тестовый черновик с сохранением при повороте');
          await bounds(surface);
          if (touch) assert.equal(await input.evaluate(el => getComputedStyle(el).fontSize), '16px');
          if (compact) {
            await page.evaluate(() => { visualViewport.shortHeight = 420; visualViewport.offsetTop = 60; visualViewport.dispatchEvent(new Event('resize')); });
            await page.waitForFunction(() => document.documentElement.style.getPropertyValue('--ws-browser-height') === '420px');
            const box = await bounds(surface);
            assert(box.y >= 59 && box.y + box.height <= 481, surface + ' keyboard bounds ' + JSON.stringify(box));
            await page.locator(footer).scrollIntoViewIfNeeded();
            const foot = await bounds(footer);
            assert(foot.y >= 59 && foot.y + foot.height <= 481, footer + ' footer bounds ' + JSON.stringify(foot));
          }
          await page.setViewportSize({ width: height, height: width });
          assert.equal(await input.inputValue(), 'Тестовый черновик с сохранением при повороте');
          await page.setViewportSize({ width,height });
          await page.evaluate(() => { visualViewport.shortHeight = null; visualViewport.offsetTop = 0; visualViewport.dispatchEvent(new Event('resize')); });
          await page.waitForTimeout(100);
        };
        await page.goto('http://127.0.0.1:5173/qa/mobile-secondary.html' + (process.env.QA_THEME === 'dark' ? '?theme=dark' : ''));
        await page.getByRole('heading', { name: 'Лента', exact: true }).waitFor();
        await overflow(); await bounds('.feed-card');
        if (touch) {
          await page.getByRole('button', { name: 'Кто поставил реакцию 👍' }).first().click();
          await page.getByRole('dialog', { name: 'Кто поставил реакцию' }).waitFor();
          await bounds('.message-context-menu'); await page.keyboard.press('Escape');
        }
        await page.getByRole('button', { name: 'Новое объявление', exact: true }).click();
        const title = page.getByLabel('Заголовок публикации');
        await form('.feed-composer-dialog', '.feed-composer-dialog .fui-DialogActions', title);
        await page.getByLabel('Текст публикации').fill('Тестовый текст публикации');
        await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
        await page.locator('.feed-composer-dialog [role=alert]').waitFor();
        assert.equal(await title.inputValue(), 'Тестовый черновик с сохранением при повороте');
        await shot('feed-form'); await page.keyboard.press('Escape');
        await page.locator('.feed-composer-dialog').waitFor({state:'detached'});
        const dimensions = [];
        for (const [section, selector] of [['notifications','.notifications-view'],['hr','.hr-view'],['members','.members-view'],['zoom','.zoom-view'],['absences','.absences-view'],['referent','.ai-referent-view'],['hisobot','.ai-hisobot-view'],['bots','.telegram-access-view'],['incoming','.edo-incoming'],['employees','.employees-view'],['tasks','.tasks-view']]) {
          await choose(section); await page.locator(selector).waitFor(); await overflow();
          const box = await bounds(selector); dimensions.push({section,left:box.x,right:box.x+box.width});
          await shot(section);
          if (section === 'hr') {
            await page.getByRole('button', { name: 'Добавить сотрудника', exact:true }).click();
            await form('.hr-editor', '.hr-editor footer', page.getByPlaceholder('Фамилия Имя Отчество'));
            await page.getByPlaceholder('Например: подтверждено трудовой книжкой').fill('Тестовый документ');
            await page.getByRole('button', { name:'Сохранить карточку',exact:true }).click();
            await page.locator('.hr-editor [role=alert]').waitFor();
            assert.equal(await page.getByPlaceholder('Фамилия Имя Отчество').inputValue(),'Тестовый черновик с сохранением при повороте');
            await page.keyboard.press('Escape'); await page.locator('.hr-editor').waitFor({state:'detached'});
            await page.getByRole('tab',{name:'Приём на работу',exact:true}).click();
            await page.locator('.hr-hiring-layout > aside > button').first().click();
            const fullName=page.getByRole('textbox',{name:'Фамилия, имя и отчество',exact:true});
            try { await fullName.fill('Тестовое имя с сохранением черновика'); } catch(error) {
              console.error(await page.locator('.hr-hiring').ariaSnapshot());
              console.error(await page.evaluate(()=>[...document.querySelectorAll('[inert]')].map(el=>el.className)));
              await shot('hiring-failure'); throw error;
            }
            await bounds('.hr-hiring-detail');
            await page.getByRole('button',{name:'Сохранить черновик',exact:true}).click();
            await page.locator('.hr-hiring [role=alert]').waitFor();
            assert.equal(await fullName.inputValue(),'Тестовое имя с сохранением черновика');
          }
          if (section === 'members') {
            const table = page.getByRole('table', {name:'Члены организации'});
            assert.equal(await table.getByRole('row').count(), 26);
            if (width <= 700) assert.equal(await table.locator('.record-mobile-label').first().evaluate(el => getComputedStyle(el).display),'block');
            await page.getByLabel('Поиск членов').fill('Тестовый член');
            assert.equal(await table.getByRole('row').count(),26);
          }
          if (section === 'hisobot') {
            const report=page.getByLabel('Опишите выполненные задачи одним текстовым сообщением:');
            await report.fill('Тестовый отчёт без потери данных');
            await page.getByRole('button',{name:'Отправить отчёт',exact:true}).click();
            await page.locator('.hisobot-error').waitFor();
            assert.equal(await report.inputValue(),'Тестовый отчёт без потери данных');
            await page.getByRole('button',{name:'Правила AI Hisobot'}).click();
            await bounds('.hisobot-help'); await page.keyboard.press('Escape');
          }
          if (section === 'absences') {
            await page.getByRole('button',{name:'Сообщить об отсутствии',exact:true}).click();
            const reason=page.getByRole('textbox',{name:'Причина',exact:true});
            await form('.absence-form-dialog','.absence-form-dialog .fui-DialogActions',reason);
            await page.getByRole('button',{name:'Отправить руководителю',exact:true}).click();
            await page.locator('.absence-form-dialog [role=alert]').waitFor();
            assert.equal(await reason.inputValue(),'Тестовый черновик с сохранением при повороте');
            await page.keyboard.press('Escape');await page.locator('.absence-form-dialog').waitFor({state:'detached'});
          }
          if (section === 'referent') {
            await page.getByRole('button',{name:'Новое письмо',exact:true}).click();
            await form('.ai-referent-form-dialog','.ai-referent-form-dialog .fui-DialogActions',page.getByPlaceholder('Если пропустить — исходящий номер'));
            await page.keyboard.press('Escape');await page.locator('.ai-referent-form-dialog').waitFor({state:'detached'});
          }
          if(section==='bots'){
            const banner=await bounds('.telegram-access-header');
            if(width===320) assert(banner.height<320,'banner must not reserve a 320px vertical flex basis');
            const row=page.locator('.telegram-access-row').first();
            await row.getByLabel('Telegram ID',{exact:true}).fill('123456789');
            await row.getByRole('button',{name:'Сохранить',exact:true}).click();
            await row.getByRole('alert').waitFor();
            assert.equal(await row.getByLabel('Telegram ID',{exact:true}).inputValue(),'123456789');
          }
          if (section === 'incoming') {
            await page.getByRole('button',{name:/EX-17/}).first().click();
            await page.getByRole('heading',{name:'Краткая информация'}).waitFor();
            await bounds('.edo-incoming-detail');
          }
          if(section==='employees'){
            await page.locator('.employee-record-manage').nth(1).click();
            await bounds('.directory-record-dialog');
            await page.getByRole('button',{name:'Закрыть карточку сотрудника',exact:true}).click();
            await page.locator('.directory-record-dialog').waitFor({state:'detached'});
          }
          if(section==='tasks'){
            await page.locator('.tasks-view .record-open').first().click();
            await bounds('.task-record-dialog');
            await page.getByRole('button',{name:'Закрыть задачу',exact:true}).click();
            await page.locator('.task-record-dialog').waitFor({state:'detached'});
          }
        }
        if (compact) for (const edge of dimensions) assert(Math.abs(edge.left - dimensions[0].left) <= 1 && Math.abs(edge.right - dimensions[0].right) <= 1,'root width differs ' + JSON.stringify(dimensions));
        await page.getByRole('button',{name:'Настройки',exact:true}).click();
        await bounds('.account-panel');
        const accountSection=async name=>{
          const compactNav=page.locator('.account-compact-navigation .fui-Dropdown__button');
          if(await compactNav.isVisible()){await compactNav.click();await page.getByRole('option',{name,exact:true}).click();}
          else await page.getByRole('navigation',{name:'Разделы настроек'}).getByRole('button',{name,exact:true}).click();
        };
        for(const name of ['Личные данные','Оформление','Звук','Защита и пароль','Устройства','Приглашения','Пароли сотрудников','Восстановление доступа','Обновления']){
          await accountSection(name);await bounds('.account-settings-content');await overflow();
        }
        await accountSection('Приглашения');
        const invite=page.getByRole('textbox',{name:'Имя сотрудника',exact:true});
        await invite.fill('Тестовый сотрудник');
        await page.getByRole('textbox',{name:'Логин',exact:true}).fill('qa-new-user');
        await page.getByRole('button',{name:'Создать приглашение',exact:true}).click();
        await page.locator('.account-settings-feedback').waitFor();
        assert.equal(await invite.inputValue(),'Тестовый сотрудник');
        await page.keyboard.press('Escape'); await page.locator('.account-panel').waitFor({state:'detached'});
        await page.locator('.app-stage > header').getByRole('button',{name:'Меню сотрудника',exact:true}).click();
        await page.locator('.sidebar-visibility-list').waitFor();
        await bounds('.sidebar-visibility-dialog');
        await page.locator('.sidebar-visibility-list input').first().uncheck();
        await page.getByRole('button',{name:'Сохранить меню',exact:true}).click();
        await page.locator('.sidebar-visibility-error').waitFor();
        assert.equal(await page.locator('.sidebar-visibility-list input').first().isChecked(),false);
        await page.keyboard.press('Escape');await page.locator('.sidebar-visibility-dialog').waitFor({state:'detached'});
        await page.getByRole('button',{name:'Поддержка QA',exact:true}).click();
        await bounds('.support-dialog');
        await page.keyboard.press('Escape');await page.locator('.support-dialog').waitFor({state:'detached'});
        await page.getByRole('button',{name:'Файл QA',exact:true}).click();
        await bounds('.file-viewer-surface');
        await page.keyboard.press('Escape');await page.locator('.file-viewer-surface').waitFor({state:'detached'});
        await page.getByRole('button',{name:'Профиль',exact:true}).click();
        await page.getByRole('heading',{name:/Азиза Каримова/}).waitFor();
        await bounds('.employee-profile-dialog'); await overflow(); await shot('profile');
        await page.getByRole('button',{name:'Моя эффективность',exact:true}).click();
        await page.locator('.personal-efficiency').waitFor(); await bounds('.personal-efficiency'); await overflow();
        await shot('efficiency'); await page.keyboard.press('Escape');
        await page.locator('.employee-profile-dialog').waitFor({state:'detached'});
        await page.getByRole('button',{name:/Открыть.*ассистент/i}).click();
        await page.locator('.assistant-panel').waitFor();
        await bounds('.assistant-panel');
        const editor=page.getByLabel('Сообщение ассистенту');
        await editor.fill('Тестовый черновик ассистента');
        if(compact) {
          await page.evaluate(() => { visualViewport.shortHeight=420; visualViewport.offsetTop=60; visualViewport.dispatchEvent(new Event('resize')); });
          await page.waitForTimeout(100);
          const box=await bounds('.assistant-panel');
          assert(box.y>=59 && box.y+box.height<=481,'assistant keyboard bounds');
        }
        assert.equal(await editor.inputValue(),'Тестовый черновик ассистента');
        await shot('assistant');
        assert.deepEqual(errors, [], 'page errors');
        report.push({engine,width,height,touch,dimensions});
        console.log(engine+' '+width+'x'+height+' passed');
        await context.close();
      }
    } finally { await browser.close(); }
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
})().catch(error=> { console.error(error);process.exitCode=1; });
