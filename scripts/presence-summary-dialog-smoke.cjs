// Authenticated TEST origin only. Temporary response fixtures; no business writes.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/presence-summary-dialog');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0, mode = 'full'; const pending = new Map(), errors = [], results = [], writes = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timeout')); }, 12000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const statuses = ['working', 'trip', 'vacation', 'personal_time', 'late_arrival', 'sick_leave', 'business_event'];
  const fixture = data => {
    const start = '2026-10-04T04:00:00Z', end = '2026-10-10T13:00:00Z', stamp = '2026-10-01T09:00:00Z';
    const qaPeople = [...statuses, ...Array(12).fill('working')].map((status, n) => ({ id: 'qa-presence-' + n, name: n === 2 ? 'Малика Нурова — длинное полное имя сотрудника' : 'Сотрудник примера ' + n,
      initials: 'СП', role: 'employee', color: '#a7eacc', jobTitle: n === 2 ? 'Председатель движения и руководитель отдела по работе с региональными подразделениями' : 'Специалист', status: 'active' }));
    data.people = [...data.people, ...qaPeople, { id: 'qa-presence-actor', name: 'Согласующий из истории', initials: 'СИ', role: 'manager', color: '#e0cca0', status: 'active' }];
    data.presenceSummary = mode === 'empty' ? [] : qaPeople.map((p, n) => ({ userId: p.id, status: statuses[n] ?? 'working', startsAt: n > 0 && n < 7 ? start : null, endsAt: n > 0 && n < 7 ? end : null }));
    data.absenceRequests = mode === 'full' ? statuses.slice(2).map((kind, n) => ({ id: 'qa-presence-request-' + n, requesterUserId: qaPeople[n + 2].id, directManagerUserId: data.currentUser.id, kind,
      reason: kind === 'vacation' ? 'Семейная поездка и встреча с родными.\nПодробное описание причины отсутствия, которое должно спокойно переноситься внутри окна даже на узком экране. ' + 'Длинныйтекстбезпробелов'.repeat(12) : 'Пример причины для проверки окна: ' + kind,
      startsAt: start, endsAt: end, status: ['late_arrival', 'sick_leave'].includes(kind) ? 'acknowledged' : 'approved', statusLabel: 'Подтверждено', documentStatus: 'not_required', canEdit: false, allowedActions: [],
      actions: [{ id: 'qa-action-' + n, actorUserId: 'qa-presence-actor', action: ['late_arrival', 'sick_leave'].includes(kind) ? 'acknowledge' : 'approve', createdAt: stamp }], createdAt: stamp, updatedAt: stamp })) : [];
    return data;
  };
  const fulfill = (requestId, body, status = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data), entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); m.error ? entry.reject(Error(m.error.message)) : entry.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params, url = new URL(p.request.url);
    try {
      if (p.responseStatusCode && url.pathname === '/api/v1/workspace/bootstrap') {
        const response = await send('Fetch.getResponseBody', { requestId: p.requestId });
        const data = JSON.parse(response.base64Encoded ? Buffer.from(response.body, 'base64').toString() : response.body);
        await fulfill(p.requestId, fixture(data));
      } else if (p.request.method === 'GET' || url.pathname === '/api/v1/auth/web/refresh') await send('Fetch.continueRequest', { requestId: p.requestId });
      else { writes.push(url.pathname); await fulfill(p.requestId, { detail: 'Read-only UI QA' }, 403); }
    } catch (e) { errors.push(e.message); await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, r.exceptionDetails?.text); return r.result.value; };
  const waitFor = async expression => { for (let n = 0; n < 70; n++) { if (await evaluate(expression)) return; await pause(120); } throw Error('Missing UI: ' + expression); };
  const key = async (key, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, modifiers }); await pause(100); };
  const open = async status => {
    await evaluate(`(()=>{const b=document.querySelector('.absence-summary > [data-presence-status=${status}]');b.scrollIntoView({block:'nearest'});b.focus();b.click()})()`);
    await waitFor("!!document.querySelector('.presence-summary-dialog')"); await pause(320);
  };
  const close = async status => {
    await key('Escape'); await waitFor("!document.querySelector('.presence-summary-dialog')"); await pause(200);
    assert(await evaluate(`document.activeElement.matches('.absence-summary > [data-presence-status=${status}]')`), 'Restore triggering tile');
  };
  const navigate = async () => {
    await waitFor("!!document.querySelector('.rail-toggle')");
    await evaluate("if(!document.querySelector('[data-navigation-key=absences] button'))document.querySelector('.rail-more-action')?.click()"); await pause(200);
    await evaluate("document.querySelector('[data-navigation-key=absences] button').click()"); await waitFor("!!document.querySelector('.absence-summary')");
  };
  const shot = async name => {
    const clip = await evaluate("(()=>{const r=document.querySelector('.presence-summary-dialog').getBoundingClientRect();return {x:Math.max(0,r.x-8),y:Math.max(0,r.y-8),width:Math.min(innerWidth,r.width+16),height:Math.min(innerHeight,r.height+16),scale:1}})()");
    const r = await send('Page.captureScreenshot', { format: 'png', clip }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out, { recursive: true }); await send('Page.enable'); await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/v1/*', requestStage: 'Request' }, { urlPattern: origin + '/api/v1/workspace/bootstrap', requestStage: 'Response' }] });
    await send('Page.reload', { ignoreCache: true }); await navigate();
    for (const status of statuses) {
      await open(status);
      const text = await evaluate("document.querySelector('.presence-summary-dialog').textContent");
      if (status === 'working') { assert(text.includes('отметки начала рабочего дня')); assert.equal(await evaluate("document.querySelectorAll('.presence-summary-person').length"), 13); }
      else if (status === 'trip') assert(text.includes('недоступны'));
      else { assert(text.includes('Согласующий из истории')); assert(text.includes(status === 'vacation' ? 'Семейная поездка' : 'Пример причины')); assert(text.includes(['late_arrival', 'sick_leave'].includes(status) ? 'Получение подтвердил(а)' : 'Согласовал(а)')); }
      await close(status);
    }
    console.log('PASS all seven category lists, exact matching and acknowledgement wording');
    for (const [width, height] of [[1440, 900], [1024, 768], [640, 480], [360, 640], [320, 568], [720, 450]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(200); await open('vacation');
      const metrics = await evaluate(`(()=>{const d=document.querySelector('.presence-summary-dialog'),r=d.getBoundingClientRect(),c=d.querySelector('.presence-summary-content'),f=d.querySelector('.fui-DialogActions').getBoundingClientRect(),t=d.querySelector('.fui-DialogTitle').getBoundingClientRect(),x=d.querySelector('.presence-summary-heading > button').getBoundingClientRect();return {viewport:[innerWidth,innerHeight],left:r.left,right:r.right,top:r.top,bottom:r.bottom,center:[r.x+r.width/2-innerWidth/2,r.y+r.height/2-innerHeight/2],overflow:d.scrollWidth>d.clientWidth,contentOverflow:c.scrollWidth>c.clientWidth,footerBottom:f.bottom,headerCenters:[t.y+t.height/2,x.y+x.height/2],closeRight:x.right,text:d.textContent,avatarCount:d.querySelectorAll('.fui-Avatar').length}})()`);
      assert(!metrics.overflow && !metrics.contentOverflow, 'No horizontal overflow '+JSON.stringify(metrics));
      assert(metrics.left >= 15 && metrics.right <= width - 15 && metrics.top >= 15 && metrics.bottom <= height - 15, 'Fits viewport '+JSON.stringify(metrics));
      assert(metrics.center.every(n => Math.abs(n) < 1), 'Centered dialog'); assert(metrics.footerBottom <= metrics.bottom); assert.equal(metrics.avatarCount, 2);
      assert(Math.abs(metrics.headerCenters[0]-metrics.headerCenters[1])<1, 'Close aligned with title'); assert(metrics.closeRight>metrics.right-40, 'Close at right edge');
      for (let n = 0; n < 5; n++) { await key('Tab'); assert(await evaluate("document.querySelector('.presence-summary-dialog').contains(document.activeElement)"), 'Focus trap'); }
      await shot(width+'x'+height); await close('vacation'); results.push(metrics); console.log('PASS',width+'x'+height,'centered, wrapped text, visible footer, keyboard focus');
    }
    await open('working');
    assert(await evaluate("document.querySelector('.presence-summary-content').scrollHeight>document.querySelector('.presence-summary-content').clientHeight"), 'Long list scrolls internally');
    await shot('long-list'); await close('working');
    await open('sick_leave'); await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }); await pause(220); await shot('forced-colors');
    assert(await evaluate("getComputedStyle(document.querySelector('.presence-summary-dialog')).boxShadow==='none'")); await close('sick_leave');
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await open('vacation'); await shot('reduced-motion'); await close('vacation');
    mode = 'restricted'; await send('Page.reload', { ignoreCache: true }); await navigate(); await open('vacation');
    assert(await evaluate("document.querySelector('.presence-summary-dialog').textContent.includes('недоступны')&&!document.querySelector('.presence-summary-dialog').textContent.includes('Семейная поездка')")); await close('vacation');
    mode = 'empty'; await send('Page.reload', { ignoreCache: true }); await navigate();
    for (const status of statuses) { await open(status); assert(await evaluate("!!document.querySelector('.presence-summary-empty')")); await close(status); }
    assert(!writes.some(p=>p.startsWith('/api/v1/absences')), 'Opening/closing must not change absences'); assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2)); console.log('PASS empty categories, restricted details, forced colors/reduced motion; no absence writes');
  } finally {
    await send('Fetch.disable'); await send('Emulation.setEmulatedMedia', { features: [] }); await send('Emulation.setDeviceMetricsOverride', { ...original, mobile: false }); await send('Page.reload', { ignoreCache: true }); ws.close();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
