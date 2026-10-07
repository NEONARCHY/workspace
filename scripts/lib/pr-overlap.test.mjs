import assert from "node:assert/strict";
import { test } from "node:test";
import { findPrOverlaps, renderOverlapReport, escapeAnnotation } from "./pr-overlap.mjs";
import { loadOpenPulls } from "../check-pr-overlaps.mjs";
const pull = (number, paths, base = "main") => ({ number, base, files: paths.map((filename) => ({ filename })) });

test("different notes and unrelated source files are independent", () => {
  assert.deepEqual(findPrOverlaps([pull(1, ["pending/a.json", "a.ts"]), pull(2, ["pending/b.json", "b.ts"])]), []);
});
test("reports shared files once, accounts for renamed sources, and respects base branches", () => {
  const a = pull(1, ["old.ts", "shared.ts"]);
  const b = { ...pull(2, ["shared.ts"]), files: [{ filename: "new.ts", previous_filename: "old.ts" }, { filename: "shared.ts" }] };
  assert.deepEqual(findPrOverlaps([a, b, pull(3, ["shared.ts"], "other")]),
    [{ left: 1, right: 2, files: ["old.ts", "shared.ts"] }]);
});
test("local changes are compared even before a PR exists", () => {
  assert.equal(findPrOverlaps([pull(0, ["App.tsx"]), pull(5, ["App.tsx"])])[0].left, 0);
});
test("untrusted filenames cannot inject Markdown/runner commands", () => {
  const report = renderOverlapReport("owner/repo", [], [{ left: 1, right: 2, files: ["x`<script>\n::error::.ts"] }]);
  assert.match(report, /&#96;&lt;script&gt; ::error::/);
  assert.equal(escapeAnnotation("x%\r\n::error::"), "x%25%0D%0A::error::");
});
test("incomplete results never claim all files have been checked", () => {
  assert.match(renderOverlapReport("owner/repo", [{ number: 1, incomplete: true }], []), /Неполный результат/);
});
test("loads all pages and signals the GitHub file limit", () => {
  const api = (path, pages) => {
    if (path.includes("state=open")) { assert.equal(pages, true); return [[{ number: 1, base: { ref: "main" }, head: { ref: "a" } }]]; }
    if (path.includes("/files?")) { assert.equal(pages, true); return [[{ filename: "a.ts" }], [{ filename: "b.ts" }]]; }
    return { changed_files: 3001 };
  };
  const [result] = loadOpenPulls("owner/repo", api);
  assert.equal(result.files.length, 2); assert.equal(result.incomplete, true);
  assert.throws(() => loadOpenPulls("bad;name", api), /Invalid GitHub repository/);
});
