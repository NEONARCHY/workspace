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
