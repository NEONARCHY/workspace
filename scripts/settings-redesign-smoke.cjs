// Existing authenticated TEST LAN browser. All account/business writes blocked.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/settings-redesign');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map(), errors = [], writes = [], results = [], accessibility = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timeout')); }, 15000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  ws.onmessage = async event => {
    const m = JSON.parse(event.data), entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); m.error ? entry.reject(Error(m.error.message)) : entry.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params;
    try {
      if (p.request.method === 'GET' || new URL(p.request.url).pathname === '/api/v1/auth/web/refresh') await send('Fetch.continueRequest', { requestId: p.requestId });
      else {
        writes.push(new URL(p.request.url).pathname);
        await send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 503,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify({ detail: 'Read-only QA: изменения не сохранены' })).toString('base64') });
      }
    } catch (error) { errors.push(error.message); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text); return r.result.value; };
  const waitFor = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await pause(100); } throw Error('Missing UI: ' + expression); };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64')); };
  const select = async key => { await evaluate(`document.querySelector('.account-section-nav button[aria-controls="account-page-${key}"]').click()`); await waitFor(`!document.getElementById('account-page-${key}').hidden`); await pause(220); };
  const check = async label => {
    const r = await evaluate(`(()=>{const p=document.querySelector('.account-panel'),c=p.querySelector('.account-settings-content'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {label:${JSON.stringify(label)},viewport:[innerWidth,innerHeight],panel:rect(p),content:rect(c),overflow:p.scrollWidth>p.clientWidth+1||c.scrollWidth>c.clientWidth+1,visiblePages:[...p.querySelectorAll('.account-settings-page')].filter(e=>!e.hidden).length,sectionBackground:getComputedStyle(p.querySelector('.account-settings-page:not([hidden]) .account-section')).backgroundColor,controls:[...p.querySelectorAll('.account-settings-page:not([hidden]) button,.account-settings-page:not([hidden]) .fui-Input,.account-settings-page:not([hidden]) .fui-Dropdown')].filter(e=>e.getClientRects().length).map(rect)}})()`);
    assert(!r.overflow, label + ' no horizontal overflow'); assert.equal(r.visiblePages, 1);
    assert(r.panel.left >= 0 && r.panel.top >= 0 && r.panel.right <= r.viewport[0]+1 && r.panel.bottom <= r.viewport[1]+1, 'Dialog in viewport');
    assert.equal(r.sectionBackground, 'rgb(255, 255, 255)');
    assert(r.controls.every(e=>e.left>=r.content.left-1&&e.right<=r.content.right+1), label+' controls fit content width');
    results.push(r);
  };
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out, { recursive: true }); await send('Runtime.enable'); await send('Page.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: origin+'/api/v1/*', requestStage: 'Request' }] });
    await send('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
    await send('Page.reload', { ignoreCache:true }); await waitFor("!!document.querySelector('.workspace-identity-menu')");
    await evaluate("document.querySelector('.workspace-identity-menu').focus();document.querySelector('.workspace-identity-menu').click()"); await waitFor("!!document.querySelector('.identity-popover-actions')");
    await evaluate("[...document.querySelectorAll('.identity-popover-actions button')].find(e=>e.textContent.trim()==='Настройки').click()");
    await waitFor("!!document.querySelector('.account-settings-redesigned')"); await pause(500);
    assert(await evaluate("document.querySelector('.account-window-header').textContent.includes('Настройки профиля')&&![...document.querySelectorAll('.account-window-header span')].some(e=>e.textContent.trim()==='Настройки')"));
    // A real pointer click verifies the context transition, not just settled DOM.
    const target = await evaluate("(()=>{const r=document.querySelector('.account-section-nav button[aria-controls=account-page-audio]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()");
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',...target});
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...target,button:'left',clickCount:1});
    await send('Input.dispatchMouseEvent',{type:'mouseReleased',...target,button:'left',clickCount:1});
    assert(await evaluate("document.querySelector('.account-settings-content').getAnimations().some(a=>a.playState==='running')||matchMedia('(prefers-reduced-motion: reduce), (forced-colors: active)').matches"),'Short context animation after pointer click');
    await evaluate(await fs.readFile(require.resolve('axe-core/axe.min.js'),'utf8'));
    for (const key of ['profile','audio','security','sessions','invite','managed-password','recovery','updates']) {
      await select(key); await check(key); await shot('desktop-'+key);
      const scan = await evaluate("axe.run(document.querySelector('.account-panel'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}).then(r=>r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})))");
      accessibility.push({key,violations:scan}); assert.equal(scan.length,0,JSON.stringify({key,violations:scan}));
    }
    await select('security');
    await evaluate("(()=>{const e=document.querySelector('[data-account-section=password] input');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'QA-Draft-2026-Only!');e.dispatchEvent(new Event('input',{bubbles:true}))})()");
    await select('profile'); await select('security'); assert(await evaluate("document.querySelector('[data-account-section=password] input').value==='QA-Draft-2026-Only!'"));
    await evaluate("[...document.querySelectorAll('[data-account-section=password] button')].find(e=>e.type==='submit').click()");
    await waitFor("document.querySelector('.account-settings-feedback')?.textContent.includes('Read-only QA')");
    assert(await evaluate("document.querySelector('[data-account-section=password] input').value==='QA-Draft-2026-Only!'"));
    await shot('password-error');
    for (const [width,height] of [[1024,768],[640,480],[360,640],[320,568]]) {
      await send('Emulation.setDeviceMetricsOverride', { width,height,deviceScaleFactor:1,mobile:false }); await pause(250);
      for (const key of ['profile','security','invite','managed-password','recovery','updates']) {
        await select(key); await check(`${width}-${key}`);
        assert(await evaluate("(()=>{const c=document.querySelector('.account-settings-content');c.scrollTop=c.scrollHeight;const b=[...c.querySelectorAll('.account-settings-page:not([hidden]) button')].filter(e=>e.getClientRects().length).at(-1);return !b||b.getBoundingClientRect().bottom<=c.getBoundingClientRect().bottom+1})()"), 'Bottom action reachable by scrolling');
      }
      if(width<=640) {
        await evaluate("document.querySelector('.account-compact-navigation [role=combobox]').click()");
        await waitFor("[...document.querySelectorAll('[role=option]')].some(e=>e.textContent.trim()==='Личные данные')");
        await evaluate("[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()==='Личные данные').click()");
        await waitFor("!document.getElementById('account-page-profile').hidden");
      }
      await select('profile'); await shot('compact-'+width); console.log('PASS',width+'x'+height);
    }
    await send('Emulation.setDeviceMetricsOverride', { width:1440,height:900,deviceScaleFactor:1,mobile:false });
    await evaluate("document.documentElement.style.zoom='2'"); await pause(300); await select('managed-password'); await check('200-percent'); await shot('zoom-200');
    await evaluate("document.documentElement.style.zoom=''");
    for (const feature of ['prefers-reduced-motion','forced-colors']) {
      await send('Emulation.setEmulatedMedia',{features:[{name:feature,value:feature==='forced-colors'?'active':'reduce'}]});
      await select('security'); assert(await evaluate("document.querySelector('.account-settings-content').getAnimations().filter(a=>a.playState==='running').length===0"));
      await shot(feature);
    }
    await send('Emulation.setEmulatedMedia',{features:[]});
    // Native keyboard lifecycle, no session revocation or logout.
    await evaluate("document.querySelector('.account-window-header button').focus()");
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',modifiers:8}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',modifiers:8});
    assert(await evaluate("document.querySelector('.account-panel').contains(document.activeElement)"));
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'}); await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape'});
    await waitFor("!document.querySelector('.account-panel')");
    assert(await evaluate("!!document.activeElement.closest('.workspace-identity-menu')"), 'Focus restored to profile menu');
    assert.equal(errors.length,0,errors.join('\n'));
    assert(writes.length===1&&writes[0].includes('password'),'Only deliberate intercepted password QA write');
    await fs.writeFile(path.join(out,'report.json'),JSON.stringify({results,errors,blockedWrites:writes,accessibility},null,2));
    console.log('PASS',results.length,'layout checks, draft/error, keyboard, reduced motion and forced colors');
  } finally {
    await evaluate("document.documentElement.style.zoom=''").catch(()=>{});
    await send('Fetch.disable').catch(()=>{}); await send('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
    await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false}).catch(()=>{});
    await send('Page.reload',{ignoreCache:true}).catch(()=>{}); ws.close();
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
