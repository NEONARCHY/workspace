import assert from "node:assert/strict";
import { test } from "node:test";
import { assertAppendedNoteNames } from "./release-note-order.mjs";

test("rejects a new note which would leave the old update text latest", () => {
  assert.throws(() => assertAppendedNoteNames(["20261004-task-pane-scroll-fade.json"],
    ["20261004-employee-settings.json", "20261004-task-pane-scroll-fade.json"]), /must sort after/);
});
test("accepts a timestamped append without changing old numbers", () => {
  assert.doesNotThrow(() => assertAppendedNoteNames(["20261004-task-pane-scroll-fade.json"],
    ["20261004-task-pane-scroll-fade.json", "20261004-z044117-orb-lifecycle.json"]));
});
test("keeps known archived names and an initially empty history valid", () => {
  assert.doesNotThrow(() => assertAppendedNoteNames(["20261003-z235900-old.json"], ["20261003-z235900-old.json"]));
  assert.doesNotThrow(() => assertAppendedNoteNames([], ["20261003-first.json"]));
});
test("checks the latest of all existing notes, not only the same date", () => {
  assert.throws(() => assertAppendedNoteNames(["20261005-first.json", "20261004-z235900-last.json"],
    ["20261004-z235959-backdated.json"]), /20261005-first/);
});
