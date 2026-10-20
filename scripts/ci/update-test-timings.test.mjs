import assert from "node:assert/strict";
import test from "node:test";
import { parseTimings } from "./update-test-timings.mjs";

const line = (second, text) => `job\tstep\t2026-10-20T10:00:${second}.000Z ${text}`;
test("timings include imports/setup between serial file completions", () => {
  assert.deepEqual(parseTimings([
    line("00", "RUN v4.1.11"),
    line("04", "✓ ui src/A.test.tsx (2 tests) 20ms"),
    line("10", "✓ node src/B.test.ts (1 test) 100ms"),
  ].join("\n")), { "ui:src/A.test.tsx": 4000, "node:src/B.test.ts": 6000 });
});
test("ANSI and GitHub escaped ANSI results are accepted", () => {
  for (const escape of ["\u001b", "^["]) {
    assert.deepEqual(parseTimings(line("01", `${escape}[32m✓${escape}[39m ui src/A.test.ts (1 test) 20ms`)), { "ui:src/A.test.ts": 20 });
  }
});
test("missing or duplicate results fail rather than replacing estimates with empty data", () => {
  assert.throws(() => parseTimings("no results"), /No test results/u);
  const result = line("01", "✓ ui src/A.test.ts (1 test) 20ms");
  assert.throws(() => parseTimings(`${result}\n${result}`), /Duplicate/u);
});
