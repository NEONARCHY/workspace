// Read-only release verification against the explicitly named TEST endpoint.
const https = require('node:https');
const assert = require('node:assert/strict');
const get = path => new Promise((resolve, reject) => {
  https.get(`https://192.168.0.127:8443${path}`, { rejectUnauthorized: false, timeout: 15000 }, response => {
    let body = ''; response.on('data', chunk => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, body }));
  }).on('error', reject);
});
(async () => {
  for (const path of ['/', '/version.json', '/api/v1/health/ready']) {
    const response = await get(path);
    const version = path === '/version.json' ? JSON.parse(response.body) : undefined;
    console.log(path, response.status, version ? JSON.stringify({ buildId: version.buildId, version: version.version, builtAt: version.builtAt, notes: version.notes }) : '');
    assert.equal(response.status, 200);
  }
})().catch(error => { console.error(error); process.exit(1); });
