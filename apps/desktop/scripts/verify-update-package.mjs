import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../release/win-unpacked/resources/app-update.yml"));
let config;
try {
  config = readFileSync(configPath, "utf8");
} catch {
  throw new Error(`Windows installer is missing its auto-update configuration: ${configPath}`);
}

if (!/^provider:\s*generic\s*$/m.test(config)
  || !config.includes("https://workspace.opinions.uz/api/v1/updates/feed/")
  || !/^updaterCacheDirName:\s*\S+/m.test(config)) {
  throw new Error(`Windows installer has incomplete auto-update configuration: ${configPath}`);
}

console.log("Windows installer includes its auto-update configuration.");

const rendererPath = resolve(import.meta.dirname, "../dist/index.html");
const html = readFileSync(rendererPath, "utf8");
const policy = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)?.[1];
const publicOrigin = process.env.VITE_API_BASE_URL;
const lanOrigin = process.env.VITE_LAN_API_BASE_URL;
if (!policy || !publicOrigin || policy.includes("__YUKSALISH_CONNECT_SOURCES__")) {
  throw new Error("Windows installer is missing its configured desktop connection policy.");
}
for (const origin of [publicOrigin, lanOrigin].filter(Boolean)) {
  const address = new URL(origin);
  if (!policy.split(" ").includes(origin) || !policy.split(" ").includes(`wss://${address.host}`)) {
    throw new Error(`Windows installer cannot connect to its configured server: ${origin}`);
  }
}
console.log("Windows installer permits only its configured server connections.");
