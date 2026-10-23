import { compareReleaseVersions } from "./release-versions.mts";

export interface ReleaseTimelineEntry {
  readonly id: string;
  readonly version: string;
  readonly date?: string;
  readonly title: string;
  readonly items: readonly string[];
}

export function orderedReleaseEntries(entries: readonly ReleaseTimelineEntry[]): readonly ReleaseTimelineEntry[] {
  const unique = new Map<string, ReleaseTimelineEntry>();
  for (const entry of entries) {
    if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(entry.version) || unique.has(entry.id)) continue;
    unique.set(entry.id, entry);
  }
  return [...unique.values()].sort((left, right) => compareReleaseVersions(right.version, left.version));
}

/** Receipts apply only to the history bundled with the running build, never a remote future build. */
export function bundledReleaseEntries(): readonly ReleaseTimelineEntry[] {
  return orderedReleaseEntries([
    ...__YUKSALISH_UPDATE_ENTRIES__.map(entry => ({
      ...entry, id: `update:${entry.id}`, title: `Обновление ${entry.version}`,
    })),
    ...__YUKSALISH_RELEASE_HISTORY__.map(entry => ({ ...entry, id: `release:${entry.version}` })),
  ]);
}

export function unreadReleaseEntries(
  entries: readonly ReleaseTimelineEntry[], readEntryIds: readonly string[],
): readonly ReleaseTimelineEntry[] {
  const read = new Set(readEntryIds);
  return entries.filter(entry => !read.has(entry.id));
}

export function latestReadReleaseVersion(entries: readonly ReleaseTimelineEntry[], readEntryIds: readonly string[]): string | undefined {
  const read = new Set(readEntryIds);
  return orderedReleaseEntries(entries).find(entry => read.has(entry.id))?.version;
}

export function formatReleaseDate(value?: string): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Дата не указана";
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  }) : "Дата не указана";
}
