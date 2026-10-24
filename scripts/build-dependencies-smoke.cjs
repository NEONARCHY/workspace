// Build-tool compatibility check. All traffic stays on loopback; no downloads.
// Run as a separate process: global-agent intentionally hooks Node's HTTP agent.
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rootRequire = createRequire(path.resolve(__dirname, '../package.json'));
const desktopRequire = createRequire(path.resolve(__dirname, '../apps/desktop/package.json'));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib'));
const getRequire = createRequire(appBuilderRequire.resolve('@electron/get'));

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
    console.log('Build dependencies: Electron installer, Zod, Ajv/fast-uri, both Undici versions, wait-on, proxy and NO_PROXY passed.');
  } finally {
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([target, proxy].map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
