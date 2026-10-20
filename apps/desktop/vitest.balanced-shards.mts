import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import timings from "./ci-test-timings.json" with { type: "json" };

type WeightedFile<T> = { file: T; key: string; duration: number };

// Longest-processing-time first. The input is always Vitest's complete discovered
// set, never the timing manifest: new/renamed tests cannot disappear from CI.
export function balanceTests<T>(files: WeightedFile<T>[], count: number): T[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error("Invalid shard count");
  const shards = Array.from({ length: count }, () => ({ files: [] as T[], duration: 0 }));
  const ordered = [...files].sort((a, b) => b.duration - a.duration || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const entry of ordered) {
    if (!Number.isFinite(entry.duration) || entry.duration <= 0) throw new Error("Invalid test duration");
    const target = shards.reduce((best, shard) => shard.duration < best.duration
      || (shard.duration === best.duration && shard.files.length < best.files.length) ? shard : best);
    target.files.push(entry.file);
    target.duration += entry.duration;
  }
  return shards.map((shard) => shard.files);
}

export function testWeight(project: string, path: string): number {
  const key = `${project}:${path.replaceAll("\\", "/")}`;
  const known: Record<string, number> = timings.durationsMs;
  // Conservative startup/import budget for unseen files, not a skip/allowlist.
  return known[key] ?? (project === "node" ? 500 : 6000);
}

export class BalancedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { shard, root } = this.ctx.config;
    if (!shard) return files;
    const weighted = files.map((file) => {
      const path = relative(root, file.moduleId).replaceAll("\\", "/");
      return { file, key: `${file.project.name}:${path}`, duration: testWeight(file.project.name, path) };
    });
    return balanceTests(weighted, shard.count)[shard.index - 1] ?? [];
  }
}
