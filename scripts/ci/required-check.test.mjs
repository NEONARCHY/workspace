import assert from "node:assert/strict";
import test from "node:test";
import { assertRequiredCheck } from "./required-check.mjs";

test("relevant checks require every job/shard to succeed", () => {
  assertRequiredCheck({ preflight: "success", required: "true", results: ["success", "success"] });
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.throws(() => assertRequiredCheck({ preflight: "success", required: "true", results: ["success", result] }));
  }
});

test("irrelevant checks may be skipped only after successful preflight", () => {
  assertRequiredCheck({ preflight: "success", required: "false", results: ["skipped", "skipped"] });
  for (const result of ["failure", "cancelled", "success", ""]) {
    assert.throws(() => assertRequiredCheck({ preflight: "success", required: "false", results: [result] }));
  }
});

test("preflight failure or cancellation blocks even an intentionally skipped area", () => {
  for (const preflight of ["failure", "cancelled", "skipped", undefined]) {
    for (const required of ["true", "false"]) {
      assert.throws(() => assertRequiredCheck({ preflight, required, results: ["skipped"] }));
    }
  }
});

test("missing scope or results cannot turn the required gate green", () => {
  for (const required of [undefined, "", "unknown"]) {
    assert.throws(() => assertRequiredCheck({ preflight: "success", required, results: ["skipped"] }));
  }
  assert.throws(() => assertRequiredCheck({ preflight: "success", required: "true", results: [] }));
});
