import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const allAreas = () => ({ python: true, desktop: true });

export function classifyChangedPaths(paths) {
  if (paths.length === 0) return allAreas();
  const areas = { python: false, desktop: false };
  for (const path of paths) {
    // Every PR carries its own pending note; it must not turn a docs/API-only PR into a desktop build.
    if (/^apps\/desktop\/release-notes\/pending\/[a-z0-9-]+\.json$/u.test(path)) continue;
    if (path.startsWith("docs/") || /^(?:README|AGENTS|CONTRIBUTING)\.md$/u.test(path)
      || /^LICENSE(?:\.[a-z]+)?$/iu.test(path)) continue;
    if (path.startsWith("apps/api/") || path.startsWith("modules/")
      || path.startsWith("tests/python/")
      || /^(?:pyproject\.toml|requirements[\w.-]*\.txt|uv\.lock)$/u.test(path)) {
      areas.python = true;
    } else if (path.startsWith("apps/desktop/")) {
      areas.desktop = true;
    } else {
      // Shared contracts, tooling, infrastructure, dependencies and unknown paths fail closed.
      return allAreas();
    }
  }
  return areas;
}

export function detectChangedAreas({ eventName, baseSha, headSha, cwd }) {
  if (eventName !== "pull_request") return allAreas();
  if (![baseSha, headSha].every((sha) => /^[a-f\d]{40}$/u.test(sha ?? ""))) {
    throw new Error("A pull request needs valid base and head commit SHAs.");
  }
  // Comparing the merge base excludes unrelated main changes. Disabling rename detection
  // keeps both the old deletion and the new path, so moving code into docs cannot hide it.
  const paths = execFileSync("git", [
    "diff", "--no-renames", "--name-only", "-z", `${baseSha}...${headSha}`, "--",
  ], { cwd, encoding: "utf8" }).split("\0").filter(Boolean);
  return classifyChangedPaths(paths);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const areas = detectChangedAreas({
    eventName: process.env.GITHUB_EVENT_NAME,
    baseSha: process.env.BASE_SHA,
    headSha: process.env.HEAD_SHA,
  });
  const output = Object.entries(areas).map(([name, required]) => `${name}=${required}\n`).join("");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(output.trim());
}
