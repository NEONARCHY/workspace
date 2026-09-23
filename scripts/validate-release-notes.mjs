import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

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
for (const entry of entries) {
  if (typeof entry.id !== "string" || !/^[a-z0-9-]{8,80}$/u.test(entry.id) || ids.has(entry.id)) {
    fail("every pending entry needs a unique lowercase id");
  }
  ids.add(entry.id);
  if (!Array.isArray(entry.items) || entry.items.length < 1 || entry.items.length > 12) {
    fail(`${entry.id} must contain 1–12 changes`);
  }
  if (entry.items.some((item) => typeof item !== "string" || item.trim().length < 12 || item.length > 160)) {
    fail(`${entry.id} items must contain 12–160 characters`);
  }
}
const itemCount = entries.reduce((total, entry) => total + entry.items.length, 0);
if (itemCount > 100) fail("a pending release may contain at most 100 changes");

const [base, head = "HEAD"] = process.argv.slice(2);
if (base && !/^0+$/.test(base)) {
  const changed = execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
    .split(/\r?\n/u).filter(Boolean);
  if (changed.length > 0 && !changed.some((name) => name.startsWith(`${pendingPath}/`))) {
    fail(`a file in ${pendingPath} must be added or updated in every push or pull request`);
  }
}

console.log(`Release notes ${notes.version}: ${notes.title} (${entries.length} entries, ${itemCount} items)`);
