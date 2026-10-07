import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readReleaseNoteOrder } from "../../release-note-order.mts";

const roots: string[] = [];
const old = "20261005-old.json", a = "20261002-a.json", b = "20261007-b.json";
const projectRoot = resolve(process.cwd(), "../..");
const preparedMetadata = join(projectRoot, "apps/desktop/release-notes/order.generated.json");
function directory() {
  const root = mkdtempSync(join(tmpdir(), "workspace-note-order-")); roots.push(root);
  mkdirSync(join(root, "apps/desktop/release-notes/pending"), { recursive: true });
  mkdirSync(join(root, "apps/desktop/release-notes/released/1.0.200"), { recursive: true });
  return root;
}
function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function add(root: string, name: string) {
  writeFileSync(join(root, "apps/desktop/release-notes/pending", name), "{}");
  git(root, "add", "."); git(root, "commit", "-m", name);
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("release note introduction order", () => {
  it.each([[b, a], [a, b]])("uses actual squash/merge order rather than the filename: %s then %s", (first, second) => {
    const root = directory();
    git(root, "init", "-b", "main"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "QA");
    add(root, old);
    git(root, "branch", "a"); git(root, "switch", "-c", "b"); add(root, b);
    git(root, "switch", "a"); add(root, a); git(root, "switch", "main");
    for (const name of [first, second]) git(root, "merge", "--no-ff", name === a ? "a" : "b", "-m", `merge ${name}`);
    expect(readReleaseNoteOrder(root, [a, b, old], [old])).toEqual([old, first, second]);
    git(root, "mv", `apps/desktop/release-notes/pending/${first}`, `apps/desktop/release-notes/released/1.0.200/${first}`);
    git(root, "commit", "-m", "archive");
    expect(readReleaseNoteOrder(root, [a, b, old], [old])).toEqual([old, first, second]);
  });

  it("a PR preview follows its shared main prefix even if it merged main after its own commit", () => {
    const root = directory();
    git(root, "init", "-b", "main"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "QA");
    add(root, old); git(root, "switch", "-c", "a"); add(root, a);
    git(root, "switch", "main"); add(root, b); git(root, "switch", "a"); git(root, "merge", "main", "-m", "sync main");
    expect(readReleaseNoteOrder(root, [a, b, old], [old])).toEqual([old, b, a]);
  });

  it("reads the same complete order in a Docker/source archive without copying .git", () => {
    const root = directory(), revision = "a".repeat(40);
    const path = join(root, "apps/desktop/release-notes/order.generated.json");
    writeFileSync(path, JSON.stringify({ format: 1, revision, fileNames: [old, b, a] }));
    expect(readReleaseNoteOrder(root, [a, b, old], [old], revision)).toEqual([old, b, a]);
    expect(() => readReleaseNoteOrder(root, [a, b, old], [old], "b".repeat(40))).toThrow("different Git revision");
    writeFileSync(path, JSON.stringify({ format: 1, revision, fileNames: [old, b] }));
    expect(() => readReleaseNoteOrder(root, [a, b, old], [old])).toThrow("stale");
    writeFileSync(path, JSON.stringify({ format: 2, revision, fileNames: [] }));
    expect(() => readReleaseNoteOrder(root, [old], [old])).toThrow("invalid");
  });

  it("fails clearly for a source archive without metadata", () => {
    expect(() => readReleaseNoteOrder(directory(), [old], [old])).toThrow("metadata is missing");
  });

  it.skipIf(!existsSync(preparedMetadata))("PowerShell Docker metadata matches native Git ordering", () => {
    const metadata = JSON.parse(readFileSync(preparedMetadata, "utf8")) as { revision: string; fileNames: string[] };
    const baseline = JSON.parse(readFileSync(join(projectRoot, "apps/desktop/release-notes/numbering-baseline.json"), "utf8")) as { fileNames: string[] };
    const names = metadata.fileNames;
    const root = directory();
    writeFileSync(join(root, "apps/desktop/release-notes/order.generated.json"), JSON.stringify(metadata));
    expect(readReleaseNoteOrder(root, names, baseline.fileNames, metadata.revision))
      .toEqual(readReleaseNoteOrder(projectRoot, names, baseline.fileNames));
  });
});
