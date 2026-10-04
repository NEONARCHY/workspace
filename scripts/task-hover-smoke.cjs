// Read-only visual regression against an existing TEST browser session.
// Usage: node scripts/task-hover-smoke.cjs [--preview]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const origin = 'https://192.168.31.176:8443';
const preview = process.argv.includes('--preview');
const output = path.resolve('tmp/task-hover-full-row');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const pages = await (await fetch('http://127.0.0.1:9224/json')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open the authenticated TEST site in the QA browser on port 9224.');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const pending = new Map(), errors = [], results = [];
  let id = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: ' + method)); }, 10000);
    pending.set(key, {resolve, reject, timer});
    ws.send(JSON.stringify({id: key, method, params}));
  });
  ws.onmessage = async event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (request) {
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.reject(Error(message.error.message)) : request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.text);
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params;
      try {
        if (request.request.method === 'GET' || new URL(request.request.url).pathname === '/api/v1/auth/web/refresh') {
          await send('Fetch.continueRequest', {requestId: request.requestId});
        } else {
          await send('Fetch.fulfillRequest', {requestId: request.requestId, responseCode: 403,
            body: Buffer.from('{"detail":"Visual QA is read-only"}').toString('base64')});
        }
      } catch (error) { errors.push(error.message); }
    }
  };
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true});
    assert(!result.exceptionDetails, result.exceptionDetails?.text);
    return result.result.value;
  };
  const screenshot = async name => fs.writeFile(path.join(output, `${preview ? 'preview' : 'final'}-${name}.png`),
    Buffer.from((await send('Page.captureScreenshot', {format: 'png'})).data, 'base64'));
  const state = selector => evaluate(`(() => {
    const row = document.querySelector(${JSON.stringify(selector)}), wash = row.querySelector('.list-row-hover-wash');
    const r = row.getBoundingClientRect(), w = wash.getBoundingClientRect(), c = getComputedStyle(wash);
    const title = row.querySelector('.record-title'), text = row.querySelector('strong').getBoundingClientRect();
    return {left:w.left-r.left, width:w.width, rowWidth:r.width, opacity:+c.opacity, pointer:c.pointerEvents,
      image:c.backgroundImage, duration:c.transitionDuration, transform:c.transform,
      titleImage:getComputedStyle(title).backgroundImage, titleColor:getComputedStyle(title).backgroundColor,
      accent:getComputedStyle(row).getPropertyValue('--row-hover-accent').trim(), textX:text.x, textY:text.y};
  })()`);
  const hover = async (selector, label) => {
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', x:1, y:1});
    await evaluate('document.activeElement?.blur()'); await pause(240);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center', inline:'start'})`);
    const before = await state(selector);
    const point = await evaluate(`(() => {const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+80,y:r.top+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', ...point}); await pause(65);
    const mid = await state(selector); await screenshot(label+'-enter'); await pause(260);
    const on = await state(selector); await screenshot(label+'-hover');
    assert(Math.abs(on.left) < 1, `Hover must start at the title: ${label}`);
    assert(Math.abs(on.width-on.rowWidth) < 1, `Hover must span the whole row: ${label} ${JSON.stringify(on)} ${JSON.stringify(point)}`);
    assert.equal(before.opacity, 0); assert.equal(on.opacity, 1); assert.equal(on.pointer, 'none');
    assert.equal(on.titleImage, 'none'); assert.equal(on.titleColor, 'rgba(0, 0, 0, 0)');
    assert(Math.abs(before.textX-on.textX)<.5 && Math.abs(before.textY-on.textY)<.5, 'Text moved');
    assert(mid.opacity>0 && mid.opacity<1, 'Missing smooth intermediate state');
    await send('Input.dispatchMouseEvent', {type:'mouseMoved', x:1, y:1}); await pause(260);
    assert.equal((await state(selector)).opacity, 0);
    results.push({label, before, mid, on});
    console.log('PASS', label, 'left edge 0; full width; smooth enter/exit; text stable');
  };
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(output, {recursive:true}); await send('Page.bringToFront'); await send('Runtime.enable');
    await send('Fetch.enable', {patterns:[{urlPattern:origin+'/api/v1/*',requestStage:'Request'}]});
    await send('Page.reload', {ignoreCache:true}); await pause(1800);
    for (let i=0; i<30 && !await evaluate("!!document.querySelector('.app-rail')"); i++) await pause(250);
    if (preview) {
      const css = await fs.readFile(path.resolve('apps/desktop/src/renderer/list-row-hover.css'), 'utf8');
      await evaluate(`(() => {const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)})()`);
    }
    for (const label of ['Задачи','Список']) {
      assert(await evaluate(`(() => {const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b)return false;b.click();return true})()`), 'Missing navigation: '+label);
      await pause(650);
    }
    for (const [width,height] of [[1440,900],[1024,768],[620,1100]]) {
      await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false}); await pause(300);
      for (const [priority,token] of [['normal','--ws-turquoise'],['high','--ws-accent-warning'],['urgent','--ws-accent-danger']]) {
        const selector = '.task-record-table .record-row:has(.task-record-signal.priority-'+priority+')';
        await hover(selector, width+'-'+priority);
        const expected = await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(token)}).trim()`);
        assert.equal(results.at(-1).on.accent, expected, 'Priority colour changed');
      }
      assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'Page overflows horizontally');
    }
    const normal = '.task-record-table .record-row:has(.priority-normal)';
    await evaluate(`document.querySelector(${JSON.stringify(normal)}).querySelector('.task-record-signal').classList.replace('priority-normal','priority-low')`);
    await hover('.task-record-table .record-row:has(.priority-low)', 'low');
    await evaluate("document.querySelector('.priority-low').classList.replace('priority-low','priority-normal')");
    await evaluate(`document.querySelector(${JSON.stringify(normal)}).classList.add('selected')`);
    await hover(normal+'.selected', 'selected'); assert.equal(results.at(-1).on.image, 'none');
    await evaluate(`document.querySelector(${JSON.stringify(normal)}).classList.remove('selected')`);
    await send('Emulation.setEmulatedMedia', {features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate(`document.querySelector(${JSON.stringify(normal)}).querySelector('button').focus()`);
    const reduced = await state(normal); assert.equal(reduced.transform, 'none'); assert(parseFloat(reduced.duration)<.001);
    await send('Emulation.setEmulatedMedia', {features:[{name:'forced-colors',value:'active'}]});
    assert.equal(await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(normal)}).querySelector('.list-row-hover-wash')).display`), 'none');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, `${preview?'preview':'final'}-report.json`), JSON.stringify(results,null,2));
    console.log('PASS reduced motion, forced colours, selected row; no renderer errors');
  } finally {
    await send('Fetch.disable'); await send('Emulation.setEmulatedMedia', {features:[]});
    await send('Emulation.setDeviceMetricsOverride', {...original,mobile:false});
    await send('Page.reload', {ignoreCache:true}); await pause(300); ws.close();
  }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
