// Real source-file checks only against the generated personal sandbox, never a LAN server.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import { join } from "node:path";
import { configDirectory, siteUrl, validateConfig } from "./local-config.mjs";

const directory = configDirectory();
const config = validateConfig(JSON.parse(await readFile(join(directory, "config.json"), "utf8")));
const agent = new https.Agent({ca: await readFile(join(directory, "tls", "localhost.crt"))});
let session;
const cookies = new Map();
async function request(path, {method = "GET", data, headers = {}} = {}) {
  const body = data === undefined ? undefined : Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data));
  return await new Promise((resolve, reject) => {
    const req = https.request(new URL(path, siteUrl), {agent, method, timeout: 30000, headers: {
      Origin: siteUrl, "Sec-Fetch-Site": "same-origin",
      ...(body ? {"Content-Type": "application/json", "Content-Length": body.length} : {}),
      ...(session ? {Authorization: `Bearer ${session.accessToken}`, "X-CSRF-Token": session.csrfToken} : {}),
      Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join("; "), ...headers,
    }}, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        for (const entry of response.headers["set-cookie"] ?? []) {
          const pair = entry.split(";")[0], index = pair.indexOf("=");
          cookies.set(pair.slice(0, index), pair.slice(index + 1));
        }
        const text = Buffer.concat(chunks).toString("utf8");
        resolve({status: response.statusCode, text, json: response.headers["content-type"]?.includes("application/json") && text ? JSON.parse(text) : null});
      });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("Personal grant check timed out"))); req.end(body);
  });
}
try {
  const health = await request("/api/v1/health/ready");
  assert.equal(health.json?.deployment_id, config.deploymentId);
  assert.equal(health.json?.environment, "development");
  const login = await request("/api/v1/auth/web/login", {method: "POST", data: {
    username: "malika", password: config.demoPassword, deviceLabel: "Personal grant files QA",
  }});
  assert.equal(login.status, 200); session = login.json;
  const bootstrap = await request("/api/v1/workspace/bootstrap");
  const executor = bootstrap.json.people.find((person) => person.name === "Дилшод Рахимов");
  assert.ok(executor, "Expected the isolated sample executor");
  const probePath = join(directory, "grant-files-verification.json");
  let probe = await readFile(probePath, "utf8").then(JSON.parse).catch(() => null);
  if (!probe || probe.deploymentId !== config.deploymentId) {
    probe = {deploymentId: config.deploymentId, payload: {
      requestId: randomUUID(), title: "Тест: заявка с двумя файлами для ознакомления",
      description: "Только личный тестовый стенд. Проверка исходных условий и бюджета.",
      assigneeId: executor.id, coAssigneeIds: [], checklist: [],
      dueAt: new Date(Date.now() + 20 * 86400000).toISOString(),
    }};
    await writeFile(probePath, JSON.stringify(probe) + "\n", {mode: 0o600});
  }
  const files = [["qa-grant-conditions.txt", "text/plain", "Synthetic grant terms.\n"],
    ["qa-grant-budget.csv", "text/csv", "item,amount\nactivity,100\n"]];
  const send = async (changed = false) => {
    const form = new FormData(); form.append("payload", JSON.stringify(probe.payload));
    for (const [name, type, content] of files) form.append("files", new Blob([changed ? `${content}changed` : content], {type}), name);
    const encoded = new Response(form);
    return await request("/api/v1/grants/with-files", {method: "POST", data: Buffer.from(await encoded.arrayBuffer()), headers: {"Content-Type": encoded.headers.get("Content-Type")}});
  };
  const created = await send(); assert.equal(created.status, 201, `Create with files: HTTP ${created.status}`);
  assert.equal(created.json.id, probe.payload.requestId);
  for (const [name, , content] of files) {
    const attachment = created.json.attachments.find((file) => file.fileName === name);
    assert.ok(attachment, "Source file saved with the grant");
    const downloaded = await request(`/api/v1/attachments/${attachment.id}`);
    assert.equal(downloaded.status, 200); assert.equal(downloaded.text, content);
  }
  const replay = await send(); assert.equal(replay.status, 201);
  assert.deepEqual(replay.json.attachments.map((file) => file.id), created.json.attachments.map((file) => file.id));
  assert.equal((await send(true)).status, 409);
  console.log("PASS: personal HTTPS grant, two private source files, authenticated downloads, idempotent retry, changed-content conflict.");
} finally {
  if (session) await request("/api/v1/auth/web/logout", {method: "POST"});
  agent.destroy(); cookies.clear();
}
