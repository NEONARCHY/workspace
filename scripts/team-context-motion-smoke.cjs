// TEST origin only. Team marks are fixtures; all business writes are blocked.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/team-context-motion');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0, working = false; const pending = new Map(), errors = [], results = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timeout')); }, 12000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const fixture = () => ({ asOf: '2026-10-04T01:32:00Z', workingCount: working ? 2 : 0,
    members: ['Азиза Каримова', 'Бахтиёр Самугов', 'Дилшод Рахимов', 'Малика Нурова'].map((name, n) => ({
      userId: 'qa-motion-' + n, name, jobTitle: n === 3 ? 'Председатель движения, руководитель региональных подразделений и координационного совета организации' : n === 1 ? 'Руководитель отдела по работе с региональными подразделениями' : 'Специалист',
      status: working && n < 2 ? 'working' : n === 3 ? 'finished' : 'weekend_off',
      schedule: { userId: 'qa-motion-' + n, startsAt: '09:00:00', endsAt: '18:00:00' },
      session: n === 3 || working && n < 2 ? { id: 'qa-session-' + n, userId: 'qa-motion-' + n, workDate: '2026-10-04', startedAt: '2026-10-04T01:18:00Z', endedAt: n === 3 ? '2026-10-04T01:32:00Z' : null, scheduledStartAt: '2026-10-04T04:00:00Z', scheduledEndAt: '2026-10-04T13:00:00Z', closedAt: n === 3 ? '2026-10-04T01:32:00Z' : null, closeSource: n === 3 ? 'manual' : null, isWeekend: true } : null,
      absenceKind: null, canEditSchedule: n < 3,
    })) });
  const fulfill = (requestId, body, status = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data), entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); m.error ? entry.reject(Error(m.error.message)) : entry.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params, url = new URL(p.request.url);
    try {
      if (p.request.method === 'GET' && url.pathname === '/api/v1/workday/team') await fulfill(p.requestId, fixture());
      else if (p.request.method === 'GET' || url.pathname === '/api/v1/auth/web/refresh') await send('Fetch.continueRequest', { requestId: p.requestId });
      else await fulfill(p.requestId, { detail: 'Read-only UI QA' }, 403);
    } catch (e) { errors.push(e.message); await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, r.exceptionDetails?.text); return r.result.value; };
  const waitFor = async expression => { for (let n = 0; n < 70; n++) { if (await evaluate(expression)) return; await pause(120); } throw Error('Missing UI: ' + expression); };
  const click = async selector => {
    const p = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing control');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...p });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...p });
  };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64')); };
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out, { recursive: true }); await send('Page.enable'); await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/v1/*', requestStage: 'Request' }] });
    await send('Page.reload', { ignoreCache: true }); await waitFor("!!document.querySelector('.rail-toggle')");
    await evaluate("if(!document.querySelector('[data-navigation-key=team_overview] button'))document.querySelector('.rail-more-action')?.click()"); await pause(250);
    await evaluate("document.querySelector('[data-navigation-key=team_overview] button').click()");
    await waitFor("!!document.querySelector('.team-presence-empty')"); await pause(400);
    // Record WAAPI calls as well as settled geometry. CDP round-trip latency
    // must not turn a correctly completed 220 ms transition into a failure.
    await evaluate("window.qaContextFrames=[];const qaRoot=document.querySelector('.team-presence-people'),qaAnimate=qaRoot.animate;qaRoot.animate=function(frames,options){window.qaContextFrames.push(frames);return qaAnimate.call(this,frames,options)}");
    for (const [width, height] of [[1440,900],[1106,850],[1024,768],[640,480],[360,640]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(250);
      const empty = await evaluate("document.querySelector('.team-presence-people').getBoundingClientRect().height"); assert(empty <= (width < 400 ? 75 : 45), 'Compact empty state including wrapped text: '+empty);
      await evaluate("window.qaContextFrames=[]");
      await click('.team-presence-filter > button:nth-child(2)');
      const mid = await evaluate("window.qaContextFrames");
      assert(mid.some(frames=>frames.some(f=>f.height)), 'Animated expansion');
      await pause(380);
      const metrics = await evaluate(`(()=>{const root=document.querySelector('.team-presence-people'),panel=document.querySelector('.team-presence-panel'),scope=document.querySelector('.team-dashboard > .employee-scope-switch'),focus=document.querySelector('.team-focus-strip');const rect=e=>e.getBoundingClientRect();return {
        rows:[...root.querySelectorAll('.team-presence-person')].map(row=>['.team-presence-status','.team-presence-times','.team-presence-schedule','.team-presence-actions'].map(s=>rect(row.querySelector(s)).left)),
        heights:[root.offsetHeight,root.scrollHeight],overflow:root.scrollWidth>root.clientWidth,
        gaps:[rect(scope).top-rect(panel).bottom,rect(focus.querySelector('button')).top-rect(scope).bottom],scopeLines:[...scope.querySelectorAll('button')].map(b=>[rect(b).height,getComputedStyle(b).whiteSpace]),
        text:root.textContent,viewport:[innerWidth,innerHeight],pageOverflow:document.documentElement.scrollWidth>innerWidth,
      }})()`);
      assert.equal(metrics.rows.length,4); assert(!metrics.overflow, 'List horizontal overflow '+JSON.stringify(metrics)); assert(!metrics.pageOverflow);
      for (let c=0;c<4;c++) assert(metrics.rows.every(row=>Math.abs(row[c]-metrics.rows[0][c])<1), 'Shared column '+c);
      assert(metrics.text.includes('координационного совета организации')); assert(metrics.text.includes('Завершил работу'));
      assert(metrics.gaps.every(g=>Math.abs(g-12)<1), 'Equal 12px gaps '+metrics.gaps); assert(metrics.scopeLines.every(b=>b[1]==='nowrap'));
      await shot('all-'+width); results.push(metrics);
      await click('.team-presence-filter > button:first-child'); await pause(380);
      assert(await evaluate(`!!document.querySelector('.team-presence-empty') && Math.abs(document.querySelector('.team-presence-people').getBoundingClientRect().height-${empty})<1`));
      // Rapid reversal finishes at the actual state, never at a stale fixed height.
      await click('.team-presence-filter > button:nth-child(2)'); await pause(50); await click('.team-presence-filter > button:first-child'); await pause(380);
      assert(await evaluate(`Math.abs(document.querySelector('.team-presence-people').getBoundingClientRect().height-${empty})<1`));
      console.log('PASS',width+'x'+height,'aligned columns, 12px gaps, expansion/collapse and rapid reversal');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1106, height: 850, deviceScaleFactor: 1, mobile: false });
    working = true; await click('.team-presence-toolbar-meta button'); await waitFor("document.querySelectorAll('.team-presence-person').length===2"); await pause(350);
    await click('.team-presence-filter > button:nth-child(2)'); await pause(350);
    await click('.team-presence-filter > button:first-child'); await pause(350);
    assert(await evaluate("document.querySelectorAll('.team-presence-person').length===2"));
    for(const features of [[{name:'prefers-reduced-motion',value:'reduce'}],[{name:'forced-colors',value:'active'}]]) {
      await send('Emulation.setEmulatedMedia',{features}); await click('.team-presence-filter > button:nth-child(2)');
      assert(await evaluate("document.querySelectorAll('.team-presence-person').length===4 && document.querySelector('.team-presence-people').getAnimations({subtree:true}).every(a=>a.playState!=='running')"));
      await shot(features[0].name); await click('.team-presence-filter > button:first-child');
    }
    await send('Emulation.setEmulatedMedia',{features:[]}); await pause(250);
    // Refresh with unchanged context must not restart decorative motion.
    await click('.team-presence-toolbar-meta button'); await pause(70);
    assert(await evaluate("document.querySelector('.team-presence-people').getAnimations({subtree:true}).every(a=>a.playState!=='running')"));
    await click('.team-dash-metric.tone-review');
    assert(await evaluate("document.querySelector('.team-dash-attention-list').getAnimations().some(a=>a.playState==='running')")); await pause(250);
    await click('.team-dash-filters button:nth-child(2)');
    assert(await evaluate("document.querySelector('.team-dash-people').getAnimations().some(a=>a.playState==='running')")); await pause(250);
    // Notification filters animate, while typing in the search does not.
    await evaluate("if(!document.querySelector('[data-navigation-key=notifications] button'))document.querySelector('.rail-more-action')?.click()"); await pause(250);
    await evaluate("document.querySelector('[data-navigation-key=notifications] button').click()"); await waitFor("!!document.querySelector('.notification-stream')"); await pause(300);
    await click('.notification-metrics > button:nth-child(3)');
    assert(await evaluate("document.querySelector('.notification-stream').getAnimations().some(a=>a.playState==='running')")); await pause(250);
    await click('.notification-kind-filters > button:nth-child(2)');
    assert(await evaluate("document.querySelector('.notification-stream').getAnimations().some(a=>a.playState==='running')")); await pause(250);
    await click('.notification-header input'); await send('Input.insertText',{text:'нет такого события'}); await pause(60);
    assert(await evaluate("document.querySelector('.notification-stream').getAnimations().every(a=>a.playState!=='running')"));
    // Native details reopen smoothly without destroying field values.
    await evaluate("document.querySelector('[data-navigation-key=tasks] button').click()"); await waitFor("!!document.querySelector('.tasks-view .task-toolbar-actions')");
    await evaluate("[...document.querySelectorAll('.task-toolbar-actions button')].find(b=>b.textContent.includes('Новая задача')).click()");
    await waitFor("!!document.querySelector('.record-disclosure')"); await pause(300);
    await click('.record-disclosure > summary'); await pause(40);
    assert(await evaluate("document.querySelector('.record-disclosure[open] .record-disclosure-body').getAnimations().some(a=>a.constructor.name==='Animation' && a.playState==='running')")); await pause(200);
    await click('.record-disclosure > summary'); await pause(40); await click('.record-disclosure > summary'); await pause(40);
    assert(await evaluate("document.querySelector('.record-disclosure[open] .record-disclosure-body').getAnimations().some(a=>a.constructor.name==='Animation' && a.playState==='running')"));
    await evaluate("document.querySelector('button[aria-label=\"Закрыть форму создания\"]').click()");
    assert.deepEqual(errors, []); await fs.writeFile(path.join(out,'report.json'),JSON.stringify(results,null,2));
    console.log('PASS working/attention/workload/notification filters, stable refresh/search, repeated form disclosure, reduced motion and forced colors; no business writes');
  } finally {
    await send('Fetch.disable').catch(()=>{}); await send('Emulation.setEmulatedMedia',{features:[]}).catch(()=>{});
    await send('Emulation.setDeviceMetricsOverride',{...original,mobile:false}).catch(()=>{});
    await send('Page.reload',{ignoreCache:true}).catch(()=>{}); ws.close();
  }
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
