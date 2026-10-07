// Real requests through the HTTPS frontend proxy, restricted to our generated local deployment.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { join } from "node:path";

import { configDirectory, siteUrl, validateConfig } from "./local-config.mjs";

const directory = configDirectory();
const config = validateConfig(JSON.parse(await readFile(join(directory, "config.json"), "utf8")));
const ca = await readFile(join(directory, "tls", "localhost.crt"));
const agent = new https.Agent({ ca });
let cookies = {};
let session;

async function request(path, { method = "GET", data, headers = {}, raw = false } = {}) {
  const body = data === undefined ? undefined : raw ? Buffer.from(data) : Buffer.from(JSON.stringify(data));
  return await new Promise((resolveRequest, reject) => {
    const req = https.request(new URL(path, siteUrl), {
      agent, method, timeout: 15000,
      headers: {
        Origin: siteUrl, "Sec-Fetch-Site": "same-origin",
        ...(session ? { Authorization: `Bearer ${session.accessToken}`, "X-CSRF-Token": session.csrfToken } : {}),
        ...(body ? { "Content-Type": raw ? "text/plain" : "application/json", "Content-Length": body.length } : {}),
        Cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; "),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        for (const value of res.headers["set-cookie"] ?? []) {
          const [pair] = value.split(";");
          const separator = pair.indexOf("=");
          cookies[pair.slice(0, separator)] = pair.slice(separator + 1);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        resolveRequest({ status: res.statusCode, headers: res.headers, text,
          json: res.headers["content-type"]?.includes("application/json") && text ? JSON.parse(text) : null });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Local verification timed out")));
    req.end(body);
  });
}

try {
  const health = await request("/api/v1/health/ready");
  assert.equal(health.json.deployment_id, config.deploymentId);
  assert.equal(health.json.environment, "development");
  const manifest = await request("/version.json");
  assert.equal(manifest.status, 200);
  assert.equal(typeof manifest.json.buildId, "string");
  const loginPath = "/api/v1/auth/web/login";
  const credentials = { username: "malika", password: config.demoPassword, deviceLabel: "Personal sandbox verification" };
  assert.equal((await request(loginPath, { method: "POST", data: credentials, headers: { Origin: "https://unrelated.invalid" } })).status, 403);
  assert.equal((await request(loginPath, { method: "POST", data: credentials, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  const login = await request(loginPath, { method: "POST", data: credentials });
  assert.equal(login.status, 200, `Web login failed: HTTP ${login.status}`);
  session = login.json;
  assert.equal(session.user.username, "malika");
  assert.equal(session.user.role, "admin");
  assert.ok(login.headers["set-cookie"].every((cookie) => cookie.includes("Secure") && cookie.includes("SameSite=strict")));
  let bootstrap = await request("/api/v1/workspace/bootstrap");
  assert.equal(bootstrap.status, 200);
  const taskData = { title: "Проверка личного тестового сервера", assigneeId: session.user.id };
  assert.equal((await request("/api/v1/tasks", { method: "POST", data: taskData, headers: { "X-CSRF-Token": "" } })).status, 403);
  const probeFile = join(directory, "verification.json");
  let probe = await readFile(probeFile, "utf8").then(JSON.parse).catch(() => null);
  if (!probe || probe.deploymentId !== config.deploymentId) {
    const created = await request("/api/v1/tasks", { method: "POST", data: taskData });
    assert.equal(created.status, 201, `Create task failed: HTTP ${created.status}`);
    probe = { deploymentId: config.deploymentId, taskId: created.json.id };
    const uploaded = await request(`/api/v1/attachments/task/${probe.taskId}?fileName=local-verification.txt`, {
      method: "PUT", raw: true, data: "Personal sandbox persistent attachment.\n",
    });
    assert.equal(uploaded.status, 201, `Upload failed: HTTP ${uploaded.status}`);
    probe.attachmentId = uploaded.json.id;
    await writeFile(probeFile, JSON.stringify(probe) + "\n", { mode: 0o600 });
  }
  bootstrap = await request("/api/v1/workspace/bootstrap");
  assert.ok(bootstrap.json.tasks.some((task) => task.id === probe.taskId));
  const attachment = await request(`/api/v1/attachments/${probe.attachmentId}`);
  assert.equal(attachment.status, 200);
  assert.equal(attachment.text, "Personal sandbox persistent attachment.\n");
  const refresh = await request("/api/v1/auth/web/refresh", { method: "POST" });
  assert.equal(refresh.status, 200);
  assert.notEqual(refresh.json.csrfToken, session.csrfToken);
  session = refresh.json;
  assert.equal((await request("/api/v1/workspace/bootstrap")).status, 200);
  console.log("PASS: local deployment, HTTPS proxy, manifest, Malika admin login, Secure cookies, Origin/CSRF rejection, real saved task, persistent file, session refresh.");
} finally {
  if (session) assert.equal((await request("/api/v1/auth/web/logout", { method: "POST" })).status, 204);
  cookies = {};
  agent.destroy();
}
