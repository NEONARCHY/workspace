import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const notesPath = "apps/desktop/release-notes.json";
const packagePath = "apps/desktop/package.json";
const notes = JSON.parse(readFileSync(notesPath, "utf8"));
const desktopPackage = JSON.parse(readFileSync(packagePath, "utf8"));
const fail = (message) => { throw new Error(`Release notes: ${message}`); };

if (notes.version !== desktopPackage.version) fail("version must match apps/desktop/package.json");
if (typeof notes.title !== "string" || notes.title.trim().length < 12 || notes.title.length > 120) {
  fail("title must contain 12–120 user-facing characters");
}
if (!Array.isArray(notes.items) || notes.items.length < 1 || notes.items.length > 6) {
  fail("items must contain 1–6 changes");
}
if (notes.items.some((item) => typeof item !== "string" || item.trim().length < 12 || item.length > 120)) {
  fail("each item must contain 12–120 characters");
}

const [base, head = "HEAD"] = process.argv.slice(2);
if (base && !/^0+$/.test(base)) {
  const changed = execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
    .split(/\r?\n/u).filter(Boolean);
  if (changed.length > 0 && !changed.includes(notesPath)) {
    fail(`${notesPath} must be updated in every push or pull request`);
  }
}

console.log(`Release notes ${notes.version}: ${notes.title} (${notes.items.length} items)`);
