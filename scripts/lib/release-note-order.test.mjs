import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { assertRetainedNoteNames, orderNoteNames } from "./release-note-order.mjs";

test("accepts an older independent note without losing history", () => {
  assert.doesNotThrow(() => assertRetainedNoteNames(["20261004-task-pane-scroll-fade.json"],
    ["20261002-employee-settings.json", "20261004-task-pane-scroll-fade.json"]));
});
test("accepts a timestamped append", () => {
  assert.doesNotThrow(() => assertRetainedNoteNames(["20261004-task-pane-scroll-fade.json"],
    ["20261004-task-pane-scroll-fade.json", "20261004-z044117-orb-lifecycle.json"]));
});
test("keeps known archived names and an initially empty history valid", () => {
  assert.doesNotThrow(() => assertRetainedNoteNames(["20261003-z235900-old.json"], ["20261003-z235900-old.json"]));
  assert.doesNotThrow(() => assertRetainedNoteNames([], ["20261003-first.json"]));
});
test("rejects deletion or renaming, rather than enforcing author timestamps", () => {
  assert.throws(() => assertRetainedNoteNames(["20261005-first.json"],
    ["20261004-backdated.json"]), /remove or rename/);
});

test("freezes legacy numbers and appends the earlier-dated PR merged second", () => {
  const old = "20261005-old.json", a = "20261002-a.json", b = "20261007-b.json";
  assert.deepEqual(orderNoteNames([a, b, old], [old], [old, b, a]), [old, b, a]);
  assert.deepEqual(orderNoteNames([a, b, old], [old], [old, a, b]), [old, a, b]);
});
test("ignores duplicate introductions caused by archiving and unrelated old groups", () => {
  assert.deepEqual(orderNoteNames(["old.json", "new.json"], ["old.json"],
    ["excluded.json", "old.json", "new.json", "new.json"]), ["old.json", "new.json"]);
});
test("PR-only entries are provisional and do not change the shared prefix", () => {
  assert.deepEqual(orderNoteNames(["z.json", "b.json", "a.json"], ["z.json"], []),
    ["z.json", "a.json", "b.json"]);
});
test("rejects missing frozen history and ambiguous filenames", () => {
  assert.throws(() => orderNoteNames([], ["old.json"], []), /cannot disappear/);
  assert.throws(() => orderNoteNames(["a.json", "a.json"], [], []), /must be unique/);
  assert.throws(() => orderNoteNames(["a.json"], ["a.json", "a.json"], []), /must be unique/);
});

test("restore validates numbering during preflight, before creating data volumes", () => {
  const source = readFileSync(new URL("../lan/restore-handoff.ps1", import.meta.url), "utf8");
  const prepare = source.indexOf("prepare-release-note-order.ps1");
  const preflightReturn = source.indexOf("if ($PreflightOnly)");
  const createVolume = source.indexOf("& docker volume create");
  assert.ok(prepare >= 0 && preflightReturn > prepare && createVolume > prepare);
  assert.equal(source.lastIndexOf("prepare-release-note-order.ps1"), prepare);
});
