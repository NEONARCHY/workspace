// Node 20: node --experimental-websocket scripts/desktop-window-smoke.cjs
// Own unpacked build + isolated profile. Main inspector survives a renderer crash.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { spawn } = require("node:child_process");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label) {
  for (let i = 0; i < 120; i++) {
    try { const value = await check(); if (value) return value; } catch { /* starting */ }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
async function inspector() {
  const targets = await until(async () => (await fetch("http://127.0.0.1:19223/json/list")).json(), "main inspector");
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (pending.has(data.id)) { pending.get(data.id)(data); pending.delete(data.id); }
  };
  return {
    close: () => socket.close(),
    evaluate: async (expression) => {
      const id = ++nextId;
      const response = new Promise((resolve) => pending.set(id, resolve));
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      let timer;
      const result = await Promise.race([response, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Inspector timeout")), 10000); })]).finally(() => clearTimeout(timer));
      if (result.error || result.result.exceptionDetails) throw new Error(JSON.stringify(result.error || result.result.exceptionDetails));
      return result.result.result.value;
    },
  };
}
async function main() {
  const dataDir = path.resolve("tmp/window-smoke-profile-raw");
  const output = path.resolve("tmp/responsive-smoke");
  await fs.mkdir(output, { recursive: true });
  const launch = () => spawn(path.resolve("apps/desktop/release/win-unpacked/Yuksalish Workspace.exe"), [
    `--user-data-dir=${dataDir}`, "--inspect=127.0.0.1:19223", "--remote-debugging-port=19222", "--remote-debugging-address=127.0.0.1",
  ], { windowsHide: true, stdio: "ignore" });
  let child = launch();
  let control;
  let browser;
  const win = "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0]";
  try {
    control = await inspector();
    await until(() => control.evaluate(`Boolean(${win})`), "window");
    await until(async () => (await fetch("http://127.0.0.1:19222/json/list")).ok, "renderer inspector");
    browser = await chromium.connectOverCDP("http://127.0.0.1:19222");
    let page = browser.contexts()[0].pages()[0];
    await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.yuksalish.version), "0.13.0");
    for (const [width, height] of [[800,600], [1240,780], [640,480]]) {
      await control.evaluate(`${win}.unmaximize(); ${win}.setBounds({x:100,y:70,width:${width},height:${height}})`);
      await until(async () => {
        const b = await control.evaluate(`${win}.getBounds()`);
        return b.width === width && b.height === height && b.x === 100 && b.y === 70;
      }, "native resize");
    }
    assert(await control.evaluate(`${win}.isMovable() && ${win}.isResizable()`));
    await page.screenshot({ path: path.join(output, "desktop-640-login.png") });
    await control.evaluate(`${win}.maximize()`);
    await until(() => control.evaluate(`${win}.isMaximized()`), "maximize");
    await control.evaluate(`${win}.minimize()`);
    await until(() => control.evaluate(`${win}.isMinimized()`), "minimize");
    await control.evaluate(`${win}.restore(); ${win}.unmaximize()`);
    await until(() => control.evaluate(`!${win}.isMaximized() && !${win}.isMinimized()`), "restore");
    await delay(200);
    await control.evaluate(`${win}.setBounds({x:120,y:90,width:800,height:600})`);
    await page.getByRole("textbox", { name: /Логин/ }).fill("malika");
    await page.getByLabel(/Пароль/).fill("Yuksalish-Local-2026!");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.locator(".app-shell").waitFor();
    await page.screenshot({ path: path.join(output, "desktop-800-workspace.png") });
    await browser.close(); browser = undefined;
    // Auto-select restart only in this isolated test process.
    await control.evaluate(`process.mainModule.require('electron').dialog.showMessageBox = async () => ({response:1,checkboxChecked:false}); ${win}.webContents.forcefullyCrashRenderer(); true`);
    await until(() => control.evaluate(`${win}.webContents.executeJavaScript("Boolean(document.querySelector('input[type=password]'))")`), "recovery to login after crash");
    browser = await chromium.connectOverCDP("http://127.0.0.1:19222");
    page = browser.contexts()[0].pages()[0];
    await page.screenshot({ path: path.join(output, "desktop-after-crash.png") });
    await browser.close(); browser = undefined;
    await control.evaluate(`${win}.setBounds({x:120,y:90,width:800,height:600})`);
    await delay(200);
    await control.evaluate(`${win}.close(); true`);
    control.close(); control = undefined;
    await until(() => child.exitCode !== null, "QA app exit");
    const saved = JSON.parse(await fs.readFile(path.join(dataDir, "window-state.json"), "utf8"));
    assert.equal(saved.width, 800); assert.equal(saved.height, 600);
    const log = JSON.parse(await fs.readFile(path.join(dataDir, "diagnostics.json"), "utf8"));
    assert(log.some((entry) => entry.category === "renderer-stopped"));
    child = launch(); control = await inspector();
    await until(() => control.evaluate(`Boolean(${win})`), "reopened window");
    const restored = await control.evaluate(`${win}.getBounds()`);
    assert.equal(restored.width, 800); assert.equal(restored.height, 600);
    console.log("PASS: native move/resize, minimize/restore, persistent geometry, login and recovery after a real renderer crash.");
  } finally {
    if (browser) await browser.close();
    if (control) { await control.evaluate(`${win}.close(); true`).catch(() => undefined); control.close(); }
    if (child.exitCode === null) child.kill();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
