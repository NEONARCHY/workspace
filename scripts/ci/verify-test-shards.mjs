import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Exercise the installed Vitest discovery and configured sequencer together.
// `vitest list --filesOnly` intentionally does not apply --shard.
const { createVitest } = await import(new URL("../../apps/desktop/node_modules/vitest/dist/node.js", import.meta.url));
const ctx = await createVitest("test", {
  root: fileURLToPath(new URL("../../apps/desktop/", import.meta.url)), watch: false,
});
try {
  const files = await ctx.globTestSpecifications();
  assert.ok(files.length > 0, "Test discovery must not be empty");
  const key = (file) => `${file.project.name}:${file.moduleId}`;
  const partitions = [];
  for (const index of [1, 2, 3, 4]) {
    ctx.config.shard = { index, count: 4 };
    const sequencer = new ctx.config.sequence.sequencer(ctx);
    const shard = await sequencer.shard(files);
    partitions.push(shard);
    assert.deepEqual((await sequencer.shard([...files].reverse())).map(key).sort(), shard.map(key).sort(), "Discovery order must not change shard membership");
    console.log(`Shard ${index}: ${shard.length} files`);
  }
  const selected = partitions.flat().map(key);
  assert.deepEqual([...selected].sort(), files.map(key).sort(), "Every discovered test must be assigned");
  assert.equal(new Set(selected).size, files.length, "No duplicate assignments");
  console.log(`Verified all ${files.length} discovered files run exactly once across four shards.`);
} finally {
  await ctx.close();
}
