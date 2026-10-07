import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { cleanEnvironment, createConfig, prepareConfig, renderEnvironment, validateConfig } from "./local-config.mjs";

test("personal configuration uses separate secrets and fixed private infrastructure", () => {
  const first = createConfig();
  const second = createConfig();
  assert.notEqual(first.deploymentId, second.deploymentId);
  assert.notEqual(first.databasePassword, second.databasePassword);
  const env = renderEnvironment(first);
  assert.match(env, /@postgres:5432\/yuksalish_personal_dev/);
  assert.match(env, /YUKSALISH_SEED_DEMO_DATA=false/);
  assert.match(env, /YUKSALISH_S3_BUCKET=personal-dev-files/);
  assert.match(env, /https:\/\/localhost:5173/);
  assert.match(env, /YUKSALISH_GEMINI_API_KEY=\n/);
  assert.doesNotMatch(env, /production|staging|192\.168/);
});

test("office credentials and endpoint overrides are not inherited", () => {
  assert.deepEqual(cleanEnvironment({
    PATH: "node", LOCALAPPDATA: "local", YUKSALISH_DATABASE_URL: "production",
    VITE_API_BASE_URL: "office", MINIO_ROOT_PASSWORD: "secret", COMPOSE_PROJECT_NAME: "office",
    POSTGRES_PASSWORD: "secret", GEMINI_API_KEY: "secret", DOCKER_HOST: "remote", DOCKER_CONTEXT: "remote",
  }), { PATH: "node", LOCALAPPDATA: "local" });
});

test("tampered environment, unsafe secrets, and injected env lines are rejected", () => {
  const config = createConfig();
  for (const patch of [
    { projectName: "yuksalish-workspace" }, { databaseUrl: "office" },
    { databasePassword: "x\nYUKSALISH_ENVIRONMENT=production" },
    { geminiApiKey: "abc\nPOSTGRES_PASSWORD=other" }, { deploymentId: "other" },
  ]) assert.throws(() => validateConfig({ ...config, ...patch }));
});

test("restart preserves credentials and explicit personal Gemini key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "yuksalish-local-test-"));
  try {
    const first = await prepareConfig(directory);
    first.config.geminiApiKey = "personal-test-key";
    await writeFile(first.configFile, JSON.stringify(first.config));
    const second = await prepareConfig(directory);
    assert.deepEqual(second.config, first.config);
    assert.match(await readFile(second.envFile, "utf8"), /YUKSALISH_GEMINI_API_KEY=personal-test-key/);
  } finally {
    await rm(directory, { recursive: true }); // Only this test's mkdtemp directory.
  }
});
