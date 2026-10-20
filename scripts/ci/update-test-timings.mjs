import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function parseTimings(log) {
  const durations = {};
  let previous;
  for (const line of log.replace(/(?:\u001b|\^\[)\[[0-9;]*m/gu, "").split("\n")) {
    const timestamp = line.match(/\t(\d{4}-\d\d-\d\dT\S+Z) /u)?.[1];
    if (!timestamp) continue;
    const now = Date.parse(timestamp);
    if (/\sRUN\s+v\d/u.test(line)) previous = now;
    const match = line.match(/\s(node|ui)\s+(\S+\.test\.[cm]?[jt]sx?) \(.*?\)\s+(\d+)ms/u);
    if (!match) continue;
    const key = `${match[1]}:${match[2]}`;
    if (key in durations) throw new Error(`Duplicate result: ${key}`);
    // With one worker, completion-to-completion includes setup, imports and
    // jsdom startup, which the reported assertion duration alone omits.
    durations[key] = Math.max(Number(match[3]), previous === undefined ? 0 : now - previous, 1);
    previous = now;
  }
  if (!Object.keys(durations).length) throw new Error("No test results in job log");
  return durations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const run = process.argv[2];
  if (!/^\d+$/u.test(run ?? "")) throw new Error("Usage: node scripts/ci/update-test-timings.mjs RUN_ID");
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 30e6 });
  const { jobs } = JSON.parse(gh("run", "view", run, "--repo", "NEONARCHY/workspace", "--json", "jobs"));
  const shards = jobs.filter((job) => /^desktop-tests \(\d+\)$/u.test(job.name));
  if (shards.length !== 4 || shards.some((job) => job.conclusion !== "success")) {
    throw new Error("Require all four successful desktop test jobs");
  }
  const durationsMs = {};
  for (const job of shards) {
    const values = parseTimings(gh("run", "view", run, "--repo", "NEONARCHY/workspace", "--job", String(job.databaseId), "--log"));
    for (const [key, value] of Object.entries(values)) {
      if (key in durationsMs) throw new Error(`Test ran in multiple shards: ${key}`);
      durationsMs[key] = value;
    }
    console.log(`${job.name}: ${Object.keys(values).length} files, ${Math.round(Object.values(values).reduce((a, b) => a + b, 0) / 1000)}s`);
  }
  const target = new URL("../../apps/desktop/ci-test-timings.json", import.meta.url);
  writeFileSync(target, `${JSON.stringify({ sourceRun: run, durationsMs: Object.fromEntries(Object.entries(durationsMs).sort(([a], [b]) => a < b ? -1 : 1)) }, null, 2)}\n`);
  console.log(`Updated ${Object.keys(durationsMs).length} timing estimates; review and commit the manifest.`);
}
