// Real components and production styles; all requests are fulfilled in this process.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const phase = process.argv.includes('--before') ? 'before' : 'after';
const origin = process.env.UI_QA_ORIGIN || 'http://127.0.0.1:5194';
assert(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const output = path.resolve('tmp/ui-consistency-iteration-14');
const configurations = [[1440, 960, 'dark'], [1440, 960, 'light'], [1024, 768, 'dark'], [320, 800, 'dark'], [390, 844, 'dark'], [430, 900, 'dark'], [390, 844, 'light'], [720, 480, 'dark']];
const sections = ['access', 'departments', 'sidebar'];
const errors = [], results = [];
(async () => {
  const temporary = [];
  // Use exactly the production CSS imports, without mounting App or a real session.
  const main = await fs.readFile('apps/desktop/src/renderer/main.tsx', 'utf8');
  await fs.writeFile('apps/desktop/qa/admin-iteration-14-styles.css', [...main.matchAll(/import "\.\/([^"\n]+\.css)"/g)].map(match => `@import "../src/renderer/${match[1]}";`).join('\n'));
  if (phase === 'before') {
    const base = process.env.UI_QA_BASE || 'e30f775e4230804b26a60fd546dc9218f2288858';
    assert(/^[a-f0-9]{40}$/.test(base));
    for (const name of ['ModuleAccessManagement', 'DepartmentManagement', 'SidebarVisibilityManagement']) {
      const filename = `apps/desktop/src/renderer/${name}.iteration-14-before.tsx`;
      await fs.writeFile(filename, execFileSync('git', ['show', `${base}:apps/desktop/src/renderer/${name}.tsx`]));
      temporary.push(filename);
    }
    let fixture = await fs.readFile('apps/desktop/qa/admin-iteration-14.tsx', 'utf8');
    for (const name of ['ModuleAccessManagement', 'DepartmentManagement', 'SidebarVisibilityManagement']) fixture = fixture.replace(`/${name}"`, `/${name}.iteration-14-before"`);
    await fs.writeFile('apps/desktop/qa/admin-iteration-14-before.tsx', fixture);
    await fs.writeFile('apps/desktop/qa/admin-iteration-14-before.html', (await fs.readFile('apps/desktop/qa/admin-iteration-14.html', 'utf8')).replace('./admin-iteration-14.tsx', './admin-iteration-14-before.tsx'));
    temporary.push('apps/desktop/qa/admin-iteration-14-before.tsx', 'apps/desktop/qa/admin-iteration-14-before.html');
  }
  await fs.mkdir(path.join(output, phase), { recursive: true });
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const cases = phase === 'after' ? [...configurations,
      [720, 480, 'dark', 'none', 2, 'reflow-200'],
      [720, 480, 'light', 'none', 2, 'reflow-200'],
      [390, 844, 'light', 'active', 1, 'forced-colors'],
    ] : configurations;
    for (const [width, height, theme, forcedColors = 'none', deviceScaleFactor = 1, stress = ''] of cases) {
      if (process.env.UI_QA_WIDTH && width !== Number(process.env.UI_QA_WIDTH)) continue;
      const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce', forcedColors, deviceScaleFactor, hasTouch: width <= 430, isMobile: width <= 430 });
      const page = await context.newPage();
      page.on('pageerror', error => { errors.push(error.message); console.error('PAGE ERROR: ' + error.message); });
      page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
      let writes = 0;
      await page.route('**/api/v1/**', async route => {
        const request = route.request(), endpoint = new URL(request.url()).pathname.split('/api/v1')[1], method = request.method();
        if (method !== 'GET') writes++;
        const data = await page.evaluate(() => window.adminIteration14Data);
        const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
        if (/\/employees\/[^/]+\/sidebar$/.test(endpoint)) return json({ userId: endpoint.split('/').at(-2), hiddenKeys: ['zoom_meetings', 'mail'], revision: 4 });
        if (endpoint.startsWith('/directory/departments/')) {
          const department = data.departments.find(item => item.id === endpoint.split('/')[3]);
          return json({ ...department, ...request.postDataJSON() });
        }
        if (endpoint.startsWith('/directory/access-rules/')) {
          const [, , , subjectType, subjectKey, moduleKey] = endpoint.split('/');
          if (method === 'DELETE') return route.fulfill({ status: 204 });
          return json({ id: `qa-${subjectType}-${subjectKey}-${moduleKey}`, subjectType, subjectKey, moduleKey, permissions: request.postDataJSON().permissions });
        }
        throw new Error('Unexpected synthetic API request: ' + endpoint);
      });
      for (const section of sections) {
        await page.goto(`${origin}/qa/admin-iteration-14${phase === 'before' ? '-before' : ''}.html?section=${section}&theme=${theme}`);
        const dialog = page.getByRole('dialog'); await dialog.waitFor();
        await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 300)); });
        if (section === 'sidebar') await page.getByRole('checkbox', { name: 'Задачи', exact: true }).waitFor();
        const file = `${section}-${theme}-${width}${stress ? '-' + stress : ''}.png`;
        await page.mouse.move(0, 0); await page.screenshot({ path: path.join(output, phase, file) });
        const geometry = await dialog.evaluate(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, overflow: node.scrollWidth - node.clientWidth, pageOverflow: document.documentElement.scrollWidth - innerWidth, members: node.querySelectorAll('.department-member-row').length }; });
        results.push({ section, width, height, theme, stress, ...geometry });
        if (phase === 'after') await require('./ui-admin-iteration-14-checks.cjs')(page, section, { width, height, theme, geometry });
        console.log(`PASS ${phase} ${file}`);
      }
      if (phase === 'before') assert.equal(writes, 0);
      await context.close();
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(output, phase + '.json'), JSON.stringify({ results, errors }, null, 2));
    const labels = { access: 'Права модулей и должностей', departments: 'Подразделения', sidebar: 'Видимость меню' };
    await fs.writeFile(path.join(output, 'index.html'), `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Итерация 14 · до и после</title><style>body{margin:0;padding:24px;background:#111318;color:#eee;font:15px/1.5 system-ui}main{max-width:1600px;margin:auto}article{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{width:100%}select{padding:12px;margin-bottom:24px}@media(max-width:700px){article{grid-template-columns:1fr}}</style><main><h1>Итерация 14 · Администрирование</h1><p>Реальные компоненты и одинаковые синтетические данные. Нажмите на снимок для полного размера.</p><select id="size" aria-label="Тема и размер">${configurations.map(([w,h,t]) => `<option value="${t}-${w}">${w} × ${h} · ${t}</option>`).join('')}</select>${sections.map(section => `<section><h2>${labels[section]}</h2><article>${['before','after'].map(state => `<figure><figcaption>${state === 'before' ? 'До' : 'После'}</figcaption><a data-state="${state}" data-section="${section}" href="${state}/${section}-dark-1440.png"><img src="${state}/${section}-dark-1440.png" alt="${labels[section]} — ${state}"></a></figure>`).join('')}</article></section>`).join('')}<p>Подход: <a href="https://github.com/heydamir/unslop">unslop · Damir Sokolovsky · CC BY 4.0</a></p></main><script>document.querySelector('#size').onchange=e=>document.querySelectorAll('[data-state]').forEach(a=>{a.href=a.dataset.state+'/'+a.dataset.section+'-'+e.target.value+'.png';a.querySelector('img').src=a.href})</script></html>`);
  } finally { await browser.close(); for (const filename of temporary) await fs.unlink(filename); }
})().catch(error => { console.error(error); process.exitCode = 1; });
