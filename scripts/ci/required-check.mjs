import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function assertRequiredCheck({ preflight, required, results }) {
  if (preflight !== "success") throw new Error(`CI preflight did not succeed: ${preflight}`);
  if (!["true", "false"].includes(required)) throw new Error("Missing or invalid CI scope.");
  if (!results.length) throw new Error("Missing CI job results.");
  const expected = required === "true" ? "success" : "skipped";
  if (results.some((result) => result !== expected)) {
    throw new Error(`Expected ${expected} jobs, received: ${results.join(", ")}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assertRequiredCheck({
    preflight: process.env.PREFLIGHT_RESULT,
    required: process.env.AREA_REQUIRED,
    results: (process.env.CHECK_RESULTS ?? "").split(",").filter(Boolean),
  });
}
