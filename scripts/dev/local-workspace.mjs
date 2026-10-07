import { spawn, spawnSync } from "node:child_process";
import { existsSync, openSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { apiUrl, cleanEnvironment, configDirectory, prepareConfig, projectName, siteUrl } from "./local-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = configDirectory();
const action = process.argv[2] ?? "start";
const runFile = join(directory, "run.json");

function getJson(url) {
  return new Promise((resolveRequest, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const caFile = join(directory, "tls", "localhost.crt");
    const request = client.get(url, {
      // Trust our exact generated localhost certificate, never arbitrary self-signed servers.
      ca: existsSync(caFile) ? readFileSync(caFile) : undefined,
      timeout: 2500,
    }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
          resolveRequest(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    request.on("timeout", () => request.destroy(new Error("Local service timed out")));
    request.on("error", reject);
  });
}

async function portInUse(port) {
  return await new Promise((resolveCheck, reject) => {
    const server = net.createServer();
    server.once("error", (error) => error.code === "EADDRINUSE" ? resolveCheck(true) : reject(error));
    server.listen(port, "127.0.0.1", () => server.close(() => resolveCheck(false)));
  });
}

async function identity() {
  try { return await getJson(`${siteUrl}/__local-dev.json`); } catch { return null; }
}

function composeArgs(envFile, ...arguments_) {
  return ["compose", "--project-name", projectName, "--env-file", envFile,
    "-f", join(root, "infrastructure", "compose.local-dev.yaml"), ...arguments_];
}

function execute(command, args, environment) {
  return new Promise((resolveExecution, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, stdio: "inherit", windowsHide: true });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolveExecution() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function start(local, environment) {
  const existing = await identity();
  if (existing?.deploymentId === local.config.deploymentId) {
    console.log(`Already running: ${siteUrl}\nSource: ${existing.workspaceRoot}`);
    if (existing.workspaceRoot !== root) throw new Error("Another checkout owns the preview. Run dev:local:stop there before switching checkout.");
    return;
  }
  if (await portInUse(5173)) throw new Error("Port 5173 belongs to another process; it has not been stopped.");
  if (await portInUse(18080)) {
    const health = await getJson(`${apiUrl}/api/v1/health/ready`).catch(() => null);
    if (health?.deployment_id !== local.config.deploymentId) {
      throw new Error("Port 18080 belongs to another environment; it has not been touched.");
    }
  }
  const vite = join(root, "apps", "desktop", "node_modules", "vite", "bin", "vite.js");
  if (!existsSync(vite)) throw new Error("Dependencies are missing. Run pnpm install --frozen-lockfile first.");
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], {
    env: environment, stdio: "pipe", windowsHide: true, timeout: 15000,
  });
  if (docker.status !== 0) throw new Error("Start Docker Desktop, wait for the engine, then run dev:local again.");
  await execute("docker", composeArgs(local.envFile, "up", "--build", "--detach", "--wait", "--wait-timeout", "240", "api"), environment);
  const health = await getJson(`${apiUrl}/api/v1/health/ready`);
  if (health.deployment_id !== local.config.deploymentId || health.environment !== "development") {
    throw new Error("Personal API identity mismatch; refusing to start the website.");
  }
  const child = spawn(process.execPath, [vite, "--mode", "web"], {
    cwd: join(root, "apps", "desktop"), windowsHide: true, stdio: "inherit",
    env: {
      ...environment,
      VITE_API_BASE_URL: "",
      VITE_LAN_API_BASE_URL: "",
      VITE_DEV_API_PROXY_TARGET: apiUrl,
      YUKSALISH_LOCAL_DEV_TLS_DIR: local.tlsDirectory,
      YUKSALISH_LOCAL_DEV_DEPLOYMENT_ID: local.config.deploymentId,
      YUKSALISH_LOCAL_DEV_RUNNER_PID: String(process.pid),
    },
  });
  child.on("error", (error) => console.error(error.message));
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const current = await identity();
    if (current?.deploymentId === local.config.deploymentId && current.devServerPid === child.pid) {
      ready = true;
      break;
    }
    if (child.exitCode !== null) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  if (!ready) {
    child.kill();
    throw new Error("Personal frontend did not start; inspect server.log. No other process has been stopped.");
  }
  await writeFile(runFile, JSON.stringify({ deploymentId: local.config.deploymentId, runnerPid: process.pid, vitePid: child.pid, root }) + "\n", { mode: 0o600 });
  console.log(`\nPersonal development site: ${siteUrl}\nLogin: malika\nPassword is in ${local.configFile} (demoPassword).\nUI and API reload from source; Docker volumes keep your test data.\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
  await new Promise((resolveExit, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 || code === null ? resolveExit() : reject(new Error(`Vite exited with ${code}`)));
  });
}

try {
  const local = await prepareConfig(directory);
  const environment = {
    ...cleanEnvironment(),
    YUKSALISH_LOCAL_ENV_FILE: local.envFile,
    YUKSALISH_LOCAL_TLS_DIR: local.tlsDirectory,
  };
  if (action === "status") {
    const current = await identity();
    console.log(current?.deploymentId === local.config.deploymentId
      ? `${siteUrl}\nSource: ${current.workspaceRoot}` : "Personal website is not running.");
  } else if (action === "stop") {
    const current = await identity();
    const run = await readFile(runFile, "utf8").then(JSON.parse).catch(() => null);
    if (current?.deploymentId === local.config.deploymentId && run?.deploymentId === current.deploymentId
      && run.runnerPid === current.runnerPid && run.vitePid === current.devServerPid) {
      for (const pid of [run.vitePid, run.runnerPid]) {
        try { process.kill(pid); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    } else if (await portInUse(5173)) {
      throw new Error("Cannot verify the preview process; no process or container has been stopped.");
    }
    await execute("docker", composeArgs(local.envFile, "stop"), environment);
    console.log("Personal environment stopped. All database and file volumes are preserved.");
  } else if (action === "start" && process.argv.includes("--detach")) {
    const current = await identity();
    if (current?.deploymentId === local.config.deploymentId) {
      if (current.workspaceRoot !== root) throw new Error("Another checkout owns the preview; stop it before switching checkout.");
      console.log(`Already running: ${siteUrl}`);
    } else {
      const log = openSync(join(directory, "server.log"), "a", 0o600);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "start"], {
        cwd: root, env: environment, detached: true, windowsHide: true, stdio: ["ignore", log, log],
      });
      child.unref();
      console.log(`Starting in the background. Log: ${join(directory, "server.log")}\nSite (after startup): ${siteUrl}`);
      if (process.argv.includes("--wait")) {
        let ready = false;
        let exited = false;
        child.on("exit", () => { exited = true; });
        child.on("error", () => { exited = true; });
        for (let attempt = 0; attempt < 600 && !exited; attempt += 1) {
          const preview = await identity();
          if (preview?.deploymentId === local.config.deploymentId && preview.runnerPid === child.pid) {
            ready = true;
            break;
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
        }
        if (!ready) throw new Error(`Startup failed or timed out. Inspect ${join(directory, "server.log")}.`);
        console.log(`Ready: ${siteUrl}`);
      }
    }
  } else if (action === "start") {
    await start(local, environment);
  } else {
    throw new Error("Usage: node scripts/dev/local-workspace.mjs start [--detach] [--wait] | stop | status");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
