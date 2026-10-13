const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inspect } = require('./dark-theme-smoke.cjs');
const output = path.resolve('tmp/dark-theme/details'); fs.mkdirSync(output, { recursive: true });
const report = [];
(async () => {
  for (const engine of ['edge', 'webkit']) {
    const browser = await (engine === 'edge' ? chromium.launch({ channel: 'msedge', headless: true }) : webkit.launch({ headless: true }));
    try {
      for (const [width,height,touch] of [[1440,900,false],[390,844,true],[768,1024,true]]) {
        const context = await browser.newContext({ viewport: {width,height}, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
        await context.route('**/api/**', route => { throw new Error('Unexpected production request ' + route.request().url()); });
        const page = await context.newPage(), errors=[]; page.on('pageerror', error => errors.push(error.message));
        const shot = async suffix => {
          await page.waitForTimeout(150);
          const name=`${engine}-${width}-${suffix}`;
          await page.screenshot({path:path.join(output,name+'.png')});
          report.push(await inspect(page,name));
          fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
          console.log(name);
        };
        await page.goto('http://127.0.0.1:5173/qa/mobile-secondary.html?theme=dark');
        for(const section of ['home','team','departments','access','login','components']) {
          await page.getByLabel('QA раздел').selectOption(section); await shot(section);
        }
        await page.getByRole('button',{name:'Основное действие',exact:true}).hover(); await shot('button-hover');
        const disabled=page.getByRole('button',{name:'Недоступное действие',exact:true});
        const before=await disabled.evaluate(el=>getComputedStyle(el).boxShadow); await disabled.hover();
        assert.equal(await disabled.evaluate(el=>getComputedStyle(el).boxShadow),before);
        const draft=page.getByRole('textbox',{name:'Черновик QA',exact:true}); await draft.fill('Несохранённый черновик после смены темы');
        const original=await draft.elementHandle();
        for(const label of ['Светлая','Тёмная']) {
          await page.getByRole('button',{name:new RegExp(label)}).click();
          await page.waitForFunction(expected=>document.documentElement.dataset.colorTheme===expected,label==='Тёмная'?'dark':'light');
          assert.equal(await draft.inputValue(),'Несохранённый черновик после смены темы');
          assert(await draft.evaluate((el,old)=>el===old,original));
        }
        if(engine==='edge' && width===1440) {
          await page.emulateMedia({reducedMotion:'no-preference'});
          await page.getByRole('button',{name:/Светлая/}).click();
          await page.waitForTimeout(65); const during=await page.evaluate(()=>Number(getComputedStyle(document.body).opacity));
          assert(during<.99 && during>=0,'fade-out was not observed'); await page.screenshot({path:path.join(output,'fade-out.png')});
          await page.waitForTimeout(350); await page.getByRole('button',{name:/Тёмная/}).click();
          await page.waitForTimeout(165); await page.screenshot({path:path.join(output,'fade-in.png')});
          await page.waitForTimeout(300);
          assert.equal(await page.evaluate(()=>getComputedStyle(document.body).opacity),'1');
          await page.getByRole('button',{name:/Светлая/}).click(); await page.waitForTimeout(35); await page.getByRole('button',{name:/Тёмная/}).click();
          await page.waitForTimeout(400); assert.equal(await page.evaluate(()=>document.documentElement.dataset.colorTheme),'dark');
          await page.emulateMedia({reducedMotion:'reduce'});
          await page.emulateMedia({reducedMotion:'no-preference'});
          await page.getByRole('button',{name:/Светлая/}).click(); await page.waitForTimeout(35);
          await page.emulateMedia({reducedMotion:'reduce'});
          await page.waitForFunction(()=>document.documentElement.dataset.colorTheme==='light');
          assert.equal(await page.evaluate(()=>getComputedStyle(document.body).opacity),'1','mid-fade reduced motion left the page invisible');
          await page.getByRole('button',{name:/Тёмная/}).click();
          await page.getByRole('button',{name:/Как в системе/}).click();
          await page.emulateMedia({colorScheme:'light'}); await page.waitForFunction(()=>document.documentElement.dataset.colorTheme==='light');
          await page.emulateMedia({colorScheme:'dark'}); await page.waitForFunction(()=>document.documentElement.dataset.colorTheme==='dark');
          await page.getByRole('button',{name:/Тёмная/}).click();
        }
        for(const name of ['Меню QA','Popover QA','Диалог QA']) {
          await page.getByRole('button',{name,exact:true}).click(); await shot(name);
          if(name==='Диалог QA') { await page.keyboard.press('Escape'); } else await page.keyboard.press('Escape');
        }
        await page.getByRole('button',{name:'Подсказка QA',exact:true}).hover(); await page.getByRole('tooltip').waitFor(); await shot('tooltip'); await page.mouse.move(0,0);
        await page.getByRole('combobox',{name:'Приоритет QA',exact:true}).click(); await shot('priority-options'); await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Дата QA: открыть выбор',exact:true}).click(); await shot('date-time'); await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Ответственный QA',exact:true}).click(); await shot('people-picker'); await page.keyboard.press('Escape');
        const zone=page.locator('.ws-file-dropzone'); await zone.scrollIntoViewIfNeeded();
        const data=await page.evaluateHandle(()=>{const transfer=new DataTransfer(); transfer.items.add(new File(['QA'],'qa.txt',{type:'text/plain'}));
          // Windows WebKit's programmatic transfer omits types, unlike a native file drag.
          if (!Array.from(transfer.types).includes('Files')) Object.defineProperty(transfer,'types',{value:['Files']});
          return transfer;});
        await zone.dispatchEvent('dragover',{dataTransfer:data}); await page.locator('.ws-file-dropzone.is-dragging').waitFor(); await shot('file-dragover');
        await zone.dispatchEvent('drop',{dataTransfer:data}); await page.getByText('qa.txt',{exact:true}).waitFor(); await shot('file-selected');
        if(!touch) {
          const grip=page.getByRole('button',{name:'Перенести: Тестовая карточка',exact:true});
          await page.locator('.qa-theme-components').evaluate(el=>{el.scrollTop=el.scrollHeight;});
          await page.locator('[data-spatial-lane="start"]').scrollIntoViewIfNeeded();
          await grip.focus(); await page.keyboard.press('Space'); await page.locator('.spatial-drag-preview').waitFor(); await shot('drag-lift');
          await page.keyboard.press('ArrowRight'); await shot('drag-eligible'); await page.keyboard.press('Space');
          await page.locator('.spatial-drag-preview').waitFor({state:'detached'});
          assert.equal(await page.locator('[data-spatial-lane="start"] .spatial-card').count(),1); await shot('drop-rejected');
        }
        await page.emulateMedia({forcedColors:'active'}); await page.getByRole('button',{name:'Меню QA',exact:true}).scrollIntoViewIfNeeded(); await shot('forced-colors');
        await page.emulateMedia({forcedColors:'none'});
        assert.deepEqual(errors,[],'renderer errors'); await context.close();
      }
    } finally { await browser.close(); }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
