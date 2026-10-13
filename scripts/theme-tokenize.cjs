/* One-time, deterministic semantic-token migration. Preserves byte-for-byte
 * light colour fallbacks and all CSS formatting. No selectors/layout change.
 * Run with --write only after reviewing the role/exception policy below. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const desktopRuntime = createRequire(require.resolve('vite', { paths: [path.resolve(__dirname, '../apps/desktop')] }));
const postcss = desktopRuntime('postcss');
const directory = path.resolve(__dirname, '../apps/desktop/src/renderer');
const excluded = new Set(['dark-theme.css', 'sidebar-theme.css']);
const pattern = /#[\da-f]{3,8}\b|rgba?\([^()]*\)|\bwhite\b|\bblack\b/gi;

function channels(value) {
  if (/^white$/i.test(value)) return [255, 255, 255, 1];
  if (/^black$/i.test(value)) return [0, 0, 0, 1];
  if (value.startsWith('#')) {
    let hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map(x => x + x).join('');
    if (hex.length !== 6 && hex.length !== 8) return undefined;
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16),
      hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1];
  }
  const parts = value.replace(/^rgba?\(|\)$/g, '').split(/[,/\s]+/).filter(Boolean);
  if (parts.some(x => !/^\d*\.?\d+%?$/.test(x)) || parts.length < 3) return undefined;
  return parts.map((x, index) => x.endsWith('%') ? parseFloat(x) * (index < 3 ? 2.55 : .01) : Number(x))
    .concat(parts.length === 3 ? [1] : []);
}
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  if (delta < 8) return 'neutral';
  let hue = max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return hue < 15 || hue >= 330 ? 'danger' : hue < 68 ? 'warning' : hue < 160 ? 'success' :
    hue < 205 ? 'teal' : hue < 255 ? 'blue' : 'violet';
}
function role(property) {
  if (/^(color|fill|stroke|caret-color|accent-color)$/.test(property)) return 'ink';
  if (/shadow/.test(property)) return 'highlight';
  if (/filter/.test(property)) return undefined;
  if (/border|outline/.test(property)) return 'line';
  if (/^background/.test(property)) return 'surface';
  if (property.startsWith('--')) {
    if (/foil|holo|glare|glow|shadow|header|rail|accent/.test(property)) return undefined;
    if (/ink|text|muted|foreground/.test(property)) return 'ink';
    if (/line|stroke|border/.test(property)) return 'line';
    if (/canvas|surface|wash|fill|selected|card-base|soft|panel|background/.test(property)) return 'surface';
  }
  return undefined;
}
function replacement(value, category) {
  const rgb = channels(value.toLowerCase());
  if (!rgb) return value;
  const [r, g, b, alpha] = rgb;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), chroma = max - min;
  let name;
  if (category === 'highlight') {
    if (min < 235) return value;
    name = 'highlight';
  } else if (category === 'surface') {
    if (max < 158 || min < 118) return value; // Existing dark accent/semantic identity stays intact.
    name = chroma < 17 ? (min >= 240 ? 'surface' : 'surface-soft') : `wash-${hueOf(rgb)}`;
  } else if (category === 'ink') {
    if (min >= 155 || alpha < .5) return value; // On-brand light labels and decorative strokes.
    name = chroma < 42 || max < 110 ? (max >= 100 ? 'muted' : 'ink') : `ink-${hueOf(rgb)}`;
  } else {
    if (alpha < .04) return value;
    name = chroma < 45 || min >= 210 ? 'line' : `line-${hueOf(rgb)}`;
  }
  if (alpha < 1) {
    // Alpha stays local: one RGB reference per semantic role, no alias per opacity.
    return `rgb(var(--ws-theme-${name}-rgb, ${r} ${g} ${b}) / ${Number(alpha.toFixed(4))})`;
  }
  return `var(--ws-theme-${name}, ${value})`;
}
let changed = 0, count = 0;
for (const file of fs.readdirSync(directory).filter(x => x.endsWith('.css') && !excluded.has(x))) {
  const filename = path.join(directory, file), source = fs.readFileSync(filename, 'utf8');
  const root = postcss.parse(source), patches = [];
  root.walkDecls(declaration => {
    const category = role(declaration.prop);
    if (!category) return;
    // Paper previews/print and recognition optical effects are not app surfaces.
    let parent = declaration.parent;
    while (parent) {
      if (parent.type === 'atrule' && parent.name === 'media' && /print|forced-colors/.test(parent.params)) return;
      if (parent.type === 'rule' && /recognition-card-(foil|glare)|recognition-emblem::after|\.file-viewer-page/.test(parent.selector)) return;
      parent = parent.parent;
    }
    let next = declaration.value.includes('--ws-theme-') ? declaration.value : declaration.value.replace(pattern, value => replacement(value, category));
    if (category === 'ink') next = next.replace(/var\(--ws-navy(?=[,)])/g, 'var(--ws-text');
    if (next === declaration.value) return;
    const start = declaration.source.start.offset + declaration.prop.length + declaration.raws.between.length;
    patches.push({ start, end: start + declaration.value.length, next });
  });
  let result = source;
  for (const patch of patches.sort((a, b) => b.start - a.start)) result = result.slice(0, patch.start) + patch.next + result.slice(patch.end);
  if (result !== source) { changed++; count += patches.length; if (process.argv.includes('--write')) fs.writeFileSync(filename, result); }
}
console.log(JSON.stringify({ changedFiles: changed, declarations: count, write: process.argv.includes('--write') }));
