// Deep/scroll/hover/popup audit, complementing all-page and mobile regressions.
const {chromium,webkit}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {inspect}=require('./dark-theme-smoke.cjs');
const output=path.resolve('tmp/dark-theme/depth');fs.mkdirSync(output,{recursive:true});const report=[];
(async()=>{
  for(const engine of (process.env.QA_ENGINE?[process.env.QA_ENGINE]:['edge','webkit'])){
    const browser=await(engine==='edge'?chromium.launch({channel:'msedge',headless:true}):webkit.launch({headless:true}));
    try{
      for(const [width,height,touch] of [[1440,900,false],[390,844,true],[720,450,false]]){
        if(process.env.QA_WIDTH&&width!==Number(process.env.QA_WIDTH))continue;
        const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
        await context.route('**/api/**',r=>{throw new Error('API escaped fixture '+r.request().url());});
        const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
        const shot=async(name)=>{await page.waitForTimeout(180);name=`${engine}-${width}-${name}`;await page.screenshot({path:path.join(output,name+'.png')});const audit=await inspect(page,name);assert.equal(audit.theme,'dark');assert.equal(audit.overflow,false,name+' X overflow');report.push(audit);fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(name);};
        await page.goto('http://127.0.0.1:5173/qa/mobile-secondary.html?theme=dark&recognition&thinking');
        for(const section of ['home','team','surveys','legacy-projects','hr','members','notifications']){
          await page.getByLabel('QA раздел').selectOption(section);
          if(section==='surveys')await page.getByRole('button',{name:/Тестовый опрос команды/}).click();
          await shot(section+'-top');
          if(section==='team'){
            await page.locator('.team-dash-flow-legend .flow-overdue').click();await shot('team-drawer');
            const row=page.locator('.team-dash-drawer-list > button').first();
            if(await row.count()){await row.locator('strong').first().click();await shot('team-drawer-detail');}
            await page.getByRole('button',{name:'Закрыть список задач',exact:true}).click();
          }
          const scrolls=page.locator('.app-content *');
          const indices=await scrolls.evaluateAll(elements=>elements.flatMap((el,i)=>{const box=el.getBoundingClientRect();return el.scrollHeight>el.clientHeight+80&&box.width>180&&box.height>180&&['auto','scroll'].includes(getComputedStyle(el).overflowY)?[i]:[];}));
          for(const [number,index]of indices.slice(0,3).entries()){
            await scrolls.nth(index).evaluate(el=>{el.scrollTop=el.scrollHeight;});await shot(section+'-bottom-'+number);
          }
        }
        await page.getByRole('button',{name:'Профиль',exact:true}).click();await page.locator('.employee-profile-dialog').waitFor();
        await page.getByRole('button',{name:'Достижения',exact:true}).click();await shot('achievements');
        for(const tier of ['bronze','silver','gold','platinum','sapphire','amethyst','prism','cosmic']){
          const card=page.locator('.achievement-card.recognition-rarity-'+tier).first();await card.scrollIntoViewIfNeeded();
          if(!touch)await card.hover();await shot('achievement-'+tier);
        }
        await page.locator('.achievement-card.is-locked').first().scrollIntoViewIfNeeded();await shot('achievement-locked');
        await page.getByRole('button',{name:'Награды',exact:true}).click();await shot('rewards');
        const reward=page.locator('.employee-reward-card').first();await reward.scrollIntoViewIfNeeded();if(!touch)await reward.hover();await shot('reward-hover');
        await reward.click();await shot('reward-history');await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Как это работает',exact:true}).click();await shot('recognition-guide');await page.keyboard.press('Escape');await page.getByRole('button',{name:'Закрыть профиль',exact:true}).click();
        await page.getByRole('button',{name:/Открыть.*ассистент/i}).click();await page.locator('.assistant-panel').waitFor();
        const editor=page.getByLabel('Сообщение ассистенту');await editor.fill('Тестовый вопрос для состояния обработки');await page.getByRole('button',{name:'Отправить сообщение',exact:true}).click();await shot('assistant-thinking');await page.waitForTimeout(1600);await shot('assistant-error');await page.keyboard.press('Escape');
        await page.goto('http://127.0.0.1:5173/qa/mobile-workflows.html?theme=dark&workflow');await page.getByRole('button',{name:'Оплаты',exact:true}).click();
        await page.getByRole('button',{name:'Конструктор маршрутов',exact:true}).click();await page.locator('.react-flow').waitFor();await shot('workflow');
        // A node's centre can be clipped in a narrow React Flow viewport. Use
        // its visible heading after fitting, rather than forcing a hidden click.
        if(width<1024)await page.locator('.react-flow__controls-fitview').click();
        await page.waitForTimeout(350);
        const canvas=page.locator('.react-flow');await canvas.scrollIntoViewIfNeeded();
        const heading=page.locator('.workflow-node .workflow-object-node > strong').first();
        const area=await canvas.boundingBox(),node=await heading.boundingBox();
        if(node.x<area.x+10||node.x+node.width>area.x+area.width-10||node.y<area.y+10||node.y+node.height>area.y+area.height-10){
          const start=await canvas.evaluate(el=>{const box=el.getBoundingClientRect();for(let y=Math.max(box.top+80,20);y<Math.min(innerHeight-30,box.bottom-30);y+=35)for(let x=box.left+20;x<box.right-20;x+=35){const hit=document.elementFromPoint(x,y);if(hit?.classList.contains('react-flow__pane'))return{x,y};}return null;});
          assert(start,'No visible blank canvas available for panning');
          const {x,y}=start;
          await page.mouse.move(x,y);await page.mouse.down();
          await page.mouse.move(x+area.x+area.width/2-node.x-node.width/2,y+area.y+area.height/2-node.y-node.height/2,{steps:12});await page.mouse.up();
        }
        await heading.click();await shot('workflow-inspector');
        assert.deepEqual(errors,[]);await context.close();
      }
    }finally{await browser.close();}
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
