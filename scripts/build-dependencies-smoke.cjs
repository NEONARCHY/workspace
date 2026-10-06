// Build-tool compatibility check. All traffic stays on loopback; no downloads.
// Run as a separate process: global-agent intentionally hooks Node's HTTP agent.
const assert = require('node:assert/strict');
const http = require('node:http');
const { createRequire } = require('node:module');
const path = require('node:path');

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
    console.log('Build dependencies: wait-on, Electron proxy bootstrap and NO_PROXY passed.');
  } finally {
    target.closeAllConnections();
    proxy.closeAllConnections();
    await Promise.all([target, proxy].map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
