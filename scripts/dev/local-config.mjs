import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const projectName = "yuksalish-personal-dev";
export const siteUrl = "https://localhost:5173";
export const apiUrl = "http://127.0.0.1:18080";

export function configDirectory(environment = process.env) {
  return join(environment.LOCALAPPDATA ?? join(homedir(), ".local", "share"), "Yuksalish Workspace Dev");
}

export function createConfig() {
  const secret = () => randomBytes(32).toString("hex");
  return {
    format: 1,
    projectName,
    deploymentId: randomUUID(),
    databasePassword: secret(),
    storagePassword: secret(),
    signingKey: secret(),
    encryptionKey: secret(),
    demoPassword: secret().slice(0, 24),
    // Explicit opt-in here only. Never inherit keys from the office server's .env.
    geminiApiKey: "",
  };
}

export function validateConfig(config) {
  const allowed = Object.keys(createConfig());
  if (config?.format !== 1 || config.projectName !== projectName
    || typeof config.deploymentId !== "string"
    || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(config.deploymentId)
    || Object.keys(config).some((key) => !allowed.includes(key))
    || ["databasePassword", "storagePassword", "signingKey", "encryptionKey", "demoPassword"]
      .some((key) => typeof config[key] !== "string" || !/^[\da-f]{24,64}$/i.test(config[key]))
    || typeof config.geminiApiKey !== "string"
    || !/^[\w-]*$/.test(config.geminiApiKey)) {
    throw new Error("Invalid personal development config; refusing to use another environment.");
  }
  return config;
}

export function cleanEnvironment(environment = process.env) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(YUKSALISH_|VITE_|POSTGRES_|MINIO_|COMPOSE_|GEMINI_|GOOGLE_API_KEY$|DOCKER_HOST$|DOCKER_CONTEXT$)/i.test(key)));
}

export function renderEnvironment(config) {
  validateConfig(config);
  const settings = {
    POSTGRES_PASSWORD: config.databasePassword,
    MINIO_ROOT_PASSWORD: config.storagePassword,
    YUKSALISH_ENVIRONMENT: "development",
    YUKSALISH_DEPLOYMENT_ID: config.deploymentId,
    YUKSALISH_DATABASE_URL: `postgresql+asyncpg://personal_dev:${config.databasePassword}@postgres:5432/yuksalish_personal_dev`,
    YUKSALISH_AUTH_SIGNING_KEY: config.signingKey,
    YUKSALISH_AUTH_ENCRYPTION_KEY: config.encryptionKey,
    YUKSALISH_DEMO_PASSWORD: config.demoPassword,
    YUKSALISH_SEED_DEMO_DATA: "false",
    YUKSALISH_REDIS_URL: "redis://redis:6379/0",
    YUKSALISH_S3_ENDPOINT: "minio:9000",
    YUKSALISH_S3_ACCESS_KEY: "personal_dev_storage",
    YUKSALISH_S3_SECRET_KEY: config.storagePassword,
    YUKSALISH_S3_BUCKET: "personal-dev-files",
    YUKSALISH_S3_SECURE: "false",
    YUKSALISH_CORS_ORIGINS: JSON.stringify([siteUrl, "https://127.0.0.1:5173"]),
    YUKSALISH_GEMINI_API_KEY: config.geminiApiKey,
    YUKSALISH_MEMBERS_API_URL: "",
    YUKSALISH_MEMBERS_INTEGRATION_KEY: "",
    YUKSALISH_AI_REFERENT_AGENT_TOKEN: "",
    YUKSALISH_HISOBOT_BRIDGE_TOKEN: "",
    YUKSALISH_ZOOM_CLIENT_SECRET: "",
  };
  return Object.entries(settings).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
}

export async function prepareConfig(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configFile = join(directory, "config.json");
  try {
    await writeFile(configFile, JSON.stringify(createConfig(), null, 2) + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const config = validateConfig(JSON.parse(await readFile(configFile, "utf8")));
  const envFile = join(directory, "personal.env");
  const tlsDirectory = join(directory, "tls");
  await mkdir(tlsDirectory, { recursive: true, mode: 0o700 });
  await writeFile(envFile, renderEnvironment(config), { mode: 0o600 });
  return { config, configFile, envFile, tlsDirectory };
}
