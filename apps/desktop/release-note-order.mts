import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { orderNoteNames } from "./release-notes/ordering.mjs";

const pending = "apps/desktop/release-notes/pending";
const released = "apps/desktop/release-notes/released";
const metadataPath = "apps/desktop/release-notes/order.generated.json";

export function readReleaseNoteOrder(
  projectRoot: string, names: readonly string[], frozen: readonly string[], buildId?: string,
): string[] {
  let merged: string[];
  if (existsSync(join(projectRoot, ".git"))) {
    const git = (...args: string[]) => execFileSync("git", args, {
      cwd: projectRoot, encoding: "utf8", timeout: 15_000, maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (git("rev-parse", "--is-shallow-repository") !== "false") {
      throw new Error("Release numbering requires full Git history: git fetch --unshallow");
    }
    const branch = git("branch", "--show-current");
    let reference = "HEAD";
    if (branch && branch !== "main") {
      let main: string | undefined;
      for (const candidate of ["refs/remotes/origin/main", "refs/heads/main"]) {
        try { git("rev-parse", "--verify", candidate); main = candidate; break; }
        catch { /* A local clone may have main but no remote-tracking ref yet. */ }
      }
      if (!main) throw new Error("Release numbering requires main: git fetch origin main");
      reference = git("merge-base", "HEAD", main);
    }
    merged = git("log", "--first-parent", "--reverse", "--diff-filter=A", "--name-only",
      "--format=", reference, "--", pending, released).split(/\r?\n/u)
      .map((path) => path.split("/").at(-1) ?? "").filter((name) => /^\d{8}-.*\.json$/u.test(name));
  } else {
    const path = join(projectRoot, metadataPath);
    if (!existsSync(path)) {
      throw new Error("Release numbering metadata is missing. Run scripts/lan/prepare-release-note-order.ps1 before Docker build.");
    }
    const metadata: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!metadata || typeof metadata !== "object" || !("format" in metadata) || metadata.format !== 1
      || !("revision" in metadata) || typeof metadata.revision !== "string" || !/^[a-f0-9]{40}$/u.test(metadata.revision)
      || !("fileNames" in metadata) || !Array.isArray(metadata.fileNames)
      || !metadata.fileNames.every((name: unknown) => typeof name === "string" && /^\d{8}-[a-z0-9-]+\.json$/u.test(name))) {
      throw new Error("Release numbering metadata is invalid");
    }
    if (buildId && /^[a-f0-9]{40}$/u.test(buildId) && metadata.revision !== buildId) {
      throw new Error("Release numbering metadata belongs to a different Git revision");
    }
    merged = metadata.fileNames as string[];
    if (names.some((name) => !merged.includes(name))) {
      throw new Error("Release numbering metadata is stale; regenerate it before Docker build");
    }
  }
  return orderNoteNames(names, frozen, merged);
}
