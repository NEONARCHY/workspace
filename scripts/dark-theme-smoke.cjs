// Real-component visual audit. Synthetic QA data; no production API access.
const { chromium, webkit } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.resolve('tmp/dark-theme');
fs.mkdirSync(output, { recursive: true });
const report = [];
async function inspect(page, name) {
  return page.evaluate(name => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const cache = new Map();
    const rgba = color => {
      if (cache.has(color)) return cache.get(color);
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
      const p = [...ctx.getImageData(0, 0, 1, 1).data]; p[3] /= 255; cache.set(color, p); return p;
    };
    const composite = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3])).concat([1]);
    const luminance = color => color.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4)
      .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const backgrounds = element => {
      const chain = []; for (let node = element; node; node = node.parentElement) chain.unshift(node);
      let bg = rgba(getComputedStyle(document.documentElement).backgroundColor), gradient = false;
      for (const node of chain) {
        const style = getComputedStyle(node); bg = composite(rgba(style.backgroundColor), bg);
        if (style.backgroundImage !== 'none') {
          gradient = true;
          const colors = style.backgroundImage.match(/rgba?\([^)]*\)|color\([^)]*\)/g);
          if (colors?.length) bg = composite(rgba(colors[0]), bg);
        }
      }
      return { bg, gradient };
    };
    const contrast = [], islands = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let text; (text = walker.nextNode());) {
      const el = text.parentElement, value = text.textContent.trim();
      if (!el || !value || ['SCRIPT','STYLE','OPTION'].includes(el.tagName)) continue;
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      if (!box.width || !box.height || box.bottom < 0 || box.top > innerHeight || style.visibility !== 'visible' || el.closest('[hidden],[aria-hidden="true"],:disabled,[aria-disabled="true"]')) continue;
      if (Number(style.opacity) < .99 || el.closest('.color-theme-preview,.sidebar-theme-swatch,.fui-Avatar,.recognition-card-foil')) continue;
      const { bg, gradient } = backgrounds(el), fg = composite(rgba(style.color), bg);
      if (rgba(style.color)[3] === 0) continue; // Intentionally invisible backing text in the existing gooey search.
      const ratio = (Math.max(luminance(bg), luminance(fg)) + .05) / (Math.min(luminance(bg), luminance(fg)) + .05);
      const large = parseFloat(style.fontSize) >= 24 || parseFloat(style.fontSize) >= 18.67 && Number(style.fontWeight) >= 700;
      if (ratio + .01 < (large ? 3 : 4.5)) contrast.push({ text: value.slice(0, 95), class: el.className, ratio: Number(ratio.toFixed(2)), color: style.color, background: bg.slice(0, 3), gradient });
    }
    for (const el of document.querySelectorAll('body *')) {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el), color = rgba(style.backgroundColor);
      if (box.width < 100 || box.height < 24 || box.bottom < 0 || box.top >= innerHeight || color[3] < .8 || style.visibility !== 'visible') continue;
      if (luminance(color) > .55 && !el.closest('.color-theme-preview,.sidebar-theme-swatch,.file-viewer-page')) islands.push({ class: el.className, tag: el.tagName, bg: style.backgroundColor, width: Math.round(box.width), height: Math.round(box.height) });
    }
    return { name, theme: document.documentElement.dataset.colorTheme, overflow: document.documentElement.scrollWidth > innerWidth + 1, contrast, islands };
  }, name);
}
module.exports = { inspect };
if (require.main === module) (async () => {
  for (const engine of (process.env.QA_ENGINE ? [process.env.QA_ENGINE] : ['edge', 'webkit'])) {
    const browser = await (engine === 'edge' ? chromium.launch({ channel: 'msedge', headless: true }) : webkit.launch({ headless: true }));
    try {
      for (const [width, height, touch] of [[1440,900,false],[390,844,true],[768,1024,true]]) {
        if (process.env.QA_WIDTH && width !== Number(process.env.QA_WIDTH)) continue;
        const context = await browser.newContext({ viewport: { width,height }, hasTouch: touch, isMobile: touch, reducedMotion: 'reduce' });
        await context.route('**/api/**', route => { throw new Error('API escaped fixture: ' + route.request().url()); });
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        const capture = async name => {
          await page.waitForTimeout(250);
          const key = `${engine}-${width}-${name}`;
          await page.screenshot({ path: path.join(output, key + '.png') });
          const audit = await inspect(page, key); report.push(audit);
          assert.equal(audit.theme, 'dark'); assert.equal(audit.overflow, false, key + ' document overflow');
          console.log(key + ': ' + audit.islands.length + ' light surfaces, ' + audit.contrast.length + ' contrast candidates');
        };
        await page.goto('http://127.0.0.1:5173/qa/mobile-secondary.html?theme=dark');
        for (const section of ['feed','notifications','hr','members','zoom','absences','referent','hisobot','bots','incoming','employees','tasks']) {
          await page.getByLabel('QA раздел').selectOption(section); await capture(section);
        }
        await page.getByRole('button', { name: 'Настройки', exact: true }).click(); await capture('settings');
        const appearance = page.getByRole('button', { name: 'Оформление', exact: true });
        if (await appearance.isVisible()) await appearance.click(); else {
          await page.getByRole('combobox', { name: 'Раздел настроек', exact: true }).click();
          await page.getByRole('option', { name: 'Оформление', exact: true }).click();
        } await capture('appearance');
        await page.getByRole('button', { name: 'Закрыть', exact: true }).first().click();
        await page.getByRole('button', { name: 'Профиль', exact: true }).click(); await capture('profile');
        await page.keyboard.press('Escape');
        await page.goto('http://127.0.0.1:5173/qa/mobile-workflows.html?theme=dark');
        for (const name of ['Проекты','Проектные','Оплаты','Поездки','Календарь']) {
          await page.getByRole('button', { name, exact: true }).click(); await capture(name);
        }
        await page.goto('http://127.0.0.1:5173/qa/mobile-domains.html?theme=dark'); await capture('messenger');
        assert.deepEqual(errors, [], engine + ' page errors');
        await context.close();
      }
    } finally { await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
