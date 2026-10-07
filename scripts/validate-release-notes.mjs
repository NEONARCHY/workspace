import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertRetainedNoteNames } from "./lib/release-note-order.mjs";

const notesPath = "apps/desktop/release-notes.json";
const pendingPath = "apps/desktop/release-notes/pending";
const packagePath = "apps/desktop/package.json";
const notes = JSON.parse(readFileSync(notesPath, "utf8"));
const desktopPackage = JSON.parse(readFileSync(packagePath, "utf8"));
const fail = (message) => { throw new Error(`Release notes: ${message}`); };

if (notes.version !== desktopPackage.version) fail("version must match apps/desktop/package.json");
if (typeof notes.title !== "string" || notes.title.trim().length < 12 || notes.title.length > 120) {
  fail("title must contain 12–120 user-facing characters");
}
const entryFiles = readdirSync(pendingPath).filter((name) => name.endsWith(".json")).sort();
const entries = entryFiles.map((name) => JSON.parse(readFileSync(join(pendingPath, name), "utf8")));
if (entries.length === 0) fail("at least one pending entry is required");
const ids = new Set();
for (const [index, entry] of entries.entries()) {
  const fileName = entryFiles[index];
  const dateMatch = /^(\d{4})(\d{2})(\d{2})-[a-z0-9-]+\.json$/u.exec(fileName);
  if (!dateMatch) fail(`${fileName} must begin with a YYYYMMDD date`);
  const date = new Date(`${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}T12:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`) {
    fail(`${fileName} must contain a valid calendar date`);
  }
  if (typeof entry.id !== "string" || !/^[a-z0-9-]{8,80}$/u.test(entry.id) || ids.has(entry.id)) {
    fail("every pending entry needs a unique lowercase id");
  }
  ids.add(entry.id);
  if (entry.title !== undefined && (typeof entry.title !== "string" || entry.title.trim().length < 8 || entry.title.length > 50)) {
    fail(`${entry.id} title must contain 8–50 characters when provided`);
  }
  if (!Array.isArray(entry.items) || entry.items.length < 1 || entry.items.length > 12) {
    fail(`${entry.id} must contain 1–12 changes`);
  }
  if (entry.items.some((item) => typeof item !== "string" || item.trim().length < 12 || item.length > 160)) {
    fail(`${entry.id} items must contain 12–160 characters`);
  }
}
const itemCount = entries.reduce((total, entry) => total + entry.items.length, 0);

const [base, head = "HEAD"] = process.argv.slice(2);
let baseline = base && !/^0+$/.test(base) ? base : "HEAD";
if (!base) {
  try { baseline = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
  catch { /* Initial local clones can validate against HEAD before fetching origin/main. */ }
}
const historicalNames = execFileSync("git", ["ls-tree", "-r", "--name-only", baseline, "--",
  pendingPath, "apps/desktop/release-notes/released"], { encoding: "utf8" })
  .split(/\r?\n/u).map((name) => name.split("/").at(-1))
  .filter((name) => /^\d{8}-.*\.json$/u.test(name ?? ""));
const releasedPath = "apps/desktop/release-notes/released";
const releasedNames = readdirSync(releasedPath, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .flatMap((entry) => readdirSync(join(releasedPath, entry.name)).filter((name) => name.endsWith(".json")));
try { assertRetainedNoteNames(historicalNames, [...entryFiles, ...releasedNames]); }
catch (error) { fail(error.message); }
const orderPath = "apps/desktop/release-notes/numbering-baseline.json";
const order = JSON.parse(readFileSync(orderPath, "utf8"));
if (order.lastGroupedVersion !== "1.0.17" || !/^[a-f0-9]{40}$/u.test(order.frozenAt)
  || !Array.isArray(order.fileNames) || new Set(order.fileNames).size !== order.fileNames.length) {
  fail("the frozen numbering baseline is invalid");
}
const frozenFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", order.frozenAt, "--", pendingPath, releasedPath], { encoding: "utf8" })
  .split(/\r?\n/u).filter((path) => {
    if (path.startsWith(`${pendingPath}/`)) return true;
    const match = /\/released\/(\d+)\.(\d+)\.(\d+)\//u.exec(path);
    return match && (Number(match[1]) > 1 || Number(match[2]) > 0 || Number(match[3]) > 17);
  }).map((path) => path.split("/").at(-1)).sort();
if (JSON.stringify(order.fileNames) !== JSON.stringify(frozenFiles)) fail("the original numbering snapshot must not change");
const existingBaseline = execFileSync("git", ["ls-tree", "--name-only", baseline, "--", orderPath], { encoding: "utf8" }).trim();
if (existingBaseline) {
  const previous = JSON.parse(execFileSync("git", ["show", `${baseline}:${orderPath}`], { encoding: "utf8" }));
  if (JSON.stringify(order) !== JSON.stringify(previous)) fail("do not rewrite the frozen numbering baseline");
}
const allNoteIds = [...entries, ...readdirSync(releasedPath, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  .filter((entry) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(entry.name);
    return match && (Number(match[1]) > 1 || Number(match[2]) > 0 || Number(match[3]) > 17);
  })
  .flatMap((entry) => readdirSync(join(releasedPath, entry.name)).filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(releasedPath, entry.name, name), "utf8"))))].map((entry) => entry.id);
if (new Set(allNoteIds).size !== allNoteIds.length) fail("numbered note IDs must remain unique across pending and released history");
if (base && !/^0+$/.test(base)) {
  const changed = execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
    .split(/\r?\n/u).filter(Boolean);
  if (changed.length > 0 && !changed.some((name) => name.startsWith(`${pendingPath}/`))) {
    fail(`a file in ${pendingPath} must be added or updated in every push or pull request`);
  }
}

console.log(`Release notes ${notes.version}: ${notes.title} (${entries.length} entries, ${itemCount} historical items; latest 50 form the installer summary)`);
