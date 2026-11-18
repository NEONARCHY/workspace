const assert = require('node:assert/strict');
const { readdirSync, existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const test = require('node:test');

const fork = path.resolve(__dirname, '../vendor/picomatch');
const vulnerablePatterns = [
  '+(*)b', '*(*a)b', '+(*a)b', '+(a*)b', '*(a*)b', '+(?*a)b',
  '+(@(*a))b', '+(+(a))b', '+(?(a))b', '+(*a|c)b', '**/+(*a)b',
  '+([[a]*a)b', '+([*a)b',
];

const digest = file => createHash('sha256').update(readFileSync(file)).digest('hex');

test('upstream source provenance and license are retained', () => {
  const provenance = require('../vendor/picomatch/UPSTREAM.json');
  for (const [name, original] of Object.entries(provenance.upstreamSha256)) {
    if (provenance.modifiedSourceFiles.includes(name)) {
      assert.notEqual(digest(path.join(fork, name)), original, 'The security patch is missing');
    } else {
      assert.equal(digest(path.join(fork, name)), original, `Unexpected upstream source change: ${name}`);
    }
  }
});

for (const entry of ['index.js', 'posix.js']) {
  const pm = require(path.join(fork, entry));

  test(`${entry}: ordinary globs, escapes, classes and safe extglobs retain meaning`, () => {
    for (const [pattern, input, match, options] of [
      ['**/*.{ts,tsx}', 'src/form.tsx', true],
      ['**/*.ts', 'src/form.js', false],
      ['**/*.ts', 'src/.hidden.ts', false],
      ['**/*.ts', 'src/.hidden.ts', true, { dot: true }],
      ['@(foo|bar).js', 'foo.js', true],
      ['+(foo|bar).js', 'foobarfoo.js', true],
      ['*(foo|bar).js', '.js', true, { dot: true }],
      ['+([ab])c', 'ababac', true],
      ['+([*+])x', '*+*x', true],
      [String.raw`+(\*)x`, '***x', true],
      ['+("*")x', '***x', true],
      ['+(*(a)|*(b))c', 'ababac', true],
      ['!**/*.test.ts', 'src/form.ts', true],
      ['SRC/*.TS', 'src/form.ts', true, { nocase: true }],
      ['**/*.ts', String.raw`src\form.ts`, true, { windows: true }],
    ]) {
      assert.equal(pm(pattern, options)(input), match, `${pattern}: ${input}`);
    }
    assert.equal(pm(['*.js', '*.ts'])('file.ts'), true);
    assert.equal(pm('*.js', { ignore: 'skip.js' })('skip.js'), false);
    const match = pm('*.ts', {}, true)('form.ts', true);
    assert.equal(match.isMatch, true);
    assert.equal(match.glob, '*.ts');
    assert.equal(typeof match.state.output, 'string');
    assert.equal(pm.scan('src/**/*.ts').base, 'src');
    assert.equal(pm.compileRe(pm.parse('**/*.ts')).test('src/form.ts'), true);
  });

  test(`${entry}: dangerous repeats are literalized through every public API`, () => {
    for (const pattern of vulnerablePatterns) {
      for (const options of [{}, { fastpaths: false }, { capture: true },
        { maxExtglobRecursion: false }, { maxExtglobRecursion: 100 }, { nobracket: true }]) {
        const input = 'a'.repeat(32) + '!';
        assert.equal(pm(pattern, options)(input), false, pattern);
        assert.equal(pm.makeRe(pattern, options).test(input), false, pattern);
        assert.equal(pm.compileRe(pm.parse(pattern, options)).test(input), false, pattern);
        // Leading ? syntax is already inert in upstream 4.0.7; it is not
        // recognized as an outer extglob (especially with capture enabled).
        if (!pattern.startsWith('**/') && !pattern.startsWith('+(?')) {
          assert.equal(pm(pattern, options)(pattern), true, `${pattern}: ${JSON.stringify(options)}`);
        }
      }
    }
    // Disabling the old recursion check must not re-enable nested repetition.
    assert.equal(pm('+(*(a))b', { maxExtglobRecursion: false })('aaaab'), false);
  });
}

test('adversarial near misses finish within an independent process deadline', () => {
  const child = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const pm = require(process.argv[1]);
    const patterns = JSON.parse(process.argv[2]);
    const input = 'a'.repeat(60000) + '!';
    for (const pattern of patterns) {
      for (const options of [{}, { maxExtglobRecursion: false }, { nobracket: true }]) {
        assert.equal(pm(pattern, options)(input), false);
        assert.equal(pm.makeRe(pattern, options).test(input), false);
        assert.equal(pm.compileRe(pm.parse(pattern, options)).test(input), false);
      }
    }
  `, fork, JSON.stringify(vulnerablePatterns)], { timeout: 6000, encoding: 'utf8' });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
});

test('every installed picomatch alias resolves to the fixed fork', () => {
  const store = path.resolve(__dirname, '../node_modules/.pnpm');
  let aliases = 0;
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const installed = path.join(store, entry.name, 'node_modules/picomatch');
    if (!existsSync(path.join(installed, 'package.json'))) continue;
    aliases++;
    const manifest = JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@yuksalish/picomatch', installed);
    assert.equal(manifest.version, '4.0.7-yuksalish.1', installed);
    assert.equal(digest(path.join(installed, 'lib/parse.js')), digest(path.join(fork, 'lib/parse.js')));
    // Check the installed file dependency too, not just the source folder.
    const pm = require(installed);
    assert.equal(pm('+(*a)b')('aaaaab'), false, installed);
  }
  assert(aliases > 0, 'No picomatch consumers found; dependency replacement was not checked');
  const lock = readFileSync(path.resolve(__dirname, '../pnpm-lock.yaml'), 'utf8');
  assert(!/^  picomatch@/m.test(lock), 'The lockfile still resolves an upstream picomatch release');
});
