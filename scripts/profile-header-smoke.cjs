// Existing authenticated TEST LAN page only. No business write reaches the server.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/profile-header');
const pause = ms => new Promise(r => setTimeout(r, ms));
const contrast=(foreground,background) => {
  const luminance=color => color.match(/\d+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const a=luminance(foreground),b=luminance(background);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
};
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST LAN browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r,j) => { ws.onopen=r;ws.onerror=j; });
  let id=0;
  const pending=new Map(), errors=[], writes=[], results=[], accessibility=[];
  const send=(method,params={}) => new Promise((resolve,reject) => {
    const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error(method+' timeout'))},15000);
    pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));
  });
  ws.onmessage=async event => {
    const m=JSON.parse(event.data),e=pending.get(m.id);
    if(e){pending.delete(m.id);clearTimeout(e.timer);m.error?e.reject(Error(m.error.message)):e.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);
    if(m.method!=='Fetch.requestPaused')return;
    const p=m.params;
    try {
      if(p.request.method==='GET'||new URL(p.request.url).pathname==='/api/v1/auth/web/refresh')await send('Fetch.continueRequest',{requestId:p.requestId});
      else {writes.push(new URL(p.request.url).pathname);await send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from('{"detail":"Read-only UI QA"}').toString('base64')});}
    }catch(error){errors.push(error.message);}
  };
  const evaluate=async expression => {const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!r.exceptionDetails,r.exceptionDetails?.exception?.description??r.exceptionDetails?.text);return r.result.value};
  const waitFor=async expression => {for(let n=0;n<100;n++){if(await evaluate(expression))return;await pause(100);}throw Error('Missing UI: '+expression)};
  const shot=async name => {const r=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))};
  const select=async key => {
    await evaluate(`document.querySelector('.employee-profile-tabs [aria-controls="employee-profile-${key}"]').click()`);
    await pause(650);
    assert(await evaluate(`document.querySelector('.employee-profile-tabs [aria-controls="employee-profile-${key}"]').getAttribute('aria-pressed')==='true'`));
  };
  const check=async label => {
    const r=await evaluate(`(()=>{const p=document.querySelector('.employee-profile-dialog'),c=p.querySelector('.fui-DialogContent'),h=p.querySelector('.employee-profile-hero'),t=p.querySelector('.employee-profile-tabs'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {label:${JSON.stringify(label)},viewport:[innerWidth,innerHeight],panel:rect(p),hero:rect(h),tabs:rect(t),overflow:c.scrollWidth>c.clientWidth+1,heroBorder:getComputedStyle(h).borderTopWidth,statBackground:getComputedStyle(h.querySelector('.employee-profile-hero-stat')).backgroundColor,activeColor:getComputedStyle(t.querySelector('[aria-pressed=true]')).color,indicatorBackground:getComputedStyle(t.querySelector('.sliding-segmented-indicator')).backgroundColor,indicator:rect(t.querySelector('.sliding-segmented-indicator')),selected:rect(t.querySelector('[aria-pressed=true]')),controls:[...t.querySelectorAll('button')].map(rect)}})()`);
    assert(!r.overflow,label+' no profile horizontal overflow');
    assert(r.panel.left>=-1&&r.panel.top>=-1&&r.panel.right<=r.viewport[0]+1&&r.panel.bottom<=r.viewport[1]+1,label+' dialog fits viewport');
    assert.equal(r.heroBorder,'1px');
    assert.equal(r.statBackground,'rgb(41, 58, 85)');assert.equal(r.indicatorBackground,'rgb(41, 58, 85)');
    assert(contrast(r.activeColor,r.indicatorBackground)>=4.5,label+' selected label AA contrast');
    assert(r.controls.every(e=>e.left>=r.tabs.left&&e.right<=r.tabs.right),label+' navigation fits');
    assert(Math.abs(r.indicator.left-r.selected.left)<2&&Math.abs(r.indicator.width-r.selected.width)<2,label+' selection surface aligned');
    results.push(r);
  };
  const original=await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out,{recursive:true});await send('Runtime.enable');await send('Page.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'}]});
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await send('Page.reload',{ignoreCache:true});await waitFor("!!document.querySelector('.workspace-identity-menu')");
    await evaluate("document.querySelector('.workspace-identity-menu').focus();document.querySelector('.workspace-identity-menu').click()");
    await waitFor("!!document.querySelector('.identity-popover-actions')");
    await evaluate("[...document.querySelectorAll('.identity-popover-actions button')].find(e=>e.textContent.trim()==='Профиль сотрудника').click()");
    await waitFor("!!document.querySelector('.employee-profile-hero')");await pause(500);
    await evaluate(await fs.readFile(require.resolve('axe-core/axe.min.js'),'utf8'));
    for(const key of ['overview','rewards','achievements']) {
      await select(key);await check('desktop-'+key);await shot('desktop-'+key);
      const violations=await evaluate("axe.run(document.querySelector('.employee-profile-sticky'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
      accessibility.push({key,violations});assert.equal(violations.length,0,JSON.stringify(violations));
    }
    for(const [width,height] of [[1024,768],[640,480],[360,640],[320,568]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(300);
      for(const key of ['overview','rewards','achievements']){await select(key);await check(width+'-'+key);}
      // Inspect copy at the top and the selected section separately.
      await evaluate("document.querySelector('.employee-profile-dialog .fui-DialogContent').scrollTop=0");await pause(400);await shot('compact-'+width);
      console.log('PASS',width+'x'+height);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await evaluate("document.documentElement.style.zoom='2'");await pause(400);await select('overview');await check('200-percent');await shot('zoom-200');
    await evaluate("document.documentElement.style.zoom=''");
    // Test a long title without modifying the employee record.
    await evaluate("document.querySelector('.employee-profile-identity p').textContent='Руководитель направления координации региональных подразделений и международного сотрудничества'");
    await send('Emulation.setDeviceMetricsOverride',{width:320,height:568,deviceScaleFactor:1,mobile:false});await pause(350);await select('rewards');await check('long-title-320');await shot('long-title-320');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await pause(300);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await select('achievements');assert(await evaluate("getComputedStyle(document.querySelector('.employee-profile-tabs .sliding-segmented-indicator')).transitionDuration==='0s'"));await shot('reduced-motion');
    await send('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await select('overview');await shot('forced-colors');
    await send('Emulation.setEmulatedMedia',{features:[]});
    await evaluate("document.querySelector('[aria-label=\"Закрыть профиль\"]').focus()");
    for(let n=0;n<8;n++) {
      await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab'});
      assert(await evaluate("document.querySelector('.employee-profile-dialog').contains(document.activeElement)"),'Keyboard focus retained');
    }
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await waitFor("!document.querySelector('.employee-profile-dialog')");
    await pause(300);
    assert(await evaluate("!!document.activeElement.closest('.workspace-identity-menu')"),'Focus restored: '+await evaluate("document.activeElement.outerHTML.slice(0,250)"));
    assert.equal(writes.length,0,'No business writes');assert.equal(errors.length,0,errors.join('\n'));
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({results,accessibility,errors,blockedWrites:writes},null,2));
    console.log('PASS',results.length,'layout checks; 3 axe scans; keyboard, reduced motion and forced colors');
  } finally {
    await evaluate("document.documentElement.style.zoom=''").catch(()=>{});
    await send('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false}).catch(()=>{});
    await send('Fetch.disable').catch(()=>{});await send('Page.reload',{ignoreCache:true}).catch(()=>{});ws.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
