// Build-tool compatibility check. All traffic stays on loopback; no downloads.
// Run as a separate process: global-agent intentionally hooks Node's HTTP agent.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootRequire = createRequire(path.resolve(__dirname, '../package.json'));
const desktopRequire = createRequire(path.resolve(__dirname, '../apps/desktop/package.json'));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const getRequire = createRequire(appBuilderRequire.resolve('@electron/get'));

async function checkPackagingGlobs() {
  const asar = appBuilderRequire('@electron/asar');
  const asarRequire = createRequire(appBuilderRequire.resolve('@electron/asar'));
  const universalRequire = createRequire(appBuilderRequire.resolve('@electron/universal'));
  const compare = universalRequire('dir-compare');
  const ejsRequire = createRequire(appBuilderRequire.resolve('ejs'));
  const jakeRequire = createRequire(ejsRequire.resolve('jake'));
  const filelistRequire = createRequire(jakeRequire.resolve('filelist'));
  const eslintRequire = createRequire(rootRequire.resolve('eslint'));
  for (const load of [appBuilderRequire, asarRequire, filelistRequire, eslintRequire,
    createRequire(universalRequire.resolve('dir-compare')), universalRequire]) {
    assert.equal(load('minimatch/package.json').version, '11.0.4');
  }
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-packaging-smoke-'));
  try {
    const source = path.join(fixture, 'source');
    const copy = path.join(fixture, 'copy');
    fs.mkdirSync(path.join(source, 'native'), { recursive: true });
    fs.writeFileSync(path.join(source, 'main.js'), 'module.exports = 42;');
    fs.writeFileSync(path.join(source, 'keep.txt'), 'same');
    fs.writeFileSync(path.join(source, 'skip.txt'), 'different');
    fs.writeFileSync(path.join(source, '.hidden.txt'), 'hidden');
    fs.writeFileSync(path.join(source, 'native', 'addon.node'), 'native fixture');
    fs.writeFileSync(path.join(source, 'native', 'nested.txt'), 'nested');
    fs.cpSync(source, copy, { recursive: true });
    fs.writeFileSync(path.join(copy, 'skip.txt'), 'ignored difference');
    const comparison = compare.compareSync(source, copy, {
      compareContent: true, includeFilter: '*.txt', excludeFilter: 'skip.txt',
    });
    assert.equal(comparison.same, true, 'Directory include/exclude filters changed');
    const differing = compare.compareSync(source, copy, { compareContent: true });
    assert.equal(differing.same, false, 'Directory comparison must detect changed files');

    const pattern = `${source.replaceAll('\\', '/')}/**/*.txt`;
    const glob = asarRequire('glob');
    const expected = ['keep.txt', 'nested.txt', 'skip.txt'];
    assert.deepEqual(glob.sync(pattern).map((item) => path.basename(item)).sort(), expected);
    assert.deepEqual(glob.sync(pattern, { dot: true })
      .map((item) => path.basename(item)).sort(), ['.hidden.txt', ...expected]);
    const extglob = `${source.replaceAll('\\', '/')}/**/@(keep|nested).txt`;
    assert.deepEqual(glob.sync(extglob).map((item) => path.basename(item)).sort(),
      ['keep.txt', 'nested.txt']);
    assert.deepEqual(glob.sync(pattern, { ignore: '**/native/**' })
      .map((item) => path.basename(item)).sort(), ['keep.txt', 'skip.txt']);
    const asynchronous = await new Promise((resolve, reject) => {
      glob(pattern, (error, files) => error ? reject(error) : resolve(files));
    });
    assert.deepEqual(asynchronous.map((item) => path.basename(item)).sort(), expected);
    const { FileList } = jakeRequire('filelist');
    const files = new FileList();
    files.include(pattern, { windowsPathsNoEscape: true });
    files.exclude(/[/\\]skip\.txt$/);
    assert.deepEqual(files.toArray().map((item) => path.basename(item)).sort(),
      ['keep.txt', 'nested.txt']);

    const archive = path.join(fixture, 'app.asar');
    await asar.createPackageWithOptions(source, archive, { unpack: '*.node', unpackDir: 'native' });
    assert.equal(asar.extractFile(archive, 'main.js').toString(), 'module.exports = 42;');
    assert.equal(asar.extractFile(archive, '.hidden.txt').toString(), 'hidden');
    assert.equal(asar.statFile(archive, 'native/addon.node').unpacked, true);
    assert.equal(asar.statFile(archive, 'native/nested.txt').unpacked, true);
    asar.uncache(archive);
    const unpackFileOnly = path.join(fixture, 'file-only.asar');
    await asar.createPackageWithOptions(source, unpackFileOnly, { unpack: '*.node' });
    assert.equal(asar.statFile(unpackFileOnly, 'native/addon.node').unpacked, true);
    assert.equal(asar.statFile(unpackFileOnly, 'native/nested.txt').unpacked, undefined);
    asar.uncache(unpackFileOnly);
    assert.equal(appBuilderRequire('ejs').render('<%= name %>', { name: 'Workspace' }), 'Workspace');
  } finally {
    assert.equal(path.dirname(fixture), path.resolve(os.tmpdir()));
    assert(path.basename(fixture).startsWith('workspace-packaging-smoke-'));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function request(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('error', reject);
      response.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => req.destroy(new Error('Loopback request timed out')));
  });
}

