// TEST site only. --before captures the old layout; --toggle verifies the real
// visibility switch in both directions and restores its original saved value.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const origin = 'https://192.168.31.176:8443';
const before = process.argv.includes('--before'), toggle = process.argv.includes('--toggle');
const output = path.resolve('tmp/employees-settings-fix');
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));

async function main() {
  const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
  const page = pages.find(p=>p.type==='page'&&p.url.startsWith(origin));
  assert(page,'Open the authenticated TEST site in the QA browser on port 9224.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  const pending = new Map(), errors = [], results = [], responses = [];
  let id=0, originalSetting;
  const send = (method,params={})=>new Promise((resolve,reject)=>{
    const key=++id, timer=setTimeout(()=>{pending.delete(key);reject(Error('CDP timeout: '+method));},10000);
    pending.set(key,{resolve,reject,timer});ws.send(JSON.stringify({id:key,method,params}));
  });
  ws.onmessage=async event=>{
    const message=JSON.parse(event.data),request=pending.get(message.id);
    if(request){pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(message.error.message)):request.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.text);
    if(message.method==='Network.responseReceived'&&message.params.response.url===origin+'/api/v1/recognition/settings')responses.push(message.params.response.status);
    if(message.method==='Fetch.requestPaused'){
      const paused=message.params,method=paused.request.method,url=new URL(paused.request.url);
      try{
        if(method==='GET'||url.pathname==='/api/v1/auth/web/refresh'||(toggle&&method==='PATCH'&&url.pathname==='/api/v1/recognition/settings')){
          await send('Fetch.continueRequest',{requestId:paused.requestId});
        }else{
          await send('Fetch.fulfillRequest',{requestId:paused.requestId,responseCode:403,body:Buffer.from('{"detail":"QA does not modify business records"}').toString('base64')});
        }
      }catch(error){errors.push(error.message);}
    }
  };
  const evaluate=async expression=>{
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert(!result.exceptionDetails,result.exceptionDetails?.text);return result.result.value;
  };
  const waitFor=async expression=>{for(let i=0;i<50;i++){if(await evaluate(expression))return;await pause(150);}throw Error('Timed out waiting for UI');};
  const input="document.querySelector('.employees-view input[role=\"switch\"]')";
  const loaded=()=>waitFor("!!document.querySelector('.employee-record-table') && "+input+" && !"+input+".disabled");
  const original=await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  const setValue=async value=>{
    await loaded();
    await evaluate(`(()=>{const input=${input};if(input.checked!==${value})input.click();})()`);
    await waitFor(`${input} && !${input}.disabled && ${input}.checked===${value}`);
  };
  try{
    await fs.mkdir(output,{recursive:true}); await send('Page.enable');await send('Page.bringToFront');
    await send('Runtime.enable');await send('Network.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'}]});
    await send('Page.reload',{ignoreCache:true});await pause(800);
    await waitFor("!!document.querySelector('.app-rail')");
    assert(await evaluate("(()=>{const button=[...document.querySelectorAll('.app-rail button')].find(b=>b.getAttribute('aria-label')==='Сотрудники'||b.textContent.trim()==='Сотрудники');if(!button)return false;button.click();return true;})()"),'Missing Employees navigation');
    await loaded();
    for(const [width,height] of [[2048,900],[1440,900],[1024,768],[620,900]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await pause(500);
      const metrics=await evaluate(`(()=>{
        const rect=s=>document.querySelector(s).getBoundingClientRect();
        const rail=rect('.app-rail'),frame=rect('.employees-view .record-table-frame'),header=rect('.employees-view .section-toolbar');
        const controls=rect('.employees-view .record-list-controls'),actions=rect('.employees-view .toolbar-actions');
        const search=rect('.employees-view .employee-search');
        return {width:innerWidth,leftGutter:frame.left-rail.right,rightGutter:innerWidth-frame.right,
          headerHeight:header.height,controlsTop:controls.top,tableTop:frame.top,tableBottom:frame.bottom,
          filterGap:controls.top-header.bottom,actionsRight:innerWidth-actions.right,
          searchTop:search.top,overflow:document.documentElement.scrollWidth>innerWidth,
          tableScroll:document.querySelector('.record-table-scroll').scrollWidth>document.querySelector('.record-table-scroll').clientWidth};
      })()`);
      if(!before){
        assert(Math.abs(metrics.leftGutter-metrics.rightGutter)<1,'Unequal gutters: '+JSON.stringify(metrics));
        assert(!metrics.overflow,'Page has horizontal overflow');assert(metrics.filterGap<1,'Unexpected empty header/filter band');
        assert(metrics.tableBottom>metrics.tableTop+150,'Directory table lost usable height');
      }
      results.push(metrics);
      const screenshot=await send('Page.captureScreenshot',{format:'png'});
      await fs.writeFile(path.join(output,`${before?'before':'after'}-${width}.png`),Buffer.from(screenshot.data,'base64'));
      console.log('LAYOUT',JSON.stringify(metrics));
    }
    if(toggle){
      originalSetting=await evaluate(input+'.checked');
      await setValue(!originalSetting);await send('Page.reload',{ignoreCache:true});await loaded();
      assert.equal(await evaluate(input+'.checked'),!originalSetting,'Saved setting did not persist');
      await setValue(originalSetting);await send('Page.reload',{ignoreCache:true});await loaded();
      assert.equal(await evaluate(input+'.checked'),originalSetting,'Original value was not restored');
      assert(responses.length>=4&&responses.every(status=>status===200),'Settings endpoint failed: '+JSON.stringify(responses));
      console.log('PASS saved switch off/on, reload persistence, original value restored, HTTP 200');
    }
    assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(output,`${before?'before':'after'}-layout.json`),JSON.stringify(results,null,2));
  }finally{
    if(originalSetting!==undefined)await setValue(originalSetting);
    await send('Fetch.disable');await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false});
    await send('Page.reload',{ignoreCache:true});await pause(300);ws.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
