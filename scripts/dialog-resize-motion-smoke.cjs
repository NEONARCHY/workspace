// Existing authenticated TEST browser only. Fixtures stay in responses; every business write is blocked.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/dialog-resize-motion');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map(), errors = [], writes = [], results = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(method+' timeout')); }, 12000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id:key, method, params }));
  });
  const fulfill = (requestId, body, status = 200) => send('Fetch.fulfillRequest', { requestId, responseCode:status, responseHeaders:[{name:'Content-Type',value:'application/json'}], body:Buffer.from(JSON.stringify(body)).toString('base64') });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data), entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); m.error ? entry.reject(Error(m.error.message)) : entry.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params, url = new URL(p.request.url);
    try {
      if (p.responseStatusCode && url.pathname === '/api/v1/workspace/bootstrap') {
        const body = await send('Fetch.getResponseBody', { requestId:p.requestId });
        const data = JSON.parse(body.base64Encoded ? Buffer.from(body.body,'base64').toString() : body.body);
        const qa = [{id:'qa-resize-person',name:'Сотрудник для проверки',initials:'СП',role:'employee',status:'active',color:'#a7eacc',departmentId:null,jobTitle:'Длинная должность для проверки симметрии списка'},
          {id:'qa-resize-second',name:'Второй сотрудник',initials:'ВС',role:'employee',status:'active',color:'#e0cca0',departmentId:null,jobTitle:'Специалист'}];
        data.people = [...data.people, ...qa];
        const permissions = {sendMessages:true,uploadFiles:true,inviteMembers:true,manageMembers:true,editInfo:true,manageMessages:true};
        data.chats = [...data.chats, {id:'qa-resize-group',title:'Пример группы для проверки размера',kind:'group',preview:'Временная проверка интерфейса',time:'',unread:0,description:'Не сохраняется на сервере.',ownerId:data.currentUser.id,canDelete:false,canEditAvatar:false,permissions,
          members:[{userId:data.currentUser.id,role:'owner',permissions},{userId:qa[0].id,role:'member',permissions}]}];
        await fulfill(p.requestId,data);
      } else if (p.request.method === 'GET' || url.pathname === '/api/v1/auth/web/refresh') await send('Fetch.continueRequest',{requestId:p.requestId});
      else { writes.push(url.pathname); await fulfill(p.requestId,{detail:'Read-only UI QA'},403); }
    } catch (e) { errors.push(e.message); await send('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}).catch(()=>{}); }
  };
  const evaluate = async expression => { const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true}); assert(!r.exceptionDetails,r.exceptionDetails?.text); return r.result.value; };
  const waitFor = async expression => { for(let n=0;n<75;n++){if(await evaluate(expression))return;await pause(120);} throw Error('Missing UI: '+expression); };
  const click = async selector => {
    const point = await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});if(!b)throw Error('Missing control');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point}); await send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point}); await send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
  };
  const key = async (key, modifiers=0) => { await send('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,modifiers}); await send('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers}); await pause(80); };
  const height = () => evaluate("document.querySelector('.chat-settings-dialog').getBoundingClientRect().height");
  const clear = () => evaluate('window.qaResizeFrames=[]');
  const records = () => evaluate('window.qaResizeFrames');
  const settled = async () => { await pause(340); return height(); };
  const open = async () => { await click('button[aria-label="Создать группу"]'); await waitFor("!!document.querySelector('.chat-settings-dialog')"); await pause(340); await clear(); };
  const close = async () => { await key('Escape'); await waitFor("!document.querySelector('.chat-settings-dialog')"); await pause(180); };
  const shot = async name => { const r=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(r.data,'base64')); };
  const original=await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out,{recursive:true}); await send('Page.enable'); await send('Runtime.enable');
    await send('Fetch.enable',{patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'},{urlPattern:origin+'/api/v1/workspace/bootstrap',requestStage:'Response'}]});
    await send('Page.reload',{ignoreCache:true}); await waitFor("!!document.querySelector('.rail-toggle')");
    await evaluate("if(!document.querySelector('[data-navigation-key=messenger] button'))document.querySelector('.rail-more-action')?.click()");await pause(180);
    await evaluate("document.querySelector('[data-navigation-key=messenger] button').click()"); await waitFor("!!document.querySelector('button[aria-label=\"Создать группу\"]')");
    await evaluate(`window.qaResizeFrames=[];window.qaOriginalAnimate=HTMLElement.prototype.animate;HTMLElement.prototype.animate=function(frames,options){if(this.matches('.fui-DialogSurface,[role=dialog][aria-modal=true]')&&frames.some(f=>f.height||f.width))window.qaResizeFrames.push({frames,duration:options.duration,className:this.className});return window.qaOriginalAnimate.call(this,frames,options)}`);
    for(const [width,viewportHeight] of [[1440,1000],[1024,768],[640,480],[360,640],[720,500]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:viewportHeight,deviceScaleFactor:1,mobile:false});await pause(200);await open();
      const central=await height(); await click('.chat-people-picker .employee-scope-switch > button:nth-child(2)');
      const samples=await evaluate(`(async()=>{const samples=[];for(let n=0;n<22;n++){await new Promise(requestAnimationFrame);const d=document.querySelector('.chat-settings-dialog'),r=d.getBoundingClientRect();samples.push({height:r.height,center:r.y+r.height/2,font:getComputedStyle(d.querySelector('.fui-DialogTitle')).fontSize});}return samples})()`);
      const regional=await settled(), shrink=await records();
      if(Math.abs(central-regional)>1){
        assert(shrink.some(a=>a.frames[0].height),'Actual shrink animation');assert(samples.some(s=>s.height<central-1&&s.height>regional+1),'Intermediate resize frames');
        assert(samples.every(s=>Math.abs(s.center-viewportHeight/2)<1),'Center remains fixed');assert(new Set(samples.map(s=>s.font)).size===1,'Text never scales');
      }
      assert(shrink.every(a=>a.duration>=160&&a.duration<=260));
      await clear(); await click('.chat-people-picker .employee-scope-switch > button:first-child');
      const expansion=await evaluate(`(async()=>{const samples=[];for(let n=0;n<22;n++){await new Promise(requestAnimationFrame);const d=document.querySelector('.chat-settings-dialog'),r=d.getBoundingClientRect(),body=d.querySelector(':scope > .fui-DialogBody'),b=body.getBoundingClientRect();samples.push({height:r.height,bodyBottom:b.bottom,frameBottom:r.bottom,padding:parseFloat(getComputedStyle(d).paddingBottom)});}return samples})()`);
      assert(expansion.every(s=>s.bodyBottom<=s.frameBottom-s.padding+2),'Content follows the expanding frame without spilling out');
      assert(Math.abs(await settled()-central)<1,'Expansion resumes natural height');
      await clear(); await click('.chat-people-picker .employee-scope-switch > button:first-child');await pause(45);
      await click('.chat-people-picker .employee-scope-switch > button:nth-child(2)');await pause(45);await click('.chat-people-picker .employee-scope-switch > button:first-child');
      assert(Math.abs(await settled()-central)<1,'Rapid reversal finishes naturally');
      const metrics=await evaluate(`(()=>{const d=document.querySelector('.chat-settings-dialog'),r=d.getBoundingClientRect(),c=d.querySelector('.chat-settings-content');return {viewport:[innerWidth,innerHeight],bounds:[r.left,r.right,r.top,r.bottom],inline:[d.style.height,d.style.width],overflow:d.scrollWidth>d.clientWidth,contentOverflow:c.scrollWidth>c.clientWidth,animations:d.getAnimations().filter(a=>a.playState==='running').length}})()`);
      assert.deepEqual(metrics.inline,['','']);assert(!metrics.overflow&&!metrics.contentOverflow);assert.equal(metrics.animations,0);assert(metrics.bounds[2]>=10&&metrics.bounds[3]<=viewportHeight-10);
      await clear();await evaluate(`(()=>{const input=[...document.querySelectorAll('.chat-settings-content input')].find(e=>!e.hasAttribute('aria-label'));Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Черновик сохраняется');input.dispatchEvent(new Event('input',{bubbles:true}))})()`);await pause(260);assert.equal((await records()).length,0,'Stable input does not resize');
      await shot(width+'x'+viewportHeight);results.push({central,regional,samples,expansion,metrics});await close();assert(await evaluate("document.activeElement.matches('button[aria-label=\"Создать группу\"]')"),'Focus returns after Escape');
      console.log('PASS',width+'x'+viewportHeight,'scope resize/reversal, center, unscaled text, natural geometry, stable input and focus');
    }
    console.log('CHECK selected people');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await pause(220);await open();
    await click('.chat-people-options button:first-child');await click('.chat-people-picker .employee-scope-switch > button:nth-child(2)');await settled();await click('.chat-people-picker .employee-scope-switch > button:first-child');await settled();
    assert(await evaluate("document.querySelector('.chat-people-options button:first-child').getAttribute('aria-pressed')==='true'"),'Selection survives resize');await close();
    console.log('CHECK rights editor');
    await click('[data-chat-id="qa-resize-group"] .chat-row');await pause(260);
    await evaluate("[...document.querySelectorAll('.conversation-header-actions button')].find(b=>b.textContent==='Участники и права').click()");await waitFor("!!document.querySelector('.chat-settings-dialog')");await pause(340);await clear();
    const beforeRights=await height();await click('.chat-member-actions button[aria-label^="Права:"]');const rights=await settled();
    if(Math.abs(rights-beforeRights)>1)assert((await records()).some(a=>a.frames[0].height),'Rights editor uses same resize');
    assert(await evaluate("!!document.querySelector('.chat-member-editor')"));await shot('member-rights');await close();
    // Generic custom modal and width changes also use the same controller, without scaling glyphs.
    console.log('CHECK custom modal');
    await evaluate(`(()=>{const d=document.createElement('section');d.id='qa-custom-resize';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');d.style.cssText='position:fixed;inset:0;margin:auto;width:400px;height:200px;background:white;z-index:9999;';d.textContent='Временный пример окна';document.body.append(d)})()`);await pause(120);await clear();
    await evaluate("document.querySelector('#qa-custom-resize').style.width='520px';document.querySelector('#qa-custom-resize').style.height='300px'");await pause(340);
    assert((await records()).some(a=>a.frames[0].width&&a.frames[0].height),'Width and height resize');await evaluate("document.querySelector('#qa-custom-resize').remove()");
    for(const preference of [{name:'prefers-reduced-motion',value:'reduce'},{name:'forced-colors',value:'active'}]) {
      console.log('CHECK',preference.name);
      await send('Emulation.setEmulatedMedia',{features:[preference]});await open();await click('.chat-people-picker .employee-scope-switch > button:nth-child(2)');await pause(260);assert.equal((await records()).length,0,preference.name);await close();
    }
    await send('Emulation.setEmulatedMedia',{features:[]});await open();await clear();await click('.chat-people-picker .employee-scope-switch > button:nth-child(2)');await pause(40);
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(260);assert(await evaluate("document.querySelector('.chat-settings-dialog').getAnimations().every(a=>a.playState!=='running')"));await close();
    assert(!writes.some(p=>p.startsWith('/api/v1/chats')&&!p.endsWith('/read')),'No group was created or modified');assert.deepEqual(errors,[]);
    await fs.writeFile(path.join(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS selected people, rights editor, custom width/height, reduced/forced/changed preferences; no business changes');
  } catch (error) {
    await shot('failure').catch(()=>{});
    throw error;
  } finally {
    await evaluate("document.querySelector('#qa-custom-resize')?.remove();if(window.qaOriginalAnimate)HTMLElement.prototype.animate=window.qaOriginalAnimate").catch(()=>{});
    await send('Fetch.disable');await send('Emulation.setEmulatedMedia',{features:[]});await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false});await send('Page.reload',{ignoreCache:true});ws.close();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