async function main() {
  const target = http.createServer((_request, response) => response.end('direct'));
  const proxyRequests = [];
  const proxy = http.createServer((req, response) => {
    proxyRequests.push(req.url);
    response.end('proxied');
  });
  try {
    const targetPort = await listen(target);
    const proxyPort = await listen(proxy);
    const semver = getRequire('semver');
    const electronPackage = desktopRequire('electron/package.json');
    assert.equal(electronPackage.version, '44.9.1');
    assert(semver.satisfies(process.version, electronPackage.engines.node), 'Node must support the Electron installer');
    const installerRequire = createRequire(desktopRequire.resolve('electron/package.json'));
    const installerGet = await import(pathToFileURL(installerRequire.resolve('@electron/get')).href);
    assert.equal(typeof installerGet.downloadArtifact, 'function', 'Electron installer download API changed');

    // Resolve exactly the transitive instances used by ESLint and electron-builder.
    const hooksRequire = createRequire(rootRequire.resolve('eslint-plugin-react-hooks'));
    assert.equal(hooksRequire('zod/package.json').version, '4.6.6');
    const { z } = hooksRequire('zod');
    const schema = z.object({ names: z.array(z.string()).max(2) });
    assert.equal(schema.safeParse({ names: ['one'] }).success, true);
    assert.equal(schema.safeParse({ names: ['one', 'two', 'three'] }).success, false);
    assert.equal(schema.safeParse({ names: [1] }).success, false);

    const ajvRequire = createRequire(appBuilderRequire.resolve('ajv'));
    assert.equal(ajvRequire('fast-uri/package.json').version, '3.1.9');
    const uri = ajvRequire('fast-uri');
    assert.notEqual(uri.parse('%6Aavascript:alert(1)').scheme, 'javascript');
    const Ajv = appBuilderRequire('ajv');
    const validate = new Ajv().compile({
      $id: 'https://workspace.example/schema', type: 'object',
      properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false,
    });
    assert.equal(validate({ name: 'workspace' }), true);
    assert.equal(validate({ name: 1 }), false);

    const rebuildRequire = createRequire(appBuilderRequire.resolve('@electron/rebuild'));
    const nodeGypRequire = createRequire(rebuildRequire.resolve('node-gyp'));
    for (const [load, expected] of [[getRequire, '7.30.1'], [nodeGypRequire, '6.29.1']]) {
      assert.equal(load('undici/package.json').version, expected);
      const { Agent, fetch } = load('undici');
      const dispatcher = new Agent();
      try {
        const result = await fetch(`http://127.0.0.1:${targetPort}/compatibility`, {
          dispatcher, signal: AbortSignal.timeout(3000),
        });
        assert.equal(await result.text(), 'direct');
      } finally { await dispatcher.close(); }
    }
    // This validates wait-on's Joi options without reaching external endpoints.
    await desktopRequire('wait-on')({
      resources: [`tcp:127.0.0.1:${targetPort}`], timeout: 3000, interval: 50,
    });
    await checkPackagingGlobs();
    // Isolate bootstrap from any runner-level proxy configuration.
    for (const key of Object.keys(process.env)) {
      if (/^(global_agent_.*|https?_proxy|no_proxy)$/i.test(key)) delete process.env[key];
    }
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    process.env.GLOBAL_AGENT_HTTP_PROXY = proxyUrl;
    process.env.GLOBAL_AGENT_HTTPS_PROXY = proxyUrl;
    appBuilderRequire('@electron/get').initializeProxy();
    assert.equal(getRequire('global-agent/package.json').version, '4.1.3');
    assert.equal(global.GLOBAL_AGENT?.HTTP_PROXY, proxyUrl, 'Electron proxy bootstrap failed');
    const targetUrl = `http://127.0.0.1:${targetPort}/artifact`;
    assert.equal(await request(targetUrl), 'proxied');
    assert.deepEqual(proxyRequests, [targetUrl]);
    global.GLOBAL_AGENT.NO_PROXY = '127.0.0.1';
    assert.equal(await request(targetUrl), 'direct');
    assert.equal(proxyRequests.length, 1, 'NO_PROXY must bypass the proxy');
    console.log('Build dependencies: Electron installer, Zod, Ajv/fast-uri, both Undici versions, wait-on, ASAR packing/unpacking, glob, filelist, directory filters, EJS, proxy and NO_PROXY passed.');
  } finally {
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([target, proxy].map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
