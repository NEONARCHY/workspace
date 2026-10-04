// TEST LAN only. Assistant history/replies are fixtures; all business writes are blocked.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path');
const origin = 'https://192.168.31.176:8443', out = path.resolve('tmp/assistant-chat');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function main() {
  const page = (await (await fetch('http://127.0.0.1:9224/json')).json()).find(p => p.type === 'page' && p.url.startsWith(origin));
  assert(page, 'Open authenticated TEST browser');
  const ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0, history = [], nextDraft, failNext = false;
  const pending = new Map(), errors = [], writes = [], sent = [], results = [];
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id, timer = setTimeout(() => { pending.delete(key); reject(Error(method + ' timeout')); }, 15000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
  });
  const fulfill = (requestId, body, status = 200) => send('Fetch.fulfillRequest', { requestId, responseCode: status,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') });
  ws.onmessage = async e => {
    const m = JSON.parse(e.data), entry = pending.get(m.id);
    if (entry) { pending.delete(m.id); clearTimeout(entry.timer); m.error ? entry.reject(Error(m.error.message)) : entry.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text);
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params, url = new URL(p.request.url);
    try {
      if (url.pathname === '/api/v1/assistant/messages') {
        if (p.request.method === 'GET') await fulfill(p.requestId, history);
        else {
          sent.push(JSON.parse(p.request.postData));
          if (failNext) { failNext = false; await fulfill(p.requestId, { detail: 'Проверка восстановления ввода' }, 502); }
          else await fulfill(p.requestId, { id: 'qa-answer-' + sent.length, role: 'assistant', model: 'flash-lite',
            content: nextDraft ? 'Черновик готов. Проверьте форму перед сохранением.' : 'Это временный ответ для проверки интерфейса.',
            createdAt: new Date().toISOString(), ...(nextDraft ? { actionDraft: nextDraft } : {}) });
        }
      } else if (p.request.method === 'GET' || url.pathname === '/api/v1/auth/web/refresh') await send('Fetch.continueRequest', { requestId: p.requestId });
      else { writes.push(url.pathname); await fulfill(p.requestId, { detail: 'Read-only UI QA' }, 403); }
    } catch (e) { errors.push(e.message); await send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }).catch(() => {}); }
  };
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); assert(!r.exceptionDetails, r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text); return r.result.value; };
  const waitFor = async expression => { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await pause(100); } throw Error('Missing UI: ' + expression); };
  const click = label => evaluate(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)})?.click()`);
  const type = value => evaluate(`(()=>{const e=document.querySelector('.assistant-composer textarea');e.focus();Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  const field = name => `[...document.querySelectorAll('[role=dialog][aria-modal=true] input,[role=dialog][aria-modal=true] textarea')].find(e=>e.getAttribute('aria-label')?.includes(${JSON.stringify(name)})||e.closest('label')?.textContent.includes(${JSON.stringify(name)})||[...(e.labels??[])].some(l=>l.textContent.includes(${JSON.stringify(name)}))||(e.getAttribute('aria-labelledby')??'').split(' ').some(id=>document.getElementById(id)?.textContent.includes(${JSON.stringify(name)})))`;
  const open = async () => {
    await send('Page.reload', { ignoreCache: true }); await waitFor("!!document.querySelector('.assistant-launcher')");
    await evaluate("document.querySelector('.assistant-launcher').click()"); await waitFor("!!document.querySelector('.assistant-composer textarea')"); await pause(350);
  };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); await fs.writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64')); };
  const check = async () => {
    const m = await evaluate(`(()=>{const panel=document.querySelector('.assistant-panel'),editor=panel.querySelector('textarea'),s=panel.querySelector('.assistant-stream'),rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {viewport:[innerWidth,innerHeight],panel:rect(panel),editorBorder:getComputedStyle(editor).borderWidth,editorShadow:getComputedStyle(editor).boxShadow,editorOutline:getComputedStyle(editor).outlineStyle,overflow:panel.scrollWidth>panel.clientWidth,streamOverflow:s.scrollWidth>s.clientWidth,buttons:[...panel.querySelectorAll('.assistant-composer-toolbar button')].map(rect),toolbar:rect(panel.querySelector('.assistant-composer-toolbar')),details:!!panel.querySelector('details'),inputValue:editor.value}})()`);
    assert(!m.overflow && !m.streamOverflow, 'No horizontal overflow'); assert(!m.details, 'No answer preparation expander');
    assert.equal(m.editorBorder, '0px'); assert.equal(m.editorShadow, 'none'); assert.equal(m.editorOutline, 'none');
    assert(m.panel.left >= 0 && m.panel.top >= 0 && m.panel.right <= m.viewport[0] + 1 && m.panel.bottom <= m.viewport[1] + 1, 'Panel inside viewport');
    assert(m.buttons.every(b => b.left >= m.toolbar.left - 1 && b.right <= m.toolbar.right + 1 && b.bottom <= m.panel.bottom), 'All composer buttons fit');
    results.push(m); return m;
  };
  const transfer = (target, mode, name = 'qa-note.txt') => evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File(['Temporary UI fixture'],${JSON.stringify(name)},{type:'text/plain'}));const e=document.querySelector(${JSON.stringify(target)});e.dispatchEvent(${mode === 'paste' ? "new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:d})" : "new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:d})"})})()`);
  const original = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio})');
  try {
    await fs.mkdir(out, { recursive: true }); await send('Page.enable'); await send('Runtime.enable');
    await send('Fetch.enable', { patterns: [{ urlPattern: origin + '/api/v1/*', requestStage: 'Request' }] });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await open(); await waitFor("!!document.querySelector('.assistant-quick-prompts')"); await check(); await shot('mini-empty');
    await type('Черновик не должен пропасть'); await transfer('.assistant-composer textarea', 'paste');
    await waitFor("document.querySelector('.assistant-file-chip')?.textContent.includes('qa-note.txt')"); assert.equal(sent.length, 0);
    await click('Развернуть окно'); await pause(90);
    const mid = await evaluate("({width:document.querySelector('.assistant-panel').getBoundingClientRect().width,animations:document.querySelector('.assistant-panel').getAnimations().filter(a=>a.playState==='running').length})");
    assert(mid.width > 460 && mid.width < 1416 && mid.animations > 0, 'Smooth real-size expansion'); await pause(300);
    assert.equal((await check()).inputValue, 'Черновик не должен пропасть'); await shot('expanded-empty');
    await transfer('.assistant-header', 'drop', 'header-drop.txt'); await waitFor("document.querySelector('.assistant-file-chip')?.textContent.includes('header-drop.txt')");
    failNext = true; await click('Отправить сообщение'); await waitFor("!!document.querySelector('.assistant-error')");
    assert.equal((await check()).inputValue, 'Черновик не должен пропасть'); assert(await evaluate("document.querySelector('.assistant-file-chip').textContent.includes('header-drop.txt')"));
    await click('Убрать вложение');
    history = [{ id: 'qa-old', role: 'assistant', model: 'flash-lite', createdAt: new Date().toISOString(),
      content: '# Рабочая заметка\n\n' + 'Длинный ответ остаётся читаемым и переносится внутри окна. '.repeat(30),
      sourceLabels: ['Stored source metadata'], references: [{ label: 'Открыть доступные задачи', section: 'tasks', entityId: null }] }];
    await open();
    for (const [width, height] of [[1440,900],[1024,768],[640,480],[360,640],[320,568]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); await pause(250);
      await type('Пример вопроса'); await check(); await shot('history-' + width);
      await click('Развернуть окно'); await pause(300); await check(); await shot('history-expanded-' + width);
      await click('Свернуть окно'); await pause(300);
      console.log('PASS', width + 'x' + height, 'mini/max, composer and history');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.documentElement.style.zoom='2'"); await pause(300); await check(); await shot('reflow-2x');
    await evaluate("document.documentElement.style.zoom=''"); await pause(250);
    for (const [kind, fields, name, expected] of [
      ['task', { title: 'Проверить отчёт', description: 'Тестовый черновик' }, 'Название задачи', 'Проверить отчёт'],
      ['project', { title: 'Проект команды', code: 'QA-30', description: 'Тестовый черновик' }, 'Название проекта', 'Проект команды'],
      ['trip', { purpose: 'Встреча команды', destination: 'Навои', startDate: '2030-10-01', endDate: '2030-10-02' }, 'Цель поездки', 'Встреча команды'],
      ['absence', { reason: 'Болезнь', absenceKind: 'sick_leave', startDate: '2030-10-01', endDate: '2030-10-02' }, 'Причина', 'Болезнь'],
    ]) {
      history = []; nextDraft = { kind, fields, ready: true }; await open();
      await type('Проверка заполненной формы'); await click('Отправить сообщение');
      await waitFor("!!document.querySelector('.assistant-action-draft')");
      await evaluate("[...document.querySelectorAll('.assistant-draft-actions button')].find(b=>b.textContent==='Открыть заполненную форму').click()");
      await waitFor(`!!(${field(name)})`);
      assert.equal(await evaluate(`(${field(name)}).value`), expected);
      assert.equal(writes.length, 0, 'Opening a prepared form creates no business record'); await shot('prepared-' + kind);
      await evaluate("[...document.querySelectorAll('[role=dialog][aria-modal=true] button')].find(b=>b.textContent.trim()==='Отмена')?.click()");
      await pause(300); console.log('PASS prepared', kind, 'editable form, no writes');
    }
    nextDraft = undefined; history = []; await open();
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await pause(100);
    await click('Развернуть окно'); await pause(30);
    assert.equal(await evaluate("document.querySelector('.assistant-panel').getAnimations().filter(a=>a.playState==='running').length"), 0);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }); await pause(100);
    await click('Свернуть окно'); await pause(30); await shot('forced-colors');
    assert.equal(await evaluate("document.querySelector('.assistant-panel').getAnimations().filter(a=>a.playState==='running').length"), 0);
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    await fs.writeFile(path.join(out, 'results.json'), JSON.stringify({ results, requests: sent.length, businessWrites: writes.length, errors }, null, 2));
    console.log('PASS paste/drop, failed-send recovery, resize animation, 2x reflow, four forms, reduced motion/forced colors; no business writes');
  } catch (error) {
    await shot('failure');
    console.error('Assistant feedback:', await evaluate("document.querySelector('.assistant-error')?.textContent ?? 'none'"));
    console.error('Dialog field labels:', await evaluate("[...document.querySelectorAll('[role=dialog]')].map(d=>({modal:d.getAttribute('aria-modal'),fields:[...d.querySelectorAll('input,textarea')].map(e=>({tag:e.tagName,label:e.getAttribute('aria-label'),labelledby:e.getAttribute('aria-labelledby'),labels:[...(e.labels??[])].map(l=>l.textContent)}))}))"));
    throw error;
  } finally {
    await evaluate("document.documentElement.style.zoom=''").catch(() => {});
    await send('Fetch.disable'); await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.setDeviceMetricsOverride', { ...original, mobile: false }); await send('Page.reload', { ignoreCache: true }); ws.close();
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
