import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { classifyChangedPaths, detectChangedAreas } from "./changed-areas.mjs";

const note = "apps/desktop/release-notes/pending/20261020-100000-example.json";
for (const [name, paths, expected] of [
  ["documentation and its pending note", ["docs/operations/ci.md", "README.md", note], [false, false]],
  ["pending note only", [note], [false, false]],
  ["frontend and its pending note", ["apps/desktop/src/renderer/TasksView.tsx", note], [false, true]],
  ["backend and its pending note", ["apps/api/src/yuksalish_api/main.py", note], [true, false]],
  ["Python integration tests", ["tests/python/test_api.py"], [true, false]],
  ["Python modules", ["modules/edo/client.py"], [true, false]],
  ["Python dependencies", ["requirements.lock.txt", "pyproject.toml"], [true, false]],
  ["mixed changes", ["apps/api/main.py", "apps/desktop/src/renderer/App.tsx"], [true, true]],
  ["shared contracts", ["packages/contracts/src/index.ts"], [true, true]],
  ["lockfile", ["pnpm-lock.yaml"], [true, true]],
  ["workflow", [".github/workflows/ci.yml"], [true, true]],
  ["tooling", ["scripts/ci/changed-areas.mjs"], [true, true]],
  ["environment", [".env.example"], [true, true]],
  ["infrastructure", ["infrastructure/compose.yaml"], [true, true]],
  ["unknown future area", ["apps/new-app/main.ts"], [true, true]],
  ["empty comparison", [], [true, true]],
]) {
  test(name, () => assert.deepEqual(classifyChangedPaths(paths), { python: expected[0], desktop: expected[1] }));
}

test("manual runs always validate both areas", () => {
  assert.deepEqual(detectChangedAreas({ eventName: "workflow_dispatch" }), { python: true, desktop: true });
});

test("missing PR revisions cannot silently skip checks", () => {
  assert.throws(() => detectChangedAreas({ eventName: "pull_request" }), /valid base and head/u);
});

test("a rename out of source still runs its checks and unrelated base changes are excluded", () => {
  const cwd = mkdtempSync(join(tmpdir(), "workspace-ci-areas-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const add = (path, content) => {
    const full = join(cwd, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  try {
    git("init", "-b", "main");
    git("config", "user.name", "CI test");
    git("config", "user.email", "ci@example.invalid");
    add("apps/desktop/source.ts", "export const value = 1;\n");
    git("add", "."); git("commit", "-m", "base");
    git("switch", "-c", "feature");
    mkdirSync(join(cwd, "docs"), { recursive: true });
    renameSync(join(cwd, "apps/desktop/source.ts"), join(cwd, "docs/source.md"));
    git("add", "."); git("commit", "-m", "move source");
    const headSha = git("rev-parse", "HEAD");
    git("switch", "main");
    add("apps/api/new.py", "value = 1\n");
    git("add", "."); git("commit", "-m", "unrelated main update");
    const baseSha = git("rev-parse", "HEAD");
    assert.deepEqual(detectChangedAreas({ eventName: "pull_request", baseSha, headSha, cwd }), {
      python: false, desktop: true,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
