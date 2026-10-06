// Authenticated TEST origin only. Populated deadlines are temporary response fixtures.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/team-flow-surface');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0, populated = false; const pending = new Map(), errors = [], results = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timeout')); }, 12000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const fulfill = (requestId, body, status = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data), entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); m.error ? entry.reject(Error(m.error.message)) : entry.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params, url = new URL(p.request.url);
    try {
      if (p.responseStatusCode && url.pathname === '/api/v1/workspace/bootstrap') {
        const raw = await send('Fetch.getResponseBody', { requestId: p.requestId });
        const data = JSON.parse(raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString() : raw.body);
        if (populated) {
          const template = data.tasks[0]; assert(template, 'Existing task shape for fixture');
          data.tasks = [0, 2, 1, 4, 0, 3, 1].flatMap((count, offset) => Array.from({ length: count }, (_, n) => {
            const due = new Date(); due.setDate(due.getDate() + offset); due.setHours(23, 59, 0, 0);
            return { ...template, id: `qa-flow-${offset}-${n}`, title: 'Временная проверка шкалы', status: n % 2 ? 'in_progress' : 'new', dueAt: due.toISOString(), priority: 'normal' };
          }));
        }
        await fulfill(p.requestId, data);
      } else if (p.request.method === 'GET' || url.pathname === '/api/v1/auth/web/refresh') await send('Fetch.continueRequest', { requestId: p.requestId });
      else await fulfill(p.requestId, { detail: 'Read-only UI QA' }, 403);
    } catch (e) { errors.push(e.message); await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text); return r.result.value; };
  const waitFor = async expression => { for (let n = 0; n < 75; n++) { if (await evaluate(expression)) return; await pause(120); } throw Error('Missing UI: ' + expression); };
  const open = async () => {
    await send('Page.reload', { ignoreCache: true }); await pause(300); await waitFor("!!document.querySelector('.rail-toggle')");
    await evaluate("if(!document.querySelector('[data-navigation-key=team_overview] button'))document.querySelector('.rail-more-action')?.click()"); await pause(180);
    await waitFor("!!document.querySelector('[data-navigation-key=team_overview] button')");
    await evaluate("document.querySelector('[data-navigation-key=team_overview] button').click()"); await waitFor("!!document.querySelector('.team-dash-week-bars')"); await pause(300);
  };
  const shot = async name => {
    await evaluate("document.querySelector('.team-dash-flow').scrollIntoView({block:'center'})"); await pause(100);
    const clip = await evaluate("(()=>{const r=document.querySelector('.team-dash-flow').getBoundingClientRect();const x=Math.max(0,r.x-6),y=Math.max(0,r.y-6);return {x,y,width:Math.min(innerWidth-x,r.width+12),height:Math.min(innerHeight-y,r.height+12),scale:1}})()");
    const r = await send('Page.captureScreenshot', { format: 'png', clip }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const metrics = () => evaluate(`(()=>{const flow=document.querySelector('.team-dash-flow'),week=flow.querySelector('.team-dash-week'),d=document.querySelector('.team-dashboard'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {
    viewport:[innerWidth,innerHeight],background:getComputedStyle(flow).backgroundColor,week:rect(week),overflow:d.scrollWidth>d.clientWidth,
    overview:rect(flow.querySelector('.team-dash-flow-overview')),legend:rect(flow.querySelector('.team-dash-flow-legend')),
    overviewScale:flow.querySelector('.team-dash-flow-overview').getBoundingClientRect().width/flow.querySelector('.team-dash-flow-overview').offsetWidth,
    legends:[...flow.querySelectorAll('.team-dash-flow-legend > button')].map(b=>{const s=getComputedStyle(b),label=b.querySelector('span'),count=b.querySelector('strong');return {button:rect(b),layoutHeight:b.offsetHeight,needed:Math.max(34,Math.max(label.offsetHeight,count.offsetHeight)+parseFloat(s.paddingTop)+parseFloat(s.paddingBottom)+parseFloat(s.borderTopWidth)+parseFloat(s.borderBottomWidth)),direction:s.flexDirection,countSize:getComputedStyle(count).fontSize,gradient:s.backgroundImage,pressed:b.getAttribute('aria-pressed'),label:rect(label),count:rect(count),labelOverflow:label.scrollWidth>label.clientWidth}}),
    days:[...week.querySelectorAll('.team-dash-week-bars > button')].map(b=>({button:rect(b),bar:rect(b.querySelector(':scope > span')),count:rect(b.querySelector('strong')),label:rect(b.querySelector('small')),labelOverflow:b.querySelector('small').scrollWidth>b.querySelector('small').clientWidth,transform:getComputedStyle(b.querySelector('small')).transform,value:Number(b.querySelector('strong').textContent),fill:b.querySelector('i').getBoundingClientRect().height,title:b.title,name:b.getAttribute('aria-label')}))
  }})()`);
  const check = m => {
    assert.equal(m.days.length, 7); assert(!m.overflow, 'Dashboard horizontal overflow');
    assert.equal(m.background, 'rgb(255, 255, 255)'); assert(m.legends.every(b => b.gradient.includes('linear-gradient')));
    assert.equal(m.legends.length, 4);
    assert(m.legends.every(b => !b.labelOverflow && b.label.right <= b.count.left - 3), 'Status names and counts do not overlap');
    assert(m.legends.every((b,index) => b.direction === 'row' && b.countSize === '14px' && b.layoutHeight <= Math.max(...m.legends.slice(index-index%2,index-index%2+2).map(other=>other.needed))+1), 'Content-sized horizontal status buttons at every width');
    assert(m.legends.every(b => Math.abs(b.button.width - m.legends[0].button.width) < 1), 'Equal status column widths');
    assert(Math.abs(m.legends[0].button.top - m.legends[1].button.top) < 1 && Math.abs(m.legends[2].button.top - m.legends[3].button.top) < 1 && m.legends[2].button.top > m.legends[0].button.bottom, 'Two rows of two compact buttons');
    assert(m.overview.bottom - m.legend.bottom < 17 * m.overviewScale, 'Only normal padding below statuses');
    for (const day of m.days) {
      assert(!day.labelOverflow, 'Caption fits its column'); assert.equal(day.transform, 'none');
      assert(day.label.left >= day.button.left - 1 && day.label.right <= day.button.right + 1, 'Caption inside button');
      assert(Math.abs((day.bar.left + day.bar.right) / 2 - (day.button.left + day.button.right) / 2) < 1, 'Centered bar');
      assert(day.label.top >= day.count.bottom - 1, 'Date does not overlap count'); assert(day.name && day.title);
      const row = m.days.filter(other => Math.abs(other.button.top - day.button.top) < 1);
      assert(row.every(other => Math.abs(other.bar.bottom - day.bar.bottom) < 1 && Math.abs(other.label.top - day.label.top) < 1), 'Shared bar baseline and caption rows');
    }
  };
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out, { recursive: true }); await send('Page.enable'); await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/v1/*', requestStage: 'Request' }, { urlPattern: origin + '/api/v1/workspace/bootstrap', requestStage: 'Response' }] });
    await open();
    for (const [width, height] of [[1600,1000],[1440,900],[1106,850],[1024,768],[760,700],[640,480],[360,640],[320,568]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(300);
      const m = await metrics(); check(m); await shot('empty-' + width); results.push(m); console.log('PASS', width+'x'+height, 'white surface, gradients, aligned bars/captions, no horizontal overflow');
    }
    populated = true; await open();
    for (const width of [1440, 1024, 640, 360]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(300);
      const m = await metrics(); check(m); assert.deepEqual(m.days.map(d=>d.value), [0,2,1,4,0,3,1]);
      assert(m.days[3].fill > m.days[2].fill && m.days[2].fill > m.days[0].fill, 'Filled scales retain relative values'); await shot('filled-' + width);
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }); await pause(250);
    await evaluate("document.documentElement.style.zoom='2'"); await pause(300); check(await metrics()); await shot('scaled-2x'); await evaluate("document.documentElement.style.zoom=''"); await pause(250);
    await evaluate("document.querySelector('.team-dash-flow-legend > .flow-new').focus();document.querySelector('.team-dash-flow-legend > .flow-new').click()"); await waitFor("!!document.querySelector('.team-dash-flow-drawer')");
    assert(await evaluate("document.querySelector('.flow-new').getAttribute('aria-pressed')==='true'"));
    await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' }); await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Escape', code:'Escape' }); await waitFor("!document.querySelector('.team-dash-flow-drawer')");
    await evaluate("document.querySelector('.team-dash-week-bars > button:nth-child(2)').click()"); await waitFor("!!document.querySelector('.team-dash-flow-drawer')");
    assert(await evaluate("document.querySelector('.team-dash-flow-drawer').textContent.includes('Временная проверка шкалы')"));
    await evaluate("document.querySelector('.team-dash-flow-drawer button[aria-label=\"Закрыть список задач\"]').click()"); await pause(200);
    await send('Emulation.setEmulatedMedia', { features:[{name:'forced-colors',value:'active'}] }); await pause(250); await shot('forced-colors');
    assert(await evaluate("getComputedStyle(document.querySelector('.flow-new')).backgroundImage==='none'"));
    await send('Emulation.setEmulatedMedia', { features:[{name:'prefers-reduced-motion',value:'reduce'}] }); await pause(250);
    assert(await evaluate("parseFloat(getComputedStyle(document.querySelector('.flow-new')).transitionDuration)<0.01"));
    assert.deepEqual(errors, []); await fs.writeFile(path.join(out,'results.json'), JSON.stringify(results,null,2));
    console.log('PASS populated/empty scales, 2x CSS reflow, category/day selection, Escape, forced colors/reduced motion; no business writes');
  } finally {
    await evaluate("document.documentElement.style.zoom=''").catch(()=>{}); await send('Fetch.disable'); await send('Emulation.setEmulatedMedia',{features:[]});
    await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false}); await send('Page.reload',{ignoreCache:true}); ws.close();
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
