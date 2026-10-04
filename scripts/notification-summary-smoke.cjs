// TEST origin only. All business writes are intercepted; fixtures exist only
// in intercepted bootstrap responses and never enter the database.
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const origin='https://192.168.31.176:8443',before=process.argv.includes('--before');
const out=path.resolve('tmp/notification-summary-polish'),pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
  const page=(await(await fetch('http://127.0.0.1:9224/json')).json()).find(p=>p.type==='page'&&p.url.startsWith(origin));
  assert(page,'Open authenticated TEST browser on port 9224');
  const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let id=0,readAll=false,rejectRead=false;const pending=new Map(),errors=[],results=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'));},12000);pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));});
  const fulfill=(requestId,body,status=200)=>send('Fetch.fulfillRequest',{requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(body).toString('base64')});
  ws.onmessage=async e=>{
    const m=JSON.parse(e.data),entry=pending.get(m.id);
    if(entry){pending.delete(m.id);clearTimeout(entry.timer);m.error?entry.reject(Error(m.error.message)):entry.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method!=='Fetch.requestPaused')return;
    const p=m.params,url=new URL(p.request.url);
    try{
      if(p.responseStatusCode && url.pathname==='/api/v1/workspace/bootstrap'){
        const body=await send('Fetch.getResponseBody',{requestId:p.requestId});
        const data=JSON.parse(body.base64Encoded?Buffer.from(body.body,'base64').toString():body.body);
        data.notifications=Array.from({length:300},(_,i)=>({id:'qa-notice-'+i,kind:'task',priority:i<7?'attention':'normal',title:'Тестовое событие '+i,body:'Временный пример для проверки интерфейса',section:'tasks',entityId:'qa-task-'+(i%6),requiresAction:i<7,isReminder:false,occurredAt:new Date().toISOString(),readAt:readAll||i>=7?new Date().toISOString():null}));
        const base=data.tasks[0];assert(base,'Expected at least one TEST task');
        const author=data.people.find(p=>p.id!==data.currentUser.id)?.id??base.authorId;
        data.tasks=['new','in_progress','awaiting_review','completed','overdue','cancelled'].map((status,i)=>({...base,id:'qa-task-'+i,title:'Тестовая задача '+i,status,authorId:author,assigneeId:data.currentUser.id,dueAt:null,dueLabel:'Срок не указан',priority:'normal',comments:[],participants:[]}));
        await fulfill(p.requestId,JSON.stringify(data));
      }else if(p.request.method==='GET'||url.pathname==='/api/v1/auth/web/refresh')await send('Fetch.continueRequest',{requestId:p.requestId});
      else if(url.pathname==='/api/v1/notifications/read-all'){
        if(rejectRead)await fulfill(p.requestId,'{"detail":"Test-only failure"}',500);
        else{readAll=true;await fulfill(p.requestId,'',204);}
      }else await fulfill(p.requestId,'{"detail":"Read-only UI QA"}',403);
    }catch(e){errors.push(e.message);await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
  };
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.text);return r.result.value;};
  const waitFor=async expression=>{for(let n=0;n<70;n++){if(await evaluate(expression))return;await pause(150);}throw Error('Missing UI: '+expression);};
  const section=async key=>{await evaluate(`if(!document.querySelector('[data-navigation-key="${key}"] button'))document.querySelector('.rail-more-action')?.click()`);await pause(250);await evaluate(`(()=>{const b=document.querySelector('[data-navigation-key="${key}"] button');if(!b)throw Error('Missing section ${key}');b.click();})()`);await pause(500);};
  const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,(before?'before-':'after-')+name+'.png'),Buffer.from(r.data,'base64'));};
  const original=await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try{
    await fs.mkdir(out,{recursive:true});await send('Page.enable');await send('Runtime.enable');await send('Page.bringToFront');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'},{urlPattern:origin+'/api/v1/workspace/bootstrap',requestStage:'Response'}]});
    await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('.rail-toggle')");
    await section('notifications');await waitFor("!!document.querySelector('.notification-progress-card')");
    assert.equal(await evaluate("document.querySelector('.notification-progress-card > strong').textContent"),'98%');
    if(!before){
      rejectRead=true;await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Прочитать все').click()");await pause(800);
      assert.equal(await evaluate("document.querySelector('.notification-progress-card > strong').textContent"),'98%','Failed save must not mark data read');rejectRead=false;
      await evaluate("document.querySelector('button[aria-label=\"Закрыть сообщение об ошибке\"]')?.click()");
    }
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Прочитать все').click()");
    await waitFor("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Прочитать все')?.disabled");
    assert.equal(await evaluate("document.querySelector('.notification-progress-card > strong').textContent"),'100%');
    assert.equal(await evaluate("document.querySelectorAll('.notification-row-meta em').length"),7,'Read must not resolve actions');
    await shot('notifications');
    if(!before){
      await evaluate("document.querySelector('.notification-open').click()");
      await waitFor("!!document.querySelector('.task-record-dialog')");
      assert.equal(await evaluate("document.querySelector('.task-record-dialog h2').textContent"),'Тестовая задача 0');
      await evaluate("document.querySelector('.task-detail-close').click()");
      await waitFor("!document.querySelector('.task-record-dialog')");
      console.log('PASS browser notification deep link and task close');
    }
    for(const [width,height] of [[2048,900],[1440,900],[1280,900],[1024,768],[640,480]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(450);
      await section('team_overview');await waitFor("document.querySelectorAll('.team-dash-metric').length===4");
      const metrics=await evaluate(`Array.from(document.querySelectorAll('.team-dash-metric'),b=>{
        const s=getComputedStyle(b),box=b.getBoundingClientRect(),iconNode=b.querySelector('.team-dash-metric-icon'),icon=iconNode.getBoundingClientRect(),number=b.querySelector('strong').getBoundingClientRect();
        const label=b.querySelector('span'),copy=b.querySelector('.team-dash-metric-copy')??label.parentElement,copyBox=copy.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect();
        return {tone:b.className,background:s.backgroundImage,origin:s.backgroundOrigin,repeat:s.backgroundRepeat,iconBackground:getComputedStyle(iconNode).backgroundColor,selected:b.getAttribute('aria-pressed'),overflow:b.scrollWidth>b.clientWidth,
          labelCenterX:text.x+text.width/2-(box.x+box.width/2),copyCenterY:copyBox.y+copyBox.height/2-(box.y+box.height/2),iconCenterY:icon.y+icon.height/2-(box.y+box.height/2),numberCenterY:number.y+number.height/2-(box.y+box.height/2)};
      })`);
      if(!before){
        assert(metrics.every(m=>m.background.startsWith('linear-gradient(90deg')));assert.equal(new Set(metrics.map(m=>m.background)).size,4);assert(metrics.every(m=>!m.overflow));
        for(const m of metrics){assert.equal(m.iconBackground,'rgb(255, 255, 255)','Icon surface must be pure white');assert(m.origin.split(',').every(v=>v.trim()==='border-box'),'Gradient must include transparent border');assert(m.repeat.split(',').every(v=>v.trim()==='no-repeat'),'Gradient must not tile into the left border');for(const key of ['labelCenterX','copyCenterY','iconCenterY','numberCenterY'])assert(Math.abs(m[key])<1,key+' must be centered, got '+m[key]);}
      }
      await evaluate("document.querySelector('.team-dash-metric.tone-danger').click()");assert.equal(await evaluate("document.querySelector('.team-dash-metric.tone-danger').getAttribute('aria-pressed')"),'true');
      await shot(width+'x'+height+'-metrics');
      await section('tasks');await waitFor("!!document.querySelector('.task-filter-tabs')");
      await evaluate("Array.from(document.querySelectorAll('.view-switch button')).find(b=>b.textContent.trim()==='Список')?.click();document.querySelector('.task-filter-tabs button[aria-label=\"Мои\"]').click()");
      await waitFor("!!document.querySelector('.task-record-table')");
      const badges=await evaluate(`Array.from(document.querySelectorAll('.task-record-table .fui-Badge'),b=>{const s=getComputedStyle(b),box=b.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(b);const text=range.getBoundingClientRect();return {text:b.textContent,width:box.width,height:box.height,padding:[s.paddingTop,s.paddingRight,s.paddingBottom,s.paddingLeft].map(parseFloat),textClearance:[text.top-box.top,box.right-text.right,box.bottom-text.bottom,text.left-box.left],overflow:b.scrollHeight>b.clientHeight||b.scrollWidth>b.clientWidth,color:s.color,background:s.backgroundColor,lineHeight:s.lineHeight};})`);
      assert.equal(badges.length,6);assert(badges.some(b=>b.text==='Ждёт проверки постановщиком'));
      if(!before){
        assert(badges.every(b=>!b.overflow));assert(badges.every(b=>b.padding[0]>=5&&b.padding[1]>=9));
        assert(badges.every(b=>b.textClearance.every(c=>c>=3)),'Text must not touch badge edges');
        const lum=rgb=>rgb.map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
        for(const b of badges){const fg=lum(b.color.match(/[\d.]+/g).slice(0,3).map(Number)),bg=lum(b.background.match(/[\d.]+/g).slice(0,3).map(Number));b.contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);assert(b.contrast>=4.5,'Low status contrast: '+b.text);}
      }
      const rootOverflow=await evaluate('document.documentElement.scrollWidth>innerWidth');if(!before)assert(!rootOverflow);
      await evaluate("Array.from(document.querySelectorAll('.task-record-table .fui-Badge')).find(b=>b.textContent==='Ждёт проверки постановщиком').scrollIntoView({block:'center',inline:'nearest'})");
      await shot(width+'x'+height+'-statuses');results.push({width,height,metrics,badges,rootOverflow});
      console.log('PASS',width+'x'+height,before?'baseline':'read semantics, metric filters and unclipped padded badges');
    }
    if(!before){
      await section('team_overview');await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await pause(300);
      assert(await evaluate("Array.from(document.querySelectorAll('.team-dash-metric')).every(b=>getComputedStyle(b).backgroundImage==='none')"));
      await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    }
    assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,before?'before.json':'after.json'),JSON.stringify(results,null,2));
  }finally{
    await send('Fetch.disable');await send('Emulation.setEmulatedMedia',{features:[]});await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false});await send('Page.reload',{ignoreCache:true});ws.close();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
